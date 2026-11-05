import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { randomToken, sha256 } from '../auth/crypto.js';
import { contentLocale } from '../catalog/catalog.data.js';
import { AppError, notFound } from '../common/errors.js';
import { todayInIstanbul } from '../common/http.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { CONFIG, type Config } from '../config.js';
import type { OrgInvite, OrgRole, Prisma } from '../generated/prisma/client.js';
import { isUuid } from '../images/images.service.js';
import { MailerService, renderActionMail } from '../mail/mailer.service.js';

// Corporate workspaces (API.md §7.23), step 1: firms, roles and the shared credit pool, run from the admin panel.
// Rules: one OWNER per firm (changed only by a transfer), members are registered, verified, active, non-staff
// accounts; the pool never goes below zero (conditional update + CHECK constraint); every change has a reason and is
// audited by the controller.

export const MAX_MEMBERS = 200;
export const MAX_ORGS_PER_USER = 10;
export const INVITE_TTL_DAYS = 7;
export const MAX_PENDING_INVITES = 50;
const DAY = 86_400_000;

const name = z.string().trim().min(2).max(80);
const cap = z.number().int().min(1).max(100_000).nullable();
const reason = z.string().trim().min(3).max(200);
const email = z.email().max(254).transform((v) => v.trim().toLowerCase());
const note = z.string().trim().max(500).nullable();

export const CreateOrgSchema = z
  .object({ name, ownerEmail: email, credits: z.number().int().min(0).max(1_000_000).default(0), memberMonthlyCap: cap.default(null), note: note.default(null), reason })
  .strict();
export const UpdateOrgSchema = z
  .object({ name: name.optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), memberMonthlyCap: cap.optional(), note: note.optional(), reason })
  .strict()
  .refine((v) => v.name !== undefined || v.status !== undefined || v.memberMonthlyCap !== undefined || v.note !== undefined, { message: 'nothing_to_change' });
export const OrgCreditsSchema = z.object({ delta: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0), reason }).strict();
export const AddMemberSchema = z.object({ email, role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'), monthlyCap: cap.default(null), reason }).strict();
export const UpdateMemberSchema = z
  .object({ role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).optional(), monthlyCap: cap.optional(), reason })
  .strict()
  .refine((v) => v.role !== undefined || v.monthlyCap !== undefined, { message: 'nothing_to_change' });
export const ReasonSchema = z.object({ reason }).strict();
export const AdminInviteSchema = z.object({ email, role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'), monthlyCap: cap.default(null), reason }).strict();
export const InviteTokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const TeamInviteSchema = z.object({ email, role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'), monthlyCap: cap.default(null) }).strict();
export const TeamMemberSchema = z
  .object({ role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).optional(), monthlyCap: cap.optional() })
  .strict()
  .refine((v) => v.role !== undefined || v.monthlyCap !== undefined, { message: 'nothing_to_change' });
export const OrgListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

type Tx = Prisma.TransactionClient;

/** First instant of the current Istanbul month (UTC+3, no DST). */
export function monthStart(now = new Date()) {
  return new Date(`${todayInIstanbul(now).slice(0, 7)}-01T00:00:00+03:00`);
}

@Injectable()
export class OrgsService {
  constructor(private prisma: PrismaService, private mailer: MailerService, @Inject(CONFIG) private cfg: Config) {}

  /** Locks the firm row for the rest of the transaction (owner and pool changes are serialised per firm). */
  private async lock(tx: Tx, orgId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Organization" WHERE id = ${orgId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound();
  }

  /** A person who can join a firm: registered, verified, active, and not a staff account (those are for the panel). */
  private async eligibleUser(tx: Tx, address: string) {
    const user = await tx.user.findUnique({ where: { email: address }, select: { id: true, isGuest: true, emailVerifiedAt: true, status: true, role: true } });
    if (!user) throw new AppError(404, 'user_not_found', 'Bu e-postayla kayıtlı kullanıcı yok. Kişi önce Casalume hesabı açıp e-postasını doğrulamalı.');
    if (user.isGuest || !user.emailVerifiedAt) throw new AppError(422, 'email_not_verified', 'Kişinin e-postası doğrulanmamış; önce doğrulamalı.');
    if (user.status !== 'ACTIVE') throw new AppError(422, 'user_inactive', 'Bu hesap askıya alınmış.');
    if (user.role !== 'USER') throw new AppError(422, 'staff_account', 'Yönetici hesapları firmaya eklenmez; kişinin normal hesabını kullan.');
    const memberships = await tx.orgMember.count({ where: { userId: user.id } });
    if (memberships >= MAX_ORGS_PER_USER) throw new AppError(409, 'too_many_orgs', `Bir kişi en çok ${MAX_ORGS_PER_USER} firmada olabilir.`);
    return user;
  }

  async list(q: z.infer<typeof OrgListQuery>) {
    const where: Prisma.OrganizationWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? isUuid(q.q)
          ? { id: q.q }
          : { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { members: { some: { role: 'OWNER', user: { email: { contains: q.q, mode: 'insensitive' } } } } }] }
        : {}),
    };
    const rows = await this.prisma.organization.findMany({
      where,
      include: { _count: { select: { members: true } }, members: { where: { role: 'OWNER' }, include: { user: { select: { email: true } } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((o) => ({
        id: o.id, name: o.name, status: o.status, credits: o.credits, members: o._count.members,
        ownerEmail: o.members[0]?.user.email ?? null, createdAt: o.createdAt.toISOString(),
      })),
      nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
    };
  }

  /** Credits each member spent in the current Istanbul month (spending minus refunds). */
  private async monthlyUsage(orgId: string) {
    const rows = await this.prisma.orgLedger.groupBy({
      by: ['userId'],
      where: { orgId, userId: { not: null }, reason: { in: ['generation', 'refund'] }, createdAt: { gte: monthStart() } },
      _sum: { delta: true },
    });
    return new Map(rows.map((r) => [r.userId!, Math.max(0, -(r._sum.delta ?? 0))]));
  }

  async detail(orgId: string) {
    if (!isUuid(orgId)) throw notFound();
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        members: { include: { user: { select: { id: true, email: true, name: true, status: true } } }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] },
        ledger: { orderBy: { createdAt: 'desc' }, take: 50 },
        invites: { where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } },
        projects: { include: { _count: { select: { designs: true } } }, orderBy: { updatedAt: 'desc' }, take: 100 },
      },
    });
    if (!org) throw notFound();
    const usage = await this.monthlyUsage(orgId);
    const owner = org.members.find((m) => m.role === 'OWNER');
    return {
      id: org.id, name: org.name, status: org.status, credits: org.credits, memberMonthlyCap: org.memberMonthlyCap, note: org.note,
      createdAt: org.createdAt.toISOString(), updatedAt: org.updatedAt.toISOString(),
      owner: owner ? { userId: owner.userId, email: owner.user.email } : null,
      members: org.members.map((m) => ({
        userId: m.userId, email: m.user.email, name: m.user.name, userStatus: m.user.status, role: m.role,
        monthlyCap: m.monthlyCap, effectiveCap: m.monthlyCap ?? org.memberMonthlyCap, usedThisMonth: usage.get(m.userId) ?? 0,
        joinedAt: m.createdAt.toISOString(),
      })),
      ledger: org.ledger.map((l) => ({ id: l.id, delta: l.delta, reason: l.reason, userId: l.userId, actorId: l.actorId, createdAt: l.createdAt.toISOString() })),
      invites: org.invites.map((i) => this.inviteDto(i)),
      projects: org.projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName, status: p.status, designs: p._count.designs, updatedAt: p.updatedAt.toISOString() })),
    };
  }

  async create(input: z.infer<typeof CreateOrgSchema>, actorId: string) {
    const id = await this.prisma.$transaction(async (tx) => {
      const owner = await this.eligibleUser(tx, input.ownerEmail);
      const org = await tx.organization.create({
        data: { name: input.name, credits: input.credits, memberMonthlyCap: input.memberMonthlyCap, note: input.note, members: { create: { userId: owner.id, role: 'OWNER' } } },
      });
      if (input.credits > 0) await tx.orgLedger.create({ data: { orgId: org.id, delta: input.credits, reason: `admin: ${input.reason}`, actorId } });
      return org.id;
    });
    return this.detail(id);
  }

  async update(orgId: string, input: z.infer<typeof UpdateOrgSchema>) {
    if (!isUuid(orgId)) throw notFound();
    const before = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!before) throw notFound();
    const { reason: _reason, ...data } = input;
    await this.prisma.organization.update({ where: { id: orgId }, data });
    const diff = Object.fromEntries(Object.keys(data).map((k) => [k, { from: before[k as keyof typeof before], to: data[k as keyof typeof data] }]));
    return { detail: await this.detail(orgId), diff };
  }

  /** Atomic: the pool changes only if it stays at or above zero (no read-then-write race). */
  async adjustCredits(orgId: string, delta: number, why: string, actorId: string) {
    if (!isUuid(orgId)) throw notFound();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.organization.updateMany({
        where: { id: orgId, ...(delta < 0 ? { credits: { gte: -delta } } : {}) },
        data: { credits: { increment: delta } },
      });
      if (count === 0) {
        if (!(await tx.organization.findUnique({ where: { id: orgId }, select: { id: true } }))) throw notFound();
        throw new AppError(409, 'insufficient_credits', 'Firmanın kredisi bu kadar düşülemez; bakiye eksiye inemez.');
      }
      await tx.orgLedger.create({ data: { orgId, delta, reason: `admin: ${why}`, actorId } });
    });
    return this.detail(orgId);
  }

  async addMember(orgId: string, input: z.infer<typeof AddMemberSchema>) {
    if (!isUuid(orgId)) throw notFound();
    const userId = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, orgId);
      const user = await this.eligibleUser(tx, input.email);
      if (await tx.orgMember.findUnique({ where: { orgId_userId: { orgId, userId: user.id } } })) {
        throw new AppError(409, 'already_member', 'Bu kişi zaten firmanın üyesi.');
      }
      if ((await tx.orgMember.count({ where: { orgId } })) >= MAX_MEMBERS) throw new AppError(409, 'too_many_members', `Bir firmada en çok ${MAX_MEMBERS} üye olabilir.`);
      await tx.orgMember.create({ data: { orgId, userId: user.id, role: input.role, monthlyCap: input.monthlyCap } });
      return user.id;
    });
    return { detail: await this.detail(orgId), userId };
  }

  /**
   * Role and cap changes. Making someone OWNER is a transfer: the previous owner becomes ADMIN in the same
   * transaction. The owner's own role is changed only by such a transfer, so a firm never ends up with two owners
   * or (by an edit) none.
   */
  async updateMember(orgId: string, userId: string, input: z.infer<typeof UpdateMemberSchema>) {
    if (!isUuid(orgId) || !isUuid(userId)) throw notFound();
    const change = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, orgId);
      const member = await tx.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
      if (!member) throw notFound();
      const data: { role?: OrgRole; monthlyCap?: number | null } = {};
      let previousOwner: string | null = null;
      if (input.role && input.role !== member.role) {
        if (member.role === 'OWNER') throw new AppError(409, 'owner_transfer_required', 'Sahibin rolü yalnız sahipliği başka bir üyeye devrederek değişir.');
        if (input.role === 'OWNER') {
          const owner = await tx.orgMember.findFirst({ where: { orgId, role: 'OWNER' } });
          if (owner) {
            await tx.orgMember.update({ where: { orgId_userId: { orgId, userId: owner.userId } }, data: { role: 'ADMIN' } });
            previousOwner = owner.userId;
          }
        }
        data.role = input.role;
      }
      if (input.monthlyCap !== undefined) data.monthlyCap = input.monthlyCap;
      await tx.orgMember.update({ where: { orgId_userId: { orgId, userId } }, data });
      return { from: { role: member.role, monthlyCap: member.monthlyCap }, to: data, previousOwner };
    });
    return { change };
  }

  async removeMember(orgId: string, userId: string) {
    if (!isUuid(orgId) || !isUuid(userId)) throw notFound();
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, orgId);
      const member = await tx.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
      if (!member) throw notFound();
      if (member.role === 'OWNER') throw new AppError(409, 'owner_transfer_required', 'Sahip çıkarılamaz; önce sahipliği başka bir üyeye devret.');
      await tx.orgMember.delete({ where: { orgId_userId: { orgId, userId } } });
    });
  }

  /** KVKK export: the firms this person belongs to (no other members' data). */
  async membershipsOf(userId: string) {
    const rows = await this.prisma.orgMember.findMany({ where: { userId }, include: { org: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map((m) => ({ organization: m.org.name, role: m.role, monthlyCap: m.monthlyCap, joinedAt: m.createdAt.toISOString() }));
  }

  // ------------------------------------------------------------------ step 2: invites (API.md §7.23)

  private inviteDto(i: OrgInvite) {
    return { id: i.id, email: i.email, role: i.role, monthlyCap: i.monthlyCap, expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString() };
  }

  /**
   * One pending invite per address and firm: inviting again replaces the old link. The link carries a random
   * token in the URL fragment (never sent to servers or logs); only its hash is stored. Built from WEB_APP_URL,
   * never from the request's Host (MAIL-01).
   */
  async invite(orgId: string, input: { email: string; role: 'ADMIN' | 'MEMBER'; monthlyCap: number | null }, invitedBy: string) {
    if (!isUuid(orgId)) throw notFound();
    const token = randomToken();
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, orgId);
      const org = await tx.organization.findUnique({ where: { id: orgId }, select: { name: true, status: true } });
      if (!org) throw notFound();
      if (org.status !== 'ACTIVE') throw new AppError(409, 'org_suspended', 'Firma askıda; davet gönderilemez.');
      const existing = await tx.user.findUnique({ where: { email: input.email }, select: { id: true, locale: true } });
      if (existing && (await tx.orgMember.findUnique({ where: { orgId_userId: { orgId, userId: existing.id } } }))) {
        throw new AppError(409, 'already_member', 'Bu kişi zaten firmanın üyesi.');
      }
      const now = new Date();
      await tx.orgInvite.updateMany({ where: { orgId, email: input.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } });
      const pending = await tx.orgInvite.count({ where: { orgId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } });
      if (pending >= MAX_PENDING_INVITES) throw new AppError(409, 'too_many_invites', `Aynı anda en çok ${MAX_PENDING_INVITES} bekleyen davet olabilir.`);
      const invite = await tx.orgInvite.create({
        data: { orgId, email: input.email, role: input.role, monthlyCap: input.monthlyCap, tokenHash: sha256(token), invitedBy, expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * DAY) },
      });
      return { invite, orgName: org.name, locale: existing?.locale ?? 'tr' };
    });
    this.sendInvite(created.invite.email, created.orgName, created.locale, token);
    return this.inviteDto(created.invite);
  }

  private sendInvite(to: string, orgName: string, locale: string, token: string) {
    const lang = contentLocale(locale);
    const url = `${this.cfg.WEB_APP_URL}${locale === 'tr' ? '' : `/${locale}`}/davet#token=${token}`;
    const copy =
      lang === 'tr'
        ? {
            subject: `${orgName} seni Casalume ekibine davet etti`,
            heading: 'Ekibe davet edildin',
            lines: [`${orgName}, Casalume'de seni firma çalışma alanına ekledi.`, `Daveti kabul etmek için bu adresle (${to}) giriş yap ya da kayıt ol. Bağlantı ${INVITE_TTL_DAYS} gün geçerlidir.`],
            cta: 'Daveti aç',
            footer: 'Bu daveti beklemiyorsan e-postayı yok sayabilirsin.',
          }
        : {
            subject: `${orgName} invited you to their Casalume team`,
            heading: "You're invited to a team",
            lines: [`${orgName} added you to their firm workspace on Casalume.`, `Sign in or sign up with this address (${to}) to accept. The link is valid for ${INVITE_TTL_DAYS} days.`],
            cta: 'Open the invitation',
            footer: "If you weren't expecting this, you can ignore this e-mail.",
          };
    const mail = renderActionMail({ to, subject: copy.subject, heading: copy.heading, lines: copy.lines, cta: copy.cta, url, footer: copy.footer });
    void this.mailer.send(mail).catch((e: Error) => log.warn('org_invite_mail_failed', { error: e.name }));
  }

  async revokeInvite(orgId: string, inviteId: string) {
    if (!isUuid(orgId) || !isUuid(inviteId)) throw notFound();
    const { count } = await this.prisma.orgInvite.updateMany({ where: { id: inviteId, orgId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count === 0) throw notFound();
  }

  private status(i: OrgInvite, now = new Date()) {
    return i.revokedAt ? 'revoked' : i.acceptedAt ? 'accepted' : i.expiresAt <= now ? 'expired' : 'pending';
  }

  /** What the invitation page shows to whoever holds the link: firm name, role and the masked address. */
  async lookupInvite(token: string) {
    const i = await this.prisma.orgInvite.findUnique({ where: { tokenHash: sha256(token) }, include: { org: { select: { name: true, status: true } } } });
    if (!i) throw new AppError(404, 'invite_not_found', 'Davet bulunamadı.');
    return { orgName: i.org.name, role: i.role, email: maskEmail(i.email), status: this.status(i), expiresAt: i.expiresAt.toISOString() };
  }

  /**
   * Single use (the claim is a conditional update), only for the address it was sent to, only by a registered,
   * verified, active, non-staff account. Accepting twice with the same account is harmless.
   */
  async acceptInvite(userId: string, token: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const invite = await tx.orgInvite.findUnique({ where: { tokenHash: sha256(token) } });
      if (!invite) throw new AppError(404, 'invite_not_found', 'Davet bulunamadı.');
      await this.lock(tx, invite.orgId);
      const org = await tx.organization.findUnique({ where: { id: invite.orgId }, select: { id: true, name: true, status: true } });
      if (!org) throw notFound();
      const state = this.status(invite);
      if (state === 'accepted' && invite.acceptedBy === userId) return { orgId: org.id, orgName: org.name, role: invite.role, already: true };
      if (state === 'revoked') throw new AppError(410, 'invite_revoked', 'Bu davet geri alınmış.');
      if (state === 'accepted') throw new AppError(410, 'invite_used', 'Bu davet daha önce kullanılmış.');
      if (state === 'expired') throw new AppError(410, 'invite_expired', 'Bu davetin süresi dolmuş; firmadan yeni davet iste.');
      if (org.status !== 'ACTIVE') throw new AppError(409, 'org_suspended', 'Firma şu an askıda.');
      const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true, isGuest: true, emailVerifiedAt: true, status: true, role: true } });
      if (!user || user.isGuest || !user.email) throw new AppError(403, 'registration_required', 'Daveti kabul etmek için kayıtlı bir hesapla giriş yap.');
      if (user.email !== invite.email) throw new AppError(403, 'invite_email_mismatch', `Bu davet ${maskEmail(invite.email)} adresine gönderildi; o adresle giriş yap.`);
      if (!user.emailVerifiedAt) throw new AppError(403, 'email_not_verified', 'Önce e-posta adresini doğrula.');
      if (user.status !== 'ACTIVE') throw new AppError(403, 'forbidden', 'Hesap askıya alınmış.');
      if (user.role !== 'USER') throw new AppError(422, 'staff_account', 'Yönetici hesapları firmaya katılmaz.');
      const member = await tx.orgMember.findUnique({ where: { orgId_userId: { orgId: org.id, userId } } });
      if (!member) {
        if ((await tx.orgMember.count({ where: { userId } })) >= MAX_ORGS_PER_USER) throw new AppError(409, 'too_many_orgs', `Bir kişi en çok ${MAX_ORGS_PER_USER} firmada olabilir.`);
        if ((await tx.orgMember.count({ where: { orgId: org.id } })) >= MAX_MEMBERS) throw new AppError(409, 'too_many_members', 'Firmanın üye sınırı dolu.');
      }
      const { count } = await tx.orgInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date(), acceptedBy: userId },
      });
      if (count === 0) throw new AppError(410, 'invite_used', 'Bu davet daha önce kullanılmış.');
      if (!member) await tx.orgMember.create({ data: { orgId: org.id, userId, role: invite.role, monthlyCap: invite.monthlyCap } });
      return { orgId: org.id, orgName: org.name, role: member?.role ?? invite.role, already: Boolean(member) };
    });
    log.info('org_invite_accepted', { orgId: result.orgId, userId, already: result.already });
    return result;
  }

  // ------------------------------------------------------------------ step 2: the firm workspace

  /** The caller's membership, or "not found" (never "forbidden": a firm's existence isn't revealed, AZ-01). */
  async membership(orgId: string, userId: string) {
    if (!isUuid(orgId)) throw notFound();
    const m = await this.prisma.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { org: true } });
    if (!m) throw notFound();
    return m;
  }

  /** A firm the caller may create designs in right now. */
  async workspace(orgId: string, userId: string) {
    const m = await this.membership(orgId, userId);
    if (m.org.status !== 'ACTIVE') throw new AppError(403, 'org_suspended', 'Firma çalışma alanı şu an askıda.');
    return m.org;
  }

  /**
   * Holds `units` from the firm's pool for one design, under the firm row lock: membership, firm status, the
   * member's monthly cap and the pool are all checked in the same transaction (BUS-01, AZ-01).
   */
  async charge(orgId: string, userId: string, units: number, refId: string) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: string; credits: number; memberMonthlyCap: number | null }>>`
        SELECT status, credits, "memberMonthlyCap" FROM "Organization" WHERE id = ${orgId}::uuid FOR UPDATE`;
      const org = rows[0];
      const member = org ? await tx.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } }) : null;
      if (!org || !member) throw notFound();
      if (org.status !== 'ACTIVE') throw new AppError(403, 'org_suspended', 'Firma çalışma alanı şu an askıda.');
      const limit = member.monthlyCap ?? org.memberMonthlyCap;
      if (limit !== null) {
        const sum = await tx.orgLedger.aggregate({
          where: { orgId, userId, reason: { in: ['generation', 'refund'] }, createdAt: { gte: monthStart() } },
          _sum: { delta: true },
        });
        const used = Math.max(0, -(sum._sum.delta ?? 0));
        if (used + units > limit) throw new AppError(402, 'member_cap_reached', `Bu ay firma alanındaki sınırın doldu (${used}/${limit}).`);
      }
      if (org.credits < units) throw new AppError(402, 'org_insufficient_credits', 'Firmanın kredisi bitti; firma yöneticine haber ver.');
      await tx.organization.update({ where: { id: orgId }, data: { credits: { decrement: units } } });
      await tx.orgLedger.create({ data: { orgId, userId, delta: -units, reason: 'generation', refId } });
    });
  }

  /** Gives held units back to the pool (failed or partly failed design), inside the caller's transaction. */
  async refund(orgId: string, userId: string, units: number, refId: string, tx: Prisma.TransactionClient) {
    if (units <= 0) return;
    await tx.organization.update({ where: { id: orgId }, data: { credits: { increment: units } } });
    await tx.orgLedger.create({ data: { orgId, userId, delta: units, reason: 'refund', refId } });
  }

  /** The caller's firms with what they may spend this month; the pool itself only for OWNER/ADMIN. */
  async myOrgs(userId: string) {
    const rows = await this.prisma.orgMember.findMany({ where: { userId }, include: { org: true }, orderBy: { createdAt: 'asc' } });
    const start = monthStart();
    return Promise.all(
      rows.map(async (m) => {
        const sum = await this.prisma.orgLedger.aggregate({
          where: { orgId: m.orgId, userId, reason: { in: ['generation', 'refund'] }, createdAt: { gte: start } },
          _sum: { delta: true },
        });
        const used = Math.max(0, -(sum._sum.delta ?? 0));
        const limit = m.monthlyCap ?? m.org.memberMonthlyCap;
        const manager = m.role === 'OWNER' || m.role === 'ADMIN';
        return {
          id: m.orgId, name: m.org.name, status: m.org.status, role: m.role,
          monthlyCap: limit, usedThisMonth: used, remainingThisMonth: limit === null ? null : Math.max(0, limit - used),
          credits: manager ? m.org.credits : null, joinedAt: m.createdAt.toISOString(),
        };
      }),
    );
  }

  /** Retention: finished invitations (accepted, revoked or expired) older than 90 days. */
  async purgeInvites(now = Date.now()) {
    const { count } = await this.prisma.orgInvite.deleteMany({
      where: { createdAt: { lt: new Date(now - 90 * DAY) }, OR: [{ acceptedAt: { not: null } }, { revokedAt: { not: null } }, { expiresAt: { lt: new Date(now) } }] },
    });
    return count;
  }

  // ------------------------------------------------------------------ step 3: the firm runs its own team

  private forbidden() {
    return new AppError(403, 'org_forbidden', 'Bu işlem için firma sahibi ya da yöneticisi olmalısın.');
  }

  /**
   * The team page. OWNER/ADMIN see e-mails, monthly use, pending invitations and the pool; a MEMBER sees names and
   * roles of the team and their own allowance only (colleagues' usage and addresses stay with the managers).
   */
  async team(orgId: string, actorId: string) {
    const me = await this.membership(orgId, actorId);
    const manager = me.role === 'OWNER' || me.role === 'ADMIN';
    const [members, usage, invites] = await Promise.all([
      this.prisma.orgMember.findMany({ where: { orgId }, include: { user: { select: { email: true, name: true } } }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] }),
      this.monthlyUsage(orgId),
      manager ? this.prisma.orgInvite.findMany({ where: { orgId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }) : Promise.resolve([]),
    ]);
    const org = me.org;
    const capOf = (m: { monthlyCap: number | null }) => m.monthlyCap ?? org.memberMonthlyCap;
    const myCap = capOf(me);
    const myUse = usage.get(actorId) ?? 0;
    return {
      id: org.id, name: org.name, status: org.status, role: me.role,
      credits: manager ? org.credits : null,
      memberMonthlyCap: manager ? org.memberMonthlyCap : null,
      you: { userId: actorId, monthlyCap: myCap, usedThisMonth: myUse, remainingThisMonth: myCap === null ? null : Math.max(0, myCap - myUse) },
      members: members.map((m) => ({
        userId: m.userId, name: m.user.name, role: m.role, you: m.userId === actorId,
        ...(manager ? { email: m.user.email, monthlyCap: m.monthlyCap, effectiveCap: capOf(m), usedThisMonth: usage.get(m.userId) ?? 0, joinedAt: m.createdAt.toISOString() } : {}),
      })),
      invites: invites.map((i) => this.inviteDto(i)),
    };
  }

  /** OWNER invites admins or members; an ADMIN invites members only. */
  async teamInvite(orgId: string, actorId: string, input: { email: string; role: 'ADMIN' | 'MEMBER'; monthlyCap: number | null }) {
    const me = await this.membership(orgId, actorId);
    if (me.role === 'MEMBER' || (me.role === 'ADMIN' && input.role !== 'MEMBER')) throw this.forbidden();
    return this.invite(orgId, input, actorId);
  }

  async teamRevokeInvite(orgId: string, actorId: string, inviteId: string) {
    const me = await this.membership(orgId, actorId);
    if (me.role === 'MEMBER') throw this.forbidden();
    await this.revokeInvite(orgId, inviteId);
  }

  /**
   * OWNER: roles (including handing over ownership) and caps of everyone else. ADMIN: caps of members only.
   * Nobody changes their own row here (an owner hands over, a member leaves).
   */
  async teamUpdateMember(orgId: string, actorId: string, targetId: string, input: { role?: OrgRole; monthlyCap?: number | null }) {
    const me = await this.membership(orgId, actorId);
    if (!isUuid(targetId)) throw notFound();
    if (targetId === actorId) throw new AppError(409, 'cannot_change_self', 'Kendi rolünü ya da sınırını buradan değiştiremezsin.');
    const target = await this.prisma.orgMember.findUnique({ where: { orgId_userId: { orgId, userId: targetId } } });
    if (!target) throw notFound();
    if (me.role === 'MEMBER') throw this.forbidden();
    if (me.role === 'ADMIN' && (input.role !== undefined || target.role !== 'MEMBER')) throw this.forbidden();
    const { change } = await this.updateMember(orgId, targetId, { ...input, reason: 'team' });
    return change;
  }

  /** OWNER removes admins and members; an ADMIN removes members. The owner is never removed (409). */
  async teamRemoveMember(orgId: string, actorId: string, targetId: string) {
    const me = await this.membership(orgId, actorId);
    if (!isUuid(targetId)) throw notFound();
    if (targetId === actorId) throw new AppError(409, 'use_leave', 'Firmadan ayrılmak için "Firmadan ayrıl"ı kullan.');
    const target = await this.prisma.orgMember.findUnique({ where: { orgId_userId: { orgId, userId: targetId } } });
    if (!target) throw notFound();
    if (me.role === 'MEMBER' || (me.role === 'ADMIN' && target.role !== 'MEMBER')) throw this.forbidden();
    await this.removeMember(orgId, targetId);
  }

  /** Anyone but the owner may leave; their firm designs stay with the firm and are no longer reachable to them. */
  async leave(orgId: string, actorId: string) {
    const me = await this.membership(orgId, actorId);
    if (me.role === 'OWNER') throw new AppError(409, 'owner_transfer_required', 'Sahip firmadan ayrılamaz; önce sahipliği devret.');
    await this.removeMember(orgId, actorId);
  }
}

/** "ayse@example.com" → "a***@example.com": enough to recognise one's own address, not to harvest it. */
export function maskEmail(email: string) {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

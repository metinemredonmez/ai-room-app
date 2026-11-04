import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors.js';
import { todayInIstanbul } from '../common/http.js';
import { PrismaService } from '../common/infra.js';
import type { OrgRole, Prisma } from '../generated/prisma/client.js';
import { isUuid } from '../images/images.service.js';

// Corporate workspaces (API.md §7.23), step 1: firms, roles and the shared credit pool, run from the admin panel.
// Rules: one OWNER per firm (changed only by a transfer), members are registered, verified, active, non-staff
// accounts; the pool never goes below zero (conditional update + CHECK constraint); every change has a reason and is
// audited by the controller.

export const MAX_MEMBERS = 200;
export const MAX_ORGS_PER_USER = 10;

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
  constructor(private prisma: PrismaService) {}

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
    return { detail: await this.detail(orgId), change };
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
    return this.detail(orgId);
  }

  /** KVKK export: the firms this person belongs to (no other members' data). */
  async membershipsOf(userId: string) {
    const rows = await this.prisma.orgMember.findMany({ where: { userId }, include: { org: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map((m) => ({ organization: m.org.name, role: m.role, monthlyCap: m.monthlyCap, joinedAt: m.createdAt.toISOString() }));
  }
}

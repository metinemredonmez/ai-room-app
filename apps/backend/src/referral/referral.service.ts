import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { contentLocale } from '../catalog/catalog.data.js';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { CONFIG, type Config } from '../config.js';
import { Prisma, type ReferralStatus } from '../generated/prisma/client.js';
import { isUuid } from '../images/images.service.js';
import { PushService, type PushMessage } from '../push/push.service.js';
import { welcomeEmailKey } from '../users/welcome.service.js';
import { DEFAULT_REFERRAL, ReferralSettingsSchema, claimProblem, generateReferralCode, monthStartIstanbul, normalizeReferralCode, type ReferralSettings } from './referral.rules.js';

// Invite-a-friend (API.md §7.30). The invitee gets credits on entering a friend's code; the inviter only when the
// invitee's first design succeeds, up to a monthly cap — so fake sign-ups earn nothing (BUS-01). Each person can be
// invited once ever (keyed e-mail identity). Settings live in the Setting row `referral`, off by default.

const KEY = 'referral';
const REFRESH_MS = 15_000;

const PUSH = {
  tr: (n: number) => ({ title: 'Davet ödülü', body: `Davet ettiğin arkadaşın ilk tasarımını yaptı: ${n} kredi kazandın.` }),
  en: (n: number) => ({ title: 'Invite reward', body: `Your friend made their first design: you earned ${n} credits.` }),
};

@Injectable()
export class ReferralService implements OnModuleInit, OnModuleDestroy {
  private settings: ReferralSettings = DEFAULT_REFERRAL;
  private meta: { updatedAt: Date | null; updatedBy: string | null } = { updatedAt: null, updatedBy: null };
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService, private push: PushService, @Inject(CONFIG) private cfg: Config) {}

  async onModuleInit() {
    await this.reload().catch((e: Error) => log.warn('referral_load_failed', { error: e.name }));
    this.timer = setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reload() {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const parsed = row ? ReferralSettingsSchema.safeParse(row.value) : null;
    if (parsed && !parsed.success) log.error('referral_settings_invalid', { key: KEY });
    this.settings = parsed?.success ? parsed.data : DEFAULT_REFERRAL;
    this.meta = { updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  }

  get current() {
    return this.settings;
  }

  private identity(email: string) {
    return createHmac('sha256', this.cfg.DEVICE_PEPPER).update(`referral-id:${welcomeEmailKey(email)}`).digest('hex');
  }

  private link(code: string) {
    return `${this.cfg.WEB_APP_URL}/giris?ref=${code}`;
  }

  /** The caller's own code (made on first ask), what an invite pays and how it went. */
  async mine(userId: string) {
    const s = this.settings;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { referralCode: true, referredBy: { select: { status: true, inviteeCredits: true } } } });
    if (!user) throw notFound();
    const eligible = !user.isGuest && Boolean(user.email && user.emailVerifiedAt) && user.status === 'ACTIVE';
    let code = user.referralCode?.code ?? null;
    if (s.enabled && eligible && !code) code = await this.ensureCode(userId);
    const [invited, rewarded] = await Promise.all([
      this.prisma.referral.count({ where: { inviterId: userId } }),
      this.prisma.referral.aggregate({ where: { inviterId: userId, status: 'REWARDED' }, _count: { _all: true }, _sum: { inviterCredits: true } }),
    ]);
    return {
      enabled: s.enabled,
      code: s.enabled ? code : null,
      link: s.enabled && code ? this.link(code) : null,
      inviterCredits: s.inviterCredits,
      inviteeCredits: s.inviteeCredits,
      stats: { invited, rewarded: rewarded._count._all, earned: rewarded._sum.inviterCredits ?? 0 },
      canClaim: !user.referredBy && claimProblem(user, s) === null,
      claimed: user.referredBy ? { status: user.referredBy.status, credits: user.referredBy.inviteeCredits } : null,
    };
  }

  private async ensureCode(userId: string): Promise<string> {
    for (let i = 0; i < 5; i++) {
      try {
        return (await this.prisma.referralCode.create({ data: { userId, code: generateReferralCode() } })).code;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        const existing = await this.prisma.referralCode.findUnique({ where: { userId } }); // made by a parallel call
        if (existing) return existing.code;
      }
    }
    throw new AppError(503, 'busy', 'Davet kodu oluşturulamadı; yeniden dene.');
  }

  /** The invitee enters a friend's code: credits now, the friend's reward after the first design. */
  async claim(userId: string, raw: string) {
    const s = this.settings;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound();
    const problem = claimProblem(user, s);
    if (problem === 'disabled') throw new AppError(404, 'not_found', 'Davet programı şu an kapalı.');
    if (problem === 'verification_required') throw new AppError(403, 'verification_required', 'Davet kodu için kayıtlı ve e-postası doğrulanmış bir hesap gerekir.');
    if (problem === 'claim_closed') throw new AppError(409, 'claim_closed', `Davet kodu yalnız kayıttan sonraki ${s.claimDays} gün içinde girilebilir.`);
    const code = normalizeReferralCode(raw);
    const owner = code ? await this.prisma.referralCode.findUnique({ where: { code }, include: { user: true } }) : null;
    const inviter = owner?.user;
    if (!inviter || inviter.isGuest || !inviter.email || !inviter.emailVerifiedAt || inviter.status !== 'ACTIVE') {
      throw new AppError(404, 'invalid_code', 'Davet kodu geçersiz.');
    }
    const inviteeHash = this.identity(user.email!);
    if (inviter.id === userId || this.identity(inviter.email) === inviteeHash) throw new AppError(400, 'own_code', 'Kendi davet kodunu kullanamazsın.');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.referral.create({
          data: { inviterId: inviter.id, inviteeId: userId, inviteeIdentityHash: inviteeHash, inviteeCredits: s.inviteeCredits, inviterCredits: s.inviterCredits },
        });
        if (s.inviteeCredits > 0) {
          await tx.user.update({ where: { id: userId }, data: { credits: { increment: s.inviteeCredits } } });
          await tx.creditLedger.create({ data: { userId, delta: s.inviteeCredits, reason: 'referral_invitee', refId: inviter.id } });
        }
      });
    } catch (e) {
      // inviteeId and the identity are unique: a second claim, or the same mailbox invited before (BUS-02).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError(409, 'already_claimed', 'Bu hesap ya da e-posta daha önce davetle katıldı.');
      throw e;
    }
    log.info('referral_claimed', { inviteeId: userId, inviterId: inviter.id });
    return { credits: s.inviteeCredits };
  }

  /**
   * After a design succeeds: if this user joined by invitation and the inviter is not paid yet, pay once. The
   * PENDING → REWARDED update decides, so two parallel successes pay one reward. Over the monthly cap: REJECTED.
   */
  async onDesignSucceeded(userId: string) {
    const pending = await this.prisma.referral.findFirst({ where: { inviteeId: userId, status: 'PENDING' } });
    if (!pending || !pending.inviterId) return;
    const inviterId = pending.inviterId;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${inviterId}::uuid FOR UPDATE`;
      const thisMonth = await tx.referral.count({ where: { inviterId, status: 'REWARDED', rewardedAt: { gte: monthStartIstanbul() } } });
      const capped = thisMonth >= this.settings.monthlyCap;
      const claimed = await tx.referral.updateMany({
        where: { id: pending.id, status: 'PENDING' },
        data: capped ? { status: 'REJECTED', rejectReason: 'Aylık davet ödülü sınırı doldu' } : { status: 'REWARDED', rewardedAt: new Date() },
      });
      if (claimed.count !== 1 || capped) return null;
      await tx.user.update({ where: { id: inviterId }, data: { credits: { increment: pending.inviterCredits } } });
      await tx.creditLedger.create({ data: { userId: inviterId, delta: pending.inviterCredits, reason: 'referral_inviter', refId: pending.id } });
      return pending.inviterCredits;
    });
    if (result === null) return;
    log.info('referral_rewarded', { referralId: pending.id, inviterId });
    const inviter = await this.prisma.user.findUnique({ where: { id: inviterId }, select: { locale: true, pushTokens: { select: { token: true } } } });
    if (inviter?.pushTokens.length) {
      const c = PUSH[contentLocale(inviter.locale)](result);
      const messages: PushMessage[] = inviter.pushTokens.map(({ token }) => ({
        to: token, ...c, sound: 'default', priority: 'high', channelId: 'designs', data: { type: 'referral', path: '/hesap' },
      }));
      void this.push.send(messages).catch((e: Error) => log.warn('referral_push_failed', { error: e.name }));
    }
  }

  // ------------------------------------------------------------------------------------------------ admin

  async forAdmin(status?: ReferralStatus) {
    await this.reload();
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [items, claims30, rewarded30, pending, top, editor] = await Promise.all([
      this.prisma.referral.findMany({
        where: status ? { status } : {},
        include: { inviter: { select: { id: true, email: true } }, invitee: { select: { id: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.referral.count({ where: { createdAt: { gte: since } } }),
      this.prisma.referral.aggregate({ where: { status: 'REWARDED', rewardedAt: { gte: since } }, _count: { _all: true }, _sum: { inviterCredits: true } }),
      this.prisma.referral.count({ where: { status: 'PENDING' } }),
      this.prisma.referral.groupBy({ by: ['inviterId'], where: { status: 'REWARDED', inviterId: { not: null } }, _count: { _all: true }, orderBy: { _count: { inviterId: 'desc' } }, take: 10 }),
      this.meta.updatedBy ? this.prisma.user.findUnique({ where: { id: this.meta.updatedBy }, select: { name: true, email: true } }) : null,
    ]);
    const topUsers = await this.prisma.user.findMany({ where: { id: { in: top.map((t) => t.inviterId!).filter(Boolean) } }, select: { id: true, email: true } });
    const credits30 = await this.prisma.creditLedger.aggregate({ where: { reason: { in: ['referral_invitee', 'referral_inviter'] }, createdAt: { gte: since } }, _sum: { delta: true } });
    return {
      settings: this.settings,
      version: this.meta.updatedAt?.toISOString() ?? null,
      updatedAt: this.meta.updatedAt?.toISOString() ?? null,
      updatedBy: editor ? (editor.name ?? editor.email) : null,
      stats: { claims30, rewarded30: rewarded30._count._all, credits30: credits30._sum.delta ?? 0, pending },
      top: top.map((t) => ({ userId: t.inviterId, email: topUsers.find((u) => u.id === t.inviterId)?.email ?? null, rewarded: t._count._all })),
      items: items.map((r) => ({
        id: r.id, status: r.status, inviteeCredits: r.inviteeCredits, inviterCredits: r.inviterCredits, rejectReason: r.rejectReason,
        createdAt: r.createdAt.toISOString(), rewardedAt: r.rewardedAt?.toISOString() ?? null,
        inviter: r.inviter ? { id: r.inviter.id, email: r.inviter.email } : null,
        invitee: r.invitee ? { id: r.invitee.id, email: r.invitee.email } : null,
      })),
    };
  }

  async saveSettings(next: ReferralSettings, version: string | null, actorId: string) {
    const previous = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      if ((row?.updatedAt.toISOString() ?? null) !== version) throw new AppError(409, 'version_conflict', 'Ayar bu arada değişti; sayfayı yenileyip yeniden dene.');
      const value = next as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      const prev = row ? ReferralSettingsSchema.safeParse(row.value) : null;
      return prev?.success ? prev.data : DEFAULT_REFERRAL;
    });
    await this.reload();
    return { previous };
  }

  /** Staff stop an inviter's reward (suspected fake sign-up); the invitee keeps what they got. */
  async reject(id: string, reason: string) {
    if (!isUuid(id)) throw notFound();
    const r = await this.prisma.referral.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', rejectReason: reason.slice(0, 200) } });
    if (r.count !== 1) {
      if (!(await this.prisma.referral.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
      throw new AppError(409, 'not_pending', 'Yalnız ödül bekleyen davet reddedilebilir.');
    }
  }
}

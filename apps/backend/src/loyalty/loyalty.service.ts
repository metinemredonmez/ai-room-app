import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { contentLocale } from '../catalog/catalog.data.js';
import { AppError } from '../common/errors.js';
import { todayInIstanbul } from '../common/http.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { Prisma } from '../generated/prisma/client.js';
import { PushService, type PushMessage } from '../push/push.service.js';
import { anniversaryKeys, loyaltyDiff, parseLoyalty, PUSH_TEXT, streakPays, type LoyaltyRule, type LoyaltySettings, DEFAULT_LOYALTY } from './loyalty.rules.js';

// Automatic loyalty gifts (API.md §7.35). Settings live in one Setting row (refreshed every 15 s, saved under a lock
// with the loaded version, BUS-02). The streak is counted on the first request of each Istanbul day (UserGuard); the
// anniversary and win-back gifts are given by the daily `loyalty` job.

const KEY = 'loyalty.rules';
const REFRESH_MS = 15_000;
const CHUNK = 500;
const DAY = 86_400_000;
/** Real, reachable people only: the same base as the group gifts (API.md §7.32). */
const PEOPLE = Prisma.sql`u.role = 'USER' AND u.status = 'ACTIVE' AND u."isGuest" = false AND u."emailVerifiedAt" IS NOT NULL`;

@Injectable()
export class LoyaltyService implements OnModuleInit, OnModuleDestroy {
  private settings: LoyaltySettings = DEFAULT_LOYALTY;
  private meta: { updatedAt: Date | null; updatedBy: string | null } = { updatedAt: null, updatedBy: null };
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService, private push: PushService) {}

  async onModuleInit() {
    await this.reload().catch((e: Error) => log.warn('loyalty_load_failed', { error: e.name }));
    this.timer = setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reload() {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const { settings, ok } = parseLoyalty(row?.value);
    if (!ok) log.error('loyalty_invalid', { key: KEY });
    this.settings = settings;
    this.meta = { updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  }

  get current(): LoyaltySettings {
    return this.settings;
  }

  // ---- streak (called by UserGuard on the first request of an Istanbul day) ----

  /**
   * Moves the streak in one statement: yesterday → +1, today → unchanged (no row comes back), otherwise 1. Two requests
   * at the same moment cannot both count the day: the second finds streakDay already today and updates nothing.
   */
  async activeDay(userId: string, now = new Date()) {
    const today = todayInIstanbul(now);
    const yesterday = todayInIstanbul(new Date(now.getTime() - DAY));
    const rows = await this.prisma.$queryRaw<Array<{ streak: number; eligible: boolean }>>`
      UPDATE "User" u SET
        "streakDays" = CASE WHEN u."streakDay" = ${yesterday} THEN u."streakDays" + 1 ELSE 1 END,
        "streakDay" = ${today}
      WHERE u.id = ${userId}::uuid AND u."streakDay" IS DISTINCT FROM ${today}
      RETURNING u."streakDays" AS streak, (${PEOPLE}) AS eligible`;
    const row = rows[0];
    const rule = this.settings.streak;
    if (!row || !rule.enabled || !row.eligible || !streakPays(row.streak, rule.days)) return { streak: row?.streak ?? null, granted: false };
    const granted = await this.grant('streak', today, rule.credits, [userId]);
    if (granted.length) {
      log.info('loyalty_streak', { userId, streak: row.streak });
      void this.notify('streak', granted, rule.credits, rule.days).catch((e: Error) => log.warn('loyalty_push_failed', { rule: 'streak', error: e.name }));
    }
    return { streak: row.streak, granted: granted.length > 0 };
  }

  // ---- daily job: anniversary and win-back ----

  /** Who the daily job would pay today (the admin's preview). */
  async preview(now = new Date()) {
    const s = this.settings;
    const [ann, win] = await Promise.all([
      this.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM "User" u WHERE ${this.anniversaryWhere(now)}`,
      this.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM "User" u WHERE ${this.winbackWhere(now, s)}`,
    ]);
    const winback = Number(win[0]?.n ?? 0);
    return { anniversary: Number(ann[0]?.n ?? 0), winback: Math.min(winback, s.winback.dailyCap), winbackWaiting: winback };
  }

  /** The `loyalty` maintenance job (and the admin's "run now"): safe to repeat, nobody is paid twice. */
  async runDaily(now = new Date()) {
    const s = this.settings;
    const today = todayInIstanbul(now);
    const out = { anniversary: 0, winback: 0 };
    if (s.anniversary.enabled) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string; years: number }>>`
        SELECT u.id, EXTRACT(YEAR FROM age(${now}::timestamp, u."createdAt"))::int AS years FROM "User" u WHERE ${this.anniversaryWhere(now)} ORDER BY u.id`;
      for (const years of [...new Set(rows.map((r) => r.years))]) {
        const ids = rows.filter((r) => r.years === years).map((r) => r.id);
        const granted = await this.grant('anniversary', today.slice(0, 4), s.anniversary.credits, ids);
        out.anniversary += granted.length;
        if (granted.length) void this.notify('anniversary', granted, s.anniversary.credits, years).catch((e: Error) => log.warn('loyalty_push_failed', { rule: 'anniversary', error: e.name }));
      }
    }
    if (s.winback.enabled) {
      // Those who stopped most recently first: they are the likeliest to come back.
      const ids = (
        await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT u.id FROM "User" u WHERE ${this.winbackWhere(now, s)}
          ORDER BY COALESCE(u."lastSeenAt", u."createdAt") DESC LIMIT ${s.winback.dailyCap}`
      ).map((r) => r.id);
      const granted = await this.grant('winback', today, s.winback.credits, ids);
      out.winback = granted.length;
      if (granted.length) void this.notify('winback', granted, s.winback.credits, 0).catch((e: Error) => log.warn('loyalty_push_failed', { rule: 'winback', error: e.name }));
    }
    log.info('loyalty_daily', out);
    return out;
  }

  private anniversaryWhere(now: Date): Prisma.Sql {
    const today = todayInIstanbul(now);
    const keys = anniversaryKeys(today);
    return Prisma.sql`${PEOPLE} AND u."createdAt" < ${new Date(now.getTime() - 300 * DAY)}
      AND NOT EXISTS (SELECT 1 FROM "LoyaltyGrant" g WHERE g."userId" = u.id AND g.rule = 'anniversary' AND g."periodKey" = ${today.slice(0, 4)})
      AND to_char((u."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul', 'MM-DD') IN (${Prisma.join(keys)})`;
  }

  private winbackWhere(now: Date, s: LoyaltySettings): Prisma.Sql {
    return Prisma.sql`${PEOPLE} AND COALESCE(u."lastSeenAt", u."createdAt") < ${new Date(now.getTime() - s.winback.inactiveDays * DAY)}
      AND NOT EXISTS (SELECT 1 FROM "LoyaltyGrant" g WHERE g."userId" = u.id AND g.rule = 'winback' AND g."createdAt" > ${new Date(now.getTime() - s.winback.cooldownDays * DAY)})`;
  }

  /** Grant row, credits and ledger line in one statement per chunk; people already paid for this period are skipped. */
  private async grant(rule: LoyaltyRule, periodKey: string, credits: number, ids: string[]): Promise<string[]> {
    const paid: string[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const rows = await this.prisma.$queryRaw<Array<{ userId: string }>>`
        WITH ins AS (
          INSERT INTO "LoyaltyGrant" (id, "userId", rule, "periodKey", credits)
          SELECT gen_random_uuid(), x, ${rule}, ${periodKey}, ${credits} FROM unnest(${chunk}::uuid[]) AS x
          ON CONFLICT DO NOTHING RETURNING id, "userId"
        ), upd AS (
          UPDATE "User" SET credits = credits + ${credits} WHERE id IN (SELECT "userId" FROM ins) RETURNING id
        )
        INSERT INTO "CreditLedger" (id, "userId", delta, reason, "refId", "createdAt")
        SELECT gen_random_uuid(), ins."userId", ${credits}, ${`loyalty:${rule}`}, ins.id::text, now() FROM ins JOIN upd ON upd.id = ins."userId"
        RETURNING "userId"`;
      paid.push(...rows.map((r) => r.userId));
    }
    return paid;
  }

  private async notify(rule: LoyaltyRule, ids: string[], credits: number, extra: number) {
    const custom = this.settings[rule].message;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const users = await this.prisma.user.findMany({ where: { id: { in: ids.slice(i, i + CHUNK) } }, select: { locale: true, pushTokens: { select: { token: true } } } });
      const messages: PushMessage[] = users.flatMap((u) => {
        const lang = contentLocale(u.locale) === 'tr' ? 'tr' : 'en';
        const text = PUSH_TEXT[rule][lang](credits, extra);
        return u.pushTokens.map(({ token }) => ({ to: token, title: text.title, body: custom[lang] || text.body, sound: 'default' as const, priority: 'high' as const, channelId: 'designs' as const, data: { type: 'gift', path: '/hesap' } }));
      });
      if (messages.length) await this.push.send(messages);
    }
  }

  // ---- admin ----

  async forAdmin() {
    await this.reload();
    const since = new Date(Date.now() - 30 * DAY);
    const [stats, lastRun, editor] = await Promise.all([
      this.prisma.$queryRaw<Array<{ rule: string; n30: bigint; credits30: bigint; total: bigint }>>`
        SELECT rule, COUNT(*) FILTER (WHERE "createdAt" >= ${since}) AS n30,
          COALESCE(SUM(credits) FILTER (WHERE "createdAt" >= ${since}), 0) AS credits30, COUNT(*) AS total
        FROM "LoyaltyGrant" GROUP BY rule`,
      this.prisma.jobRun.findFirst({ where: { name: 'loyalty' }, orderBy: { startedAt: 'desc' } }),
      this.meta.updatedBy ? this.prisma.user.findUnique({ where: { id: this.meta.updatedBy }, select: { name: true, email: true } }) : null,
    ]);
    const by = new Map(stats.map((r) => [r.rule, r]));
    return {
      settings: this.settings,
      stats: Object.fromEntries(
        (['streak', 'anniversary', 'winback'] as const).map((r) => [r, { last30: Number(by.get(r)?.n30 ?? 0), credits30: Number(by.get(r)?.credits30 ?? 0), total: Number(by.get(r)?.total ?? 0) }]),
      ),
      today: await this.preview(),
      lastRun: lastRun ? { at: lastRun.startedAt.toISOString(), status: lastRun.status, details: lastRun.details } : null,
      version: this.meta.updatedAt?.toISOString() ?? null,
      updatedAt: this.meta.updatedAt?.toISOString() ?? null,
      updatedBy: editor ? (editor.name ?? editor.email) : null,
    };
  }

  async save(next: LoyaltySettings, version: string | null, actorId: string) {
    const changes = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      if ((row?.updatedAt.toISOString() ?? null) !== version) {
        throw new AppError(409, 'version_conflict', 'Ayar bu arada değişti; sayfayı yenileyip yeniden dene.');
      }
      const prev = parseLoyalty(row?.value).settings;
      const value = next as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      return loyaltyDiff(prev, next);
    });
    await this.reload();
    return { changes };
  }
}

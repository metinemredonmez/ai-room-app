import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { inQuietHours } from '../broadcasts/broadcast.rules.js';
import { TEST_DELIVERY } from '../broadcasts/broadcast.mail.js';
import { BroadcastsService } from '../broadcasts/broadcasts.service.js';
import { AppError } from '../common/errors.js';
import { todayInIstanbul } from '../common/http.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { Prisma } from '../generated/prisma/client.js';
import { MailerService } from '../mail/mailer.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  DEFAULT_LIFECYCLE,
  inactiveWindow,
  LIFECYCLE_RULES,
  lifecycleDiff,
  MIN_GAP_DAYS,
  parseLifecycle,
  periodKey,
  signupWindow,
  type LifecycleRule,
  type LifecycleSettings,
} from './lifecycle.rules.js';

// Lifecycle e-mails (API.md §7.48). An hourly round mails the people who reached a step, one a second, inside the
// shared daily e-mail cap and outside the quiet hours. Every mail is a LifecycleSend row first (unique per person,
// step and period), so a rerun, a crash or a second worker never mails anyone twice for the same step.

const KEY = 'lifecycle.emails';
const REFRESH_MS = 15_000;
const DAY = 86_400_000;
const EMAIL_INTERVAL_MS = 1_000;
/** Longer than the longest win-back cooldown, so a purge never lets a step repeat early. */
export const LIFECYCLE_KEEP_DAYS = 400;
const PREVIEW_MAX = 5_000;

/** Real, verified, active people with an address: no guests, no staff, no App Review account. */
const PEOPLE = Prisma.sql`u.role = 'USER' AND u.status = 'ACTIVE' AND u."isGuest" = false AND u."emailVerifiedAt" IS NOT NULL AND u."reviewUntil" IS NULL AND u.email IS NOT NULL`;

type Candidate = { id: string; email: string; locale: string };

@Injectable()
export class LifecycleService implements OnModuleInit, OnModuleDestroy {
  private settings: LifecycleSettings = DEFAULT_LIFECYCLE;
  private meta: { updatedAt: Date | null; updatedBy: string | null } = { updatedAt: null, updatedBy: null };
  private timer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private broadcasts: BroadcastsService,
    private mailer: MailerService,
    private appSettings: SettingsService,
  ) {}

  async onModuleInit() {
    await this.reload().catch((e: Error) => log.warn('lifecycle_load_failed', { error: e.name }));
    this.timer = setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reload() {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const { settings, ok } = parseLifecycle(row?.value);
    if (!ok) log.error('lifecycle_invalid', { key: KEY });
    this.settings = settings;
    this.meta = { updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  }

  /** People who reached a step now and have not had it (nor any lifecycle mail in the last MIN_GAP_DAYS). */
  private candidates(rule: LifecycleRule, s: LifecycleSettings, limit: number, now: number) {
    const gap = new Date(now - MIN_GAP_DAYS * DAY);
    const fresh = Prisma.sql`NOT EXISTS (SELECT 1 FROM "LifecycleSend" g WHERE g."userId" = u.id AND g."createdAt" > ${gap})`;
    const finished = Prisma.sql`(SELECT COUNT(*) FROM "Design" d WHERE d."userId" = u.id AND d.status = 'SUCCEEDED')`;
    if (rule === 'inactive') {
      const w = inactiveWindow(s.inactive.inactiveDays, now);
      const cooldown = new Date(now - s.inactive.cooldownDays * DAY);
      return this.prisma.$queryRaw<Candidate[]>`
        SELECT u.id, u.email, u.locale FROM "User" u
        WHERE ${PEOPLE} AND ${fresh} AND u."lastSeenAt" >= ${w.from} AND u."lastSeenAt" < ${w.until} AND ${finished} > 0
          AND NOT EXISTS (SELECT 1 FROM "LifecycleSend" x WHERE x."userId" = u.id AND x.rule = 'inactive' AND x."createdAt" > ${cooldown})
        ORDER BY u."lastSeenAt" DESC LIMIT ${limit}`;
    }
    const w = signupWindow(rule === 'onboarding' ? s.onboarding.afterDays : s.firstResult.afterDays, now);
    const designs = rule === 'onboarding' ? Prisma.sql`${finished} = 0` : Prisma.sql`${finished} = 1`;
    return this.prisma.$queryRaw<Candidate[]>`
      SELECT u.id, u.email, u.locale FROM "User" u
      WHERE ${PEOPLE} AND ${fresh} AND u."createdAt" >= ${w.from} AND u."createdAt" < ${w.until} AND ${designs}
        AND NOT EXISTS (SELECT 1 FROM "LifecycleSend" x WHERE x."userId" = u.id AND x.rule = ${rule})
      ORDER BY u."createdAt" LIMIT ${limit}`;
  }

  private content(rule: LifecycleRule, s: LifecycleSettings, locale: string) {
    const r = s[rule];
    const lang = locale === 'tr' ? 'tr' : 'en';
    return { kind: 'MARKETING' as const, title: r.subject[lang], body: r.body[lang], link: r.link };
  }

  /** One hourly round. Returns what happened, for the job log. */
  async run(now = new Date()) {
    const s = this.settings;
    const rules = LIFECYCLE_RULES.filter((r) => s[r].enabled);
    if (!rules.length) return { skipped: 'off' };
    const b = this.appSettings.current.broadcast;
    if (inQuietHours(now, b.quietStart, b.quietEnd)) return { skipped: 'quiet_hours' };
    let left = Math.min(s.perRun, b.emailDailyCap - (await this.broadcasts.emailSentToday()));
    if (left <= 0) return { skipped: 'email_daily_cap' };
    const day = todayInIstanbul(now);
    const sent: Record<LifecycleRule, number> = { onboarding: 0, firstResult: 0, inactive: 0 };
    let failed = 0;
    const mailed = new Set<string>(); // one lifecycle mail per person per round, whatever the step
    for (const rule of rules) {
      if (left <= 0) break;
      const rows = await this.candidates(rule, s, left * 3, now.getTime());
      if (!rows.length) continue;
      const consented = await this.broadcasts.withMarketingConsent(rows.map((r) => r.id));
      for (const u of rows) {
        if (left <= 0) break;
        if (!consented.has(u.id) || mailed.has(u.id)) continue;
        let id: string;
        try {
          id = (await this.prisma.lifecycleSend.create({ data: { userId: u.id, rule, periodKey: periodKey(rule, day) }, select: { id: true } })).id;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue; // another round got there first
          throw e;
        }
        mailed.add(u.id);
        left--;
        try {
          await this.mailer.send(this.broadcasts.mailFor(this.content(rule, s, u.locale), { email: u.email, locale: u.locale }, id));
          await this.prisma.lifecycleSend.update({ where: { id }, data: { status: 'SENT' } });
          sent[rule]++;
        } catch (e) {
          log.warn('lifecycle_mail_failed', { rule, error: (e as Error).name });
          await this.prisma.lifecycleSend.update({ where: { id }, data: { status: 'FAILED' } });
          failed++;
        }
        await sleep(EMAIL_INTERVAL_MS);
      }
    }
    return { sent, failed };
  }

  // ---- admin ----

  async overview(now = new Date()) {
    await this.reload();
    const s = this.settings;
    const since = new Date(now.getTime() - 30 * DAY);
    const [byRule, editor, sentToday] = await Promise.all([
      this.prisma.lifecycleSend.groupBy({ by: ['rule', 'status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.meta.updatedBy ? this.prisma.user.findUnique({ where: { id: this.meta.updatedBy }, select: { name: true, email: true } }) : null,
      this.broadcasts.emailSentToday(),
    ]);
    // How many would get each step right now (with consent), whether the step is switched on or not.
    const waiting: Record<LifecycleRule, number> = { onboarding: 0, firstResult: 0, inactive: 0 };
    for (const rule of LIFECYCLE_RULES) {
      const rows = await this.candidates(rule, s, PREVIEW_MAX, now.getTime());
      waiting[rule] = rows.length ? (await this.broadcasts.withMarketingConsent(rows.map((r) => r.id))).size : 0;
    }
    const count = (rule: string, status: string) => byRule.find((r) => r.rule === rule && r.status === status)?._count._all ?? 0;
    const b = this.appSettings.current.broadcast;
    return {
      settings: s,
      version: this.meta.updatedAt?.toISOString() ?? null,
      updatedAt: this.meta.updatedAt?.toISOString() ?? null,
      updatedBy: editor ? (editor.name ?? editor.email) : null,
      last30: Object.fromEntries(LIFECYCLE_RULES.map((r) => [r, { sent: count(r, 'SENT'), failed: count(r, 'FAILED') }])),
      waiting,
      email: { sentToday, dailyCap: b.emailDailyCap, quietStart: b.quietStart, quietEnd: b.quietEnd, quietNow: inQuietHours(now, b.quietStart, b.quietEnd) },
    };
  }

  async save(next: LifecycleSettings, version: string | null, actorId: string) {
    const changes = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      if ((row?.updatedAt.toISOString() ?? null) !== version) {
        throw new AppError(409, 'version_conflict', 'Ayar bu arada değişti; sayfayı yenileyip yeniden dene.');
      }
      const diff = lifecycleDiff(parseLifecycle(row?.value).settings, next);
      if (!diff.length) return diff;
      const value = next as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      return diff;
    });
    await this.reload();
    return changes;
  }

  /** The step's mail, as written now (saved or not), to the admin's own address; its unsubscribe link does nothing. */
  async test(rule: LifecycleRule, draft: LifecycleSettings, locale: 'tr' | 'en', adminId: string) {
    const me = await this.prisma.user.findUnique({ where: { id: adminId }, select: { email: true } });
    if (!me?.email) throw new AppError(400, 'no_email', 'Hesabında e-posta adresi yok.');
    const c = this.content(rule, draft, locale);
    await this.mailer.send(this.broadcasts.mailFor({ ...c, title: `[Deneme] ${c.title}` }, { email: me.email, locale }, TEST_DELIVERY));
    return { sentTo: me.email };
  }

  async purge(now = Date.now()) {
    return (await this.prisma.lifecycleSend.deleteMany({ where: { createdAt: { lt: new Date(now - LIFECYCLE_KEEP_DAYS * DAY) } } })).count;
  }
}

import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomToken, sha256 } from '../auth/crypto.js';
import { CONFIG, type Config } from '../config.js';
import { AppError } from '../common/errors.js';
import { LIMITS, PrismaService, RateLimiter } from '../common/infra.js';
import { log } from '../common/log.js';
import { cursorArgs } from '../designs/designs.service.js';
import { Prisma, type WaitlistStatus } from '../generated/prisma/client.js';
import { isUuid } from '../images/images.service.js';
import { LegalService } from '../kvkk/legal.service.js';
import { MailerService } from '../mail/mailer.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  CONFIRM_TTL_MS,
  confirmMail,
  DEFAULT_WAITLIST,
  leaveKey,
  leaveSignature,
  maskEmail,
  MAX_CONFIRM_MAILS,
  normalizeEmail,
  parseWaitlistSettings,
  RESEND_GAP_MS,
  verifyLeaveSignature,
  webPath,
  type SignupInput,
  type WaitlistSettings,
} from './waitlist.rules.js';

// Waiting list and newsletter (API.md §7.47). The signup answers the same whatever the address's state, so the form
// cannot be used to learn who is on the list; a confirmed address gets no new mail from a repeat signup.

const KEY = 'waitlist';
const REFRESH_MS = 15_000;
const DAY = 86_400_000;

export const invalidLink = () => new AppError(400, 'invalid_token', 'Bağlantı geçersiz, kullanılmış ya da süresi dolmuş.');

@Injectable()
export class WaitlistService implements OnModuleInit, OnModuleDestroy {
  private settings: WaitlistSettings = DEFAULT_WAITLIST;
  private meta: { updatedAt: Date | null; updatedBy: string | null } = { updatedAt: null, updatedBy: null };
  private timer?: NodeJS.Timeout;
  private readonly key: Buffer;

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private legal: LegalService,
    private appSettings: SettingsService,
    private limiter: RateLimiter,
    @Inject(CONFIG) private cfg: Config,
  ) {
    this.key = leaveKey(cfg.JWT_SECRET);
  }

  async onModuleInit() {
    await this.reload().catch((e: Error) => log.warn('waitlist_settings_load_failed', { error: e.name }));
    this.timer = setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reload() {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const { settings, ok } = parseWaitlistSettings(row?.value);
    if (!ok) log.error('waitlist_settings_invalid', { key: KEY });
    this.settings = settings;
    this.meta = { updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  }

  /** What the web needs: whether the form shows, and the store links once the apps are out (Ayarlar → uygulama sürümleri). */
  get status() {
    const v = this.appSettings.current.appVersions;
    return { enabled: this.settings.enabled, stores: { ios: v.ios.storeUrl || null, android: v.android.storeUrl || null } };
  }

  // ---- public ----

  async signup(input: SignupInput, ip: string) {
    if (!this.settings.enabled) throw new AppError(403, 'waitlist_closed', 'Bekleme listesi şu an kapalı.');
    await this.limiter.hit(LIMITS.waitlistIp, ip);
    if (input.website) {
      log.info('waitlist_honeypot', {});
      return { ok: true };
    }
    const email = normalizeEmail(input.email);
    // Per address the limit answers silently: a 429 here would tell that someone asked for this address before.
    if (!(await this.limiter.allow(LIMITS.waitlistEmail, sha256(email)))) return { ok: true };
    const consentVersion = this.legal.versionOf('marketing').version;
    const token = randomToken(32);
    const now = new Date();
    const fresh = { locale: input.locale, platforms: input.platforms, source: input.source, consentVersion, confirmHash: sha256(token), confirmSentAt: now };

    let entry = await this.prisma.waitlistEntry.findUnique({ where: { email } });
    if (entry?.status === 'CONFIRMED') return { ok: true };
    if (entry?.status === 'PENDING' && ((entry.confirmSentAt && now.getTime() - entry.confirmSentAt.getTime() < RESEND_GAP_MS) || entry.confirmMails >= MAX_CONFIRM_MAILS)) {
      return { ok: true };
    }
    try {
      entry = entry
        ? await this.prisma.waitlistEntry.update({
            where: { id: entry.id },
            data: { ...fresh, status: 'PENDING', unsubscribedAt: null, confirmMails: entry.status === 'PENDING' ? { increment: 1 } : 1 },
          })
        : await this.prisma.waitlistEntry.create({ data: { email, ...fresh, confirmMails: 1 } });
    } catch (e) {
      // Two signups for one address at the same moment: the other one sends the mail.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: true };
      throw e;
    }
    const url = `${webPath(this.cfg.WEB_APP_URL, entry.locale, '/bekleme-listesi/onay')}#token=${token}`;
    await this.mailer.send(confirmMail(email, entry.locale, url)).catch((e: Error) => log.warn('waitlist_confirm_mail_failed', { error: e.name }));
    log.info('waitlist_signup', { source: input.source, platforms: input.platforms.length });
    return { ok: true };
  }

  /** Double opt-in: the token is claimed once, within 7 days of the mail. Returns the leave link for the thank-you page. */
  async confirm(token: string) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw invalidLink();
    const hash = sha256(token);
    const row = await this.prisma.waitlistEntry.findUnique({ where: { confirmHash: hash }, select: { id: true } });
    if (!row) throw invalidLink();
    // Claimed atomically on the same hash: of two parallel clicks only one wins.
    const claimed = await this.prisma.waitlistEntry.updateMany({
      where: { id: row.id, confirmHash: hash, status: 'PENDING', confirmSentAt: { gt: new Date(Date.now() - CONFIRM_TTL_MS) } },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmHash: null },
    });
    if (claimed.count !== 1) throw invalidLink();
    log.info('waitlist_confirmed', {});
    return { ok: true, leave: this.leaveParams(row.id) };
  }

  private leaveParams(id: string) {
    return { i: id, t: leaveSignature(id, this.key) };
  }

  /** Signed leave link (web page or RFC 8058 one-click). A valid link always answers done, even for a purged entry. */
  async leave(id: string, signature: string) {
    if (typeof id !== 'string' || typeof signature !== 'string' || !verifyLeaveSignature(id, signature, this.key)) throw invalidLink();
    if (isUuid(id)) {
      await this.prisma.waitlistEntry.updateMany({ where: { id, status: { not: 'UNSUBSCRIBED' } }, data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date(), confirmHash: null } });
    }
    log.info('waitlist_left', {});
    return { ok: true };
  }

  // ---- admin ----

  async list(q: { status?: WaitlistStatus; q?: string; cursor?: string; limit: number }, showEmail: boolean) {
    const where: Prisma.WaitlistEntryWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { email: { contains: normalizeEmail(q.q) } } : {}),
    };
    const rows = await this.prisma.waitlistEntry.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1, ...cursorArgs(q.cursor) });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((e) => ({
        id: e.id,
        email: showEmail ? e.email : maskEmail(e.email),
        locale: e.locale,
        platforms: e.platforms,
        source: e.source,
        status: e.status,
        consentVersion: e.consentVersion,
        createdAt: e.createdAt.toISOString(),
        confirmedAt: e.confirmedAt?.toISOString() ?? null,
        unsubscribedAt: e.unsubscribedAt?.toISOString() ?? null,
      })),
      nextCursor: rows.length > q.limit ? page[page.length - 1].id : null,
    };
  }

  async overview() {
    await this.reload();
    const [byStatus, byLocale, platforms, daily, editor] = await Promise.all([
      this.prisma.waitlistEntry.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.waitlistEntry.groupBy({ by: ['locale'], where: { status: 'CONFIRMED' }, _count: { _all: true } }),
      this.prisma.$queryRaw<Array<{ ios: bigint; android: bigint; any: bigint }>>`
        SELECT COUNT(*) FILTER (WHERE 'ios' = ANY(platforms)) AS ios, COUNT(*) FILTER (WHERE 'android' = ANY(platforms)) AS android,
          COUNT(*) FILTER (WHERE cardinality(platforms) = 0) AS any
        FROM "WaitlistEntry" WHERE status = 'CONFIRMED'`,
      this.prisma.$queryRaw<Array<{ day: string; signups: bigint; confirmed: bigint }>>`
        SELECT d::date::text AS day,
          (SELECT COUNT(*) FROM "WaitlistEntry" w WHERE ((w."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul')::date = d::date) AS signups,
          (SELECT COUNT(*) FROM "WaitlistEntry" w WHERE ((w."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul')::date = d::date) AS confirmed
        FROM generate_series(((now() AT TIME ZONE 'Europe/Istanbul')::date - 29), (now() AT TIME ZONE 'Europe/Istanbul')::date, '1 day') AS d
        ORDER BY d`,
      this.meta.updatedBy ? this.prisma.user.findUnique({ where: { id: this.meta.updatedBy }, select: { name: true, email: true } }) : null,
    ]);
    const count = (s: WaitlistStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const p = platforms[0];
    return {
      settings: this.settings,
      status: this.status,
      version: this.meta.updatedAt?.toISOString() ?? null,
      updatedAt: this.meta.updatedAt?.toISOString() ?? null,
      updatedBy: editor ? (editor.name ?? editor.email) : null,
      counts: { pending: count('PENDING'), confirmed: count('CONFIRMED'), unsubscribed: count('UNSUBSCRIBED') },
      byLocale: Object.fromEntries(byLocale.map((r) => [r.locale, r._count._all])),
      byPlatform: { ios: Number(p?.ios ?? 0), android: Number(p?.android ?? 0), any: Number(p?.any ?? 0) },
      daily: daily.map((d) => ({ day: d.day, signups: Number(d.signups), confirmed: Number(d.confirmed) })),
    };
  }

  async saveSettings(next: WaitlistSettings, version: string | null, actorId: string) {
    const changes = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      if ((row?.updatedAt.toISOString() ?? null) !== version) {
        throw new AppError(409, 'version_conflict', 'Ayar bu arada değişti; sayfayı yenileyip yeniden dene.');
      }
      const prev = parseWaitlistSettings(row?.value).settings;
      if (prev.enabled === next.enabled) return [];
      const value = next as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      return [`kayıt formu: ${prev.enabled ? 'açık' : 'kapalı'} → ${next.enabled ? 'açık' : 'kapalı'}`];
    });
    await this.reload();
    return changes;
  }

  /** KVKK: an address removed at its owner's request. Returns the masked address for the audit, or null. */
  async remove(id: string): Promise<string | null> {
    if (!isUuid(id)) return null;
    const row = await this.prisma.waitlistEntry.findUnique({ where: { id }, select: { email: true } });
    if (!row) return null;
    await this.prisma.waitlistEntry.delete({ where: { id } });
    return maskEmail(row.email);
  }

  /** Retention: unconfirmed addresses 7 days after the last mail, left ones 30 days after leaving (KVKK minimisation). */
  async purge(now = Date.now()) {
    const pending = await this.prisma.waitlistEntry.deleteMany({
      where: { status: 'PENDING', OR: [{ confirmSentAt: { lt: new Date(now - CONFIRM_TTL_MS) } }, { confirmSentAt: null, createdAt: { lt: new Date(now - CONFIRM_TTL_MS) } }] },
    });
    const left = await this.prisma.waitlistEntry.deleteMany({ where: { status: 'UNSUBSCRIBED', unsubscribedAt: { lt: new Date(now - 30 * DAY) } } });
    return pending.count + left.count;
  }
}

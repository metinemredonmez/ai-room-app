import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { statfs } from 'node:fs/promises';
import { AppError } from '../common/errors.js';
import { todayInIstanbul } from '../common/http.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { maskText, setErrorSink } from '../common/monitoring.js';
import { CONFIG, type Config } from '../config.js';
import { Prisma } from '../generated/prisma/client.js';
import { MailerService, renderActionMail } from '../mail/mailer.service.js';
import { UsageService } from '../usage/usage.service.js';
import { QueuesService } from '../jobs/queues.service.js';
import { scheduleStatus } from '../jobs/schedules.js';
import { alertsDiff, classify, DEFAULT_ALERTS, HOURLY_CAP, parseAlerts, type AlertKind, type AlertSettings, type ErrorContext } from './alerts.rules.js';

// Founder alerts (API.md §7.41). Errors reach us through reportError (setErrorSink): grouped by fingerprint, a new or
// re-opened group mails at once, a recurring one at most every `repeatMinutes`. Disk and the AI budget are checked
// every 15 minutes; purchases come from the billing processor. At most HOURLY_CAP mails an hour in total; the same
// alert (dedupe key) is sent once per its window. Mail goes to the SUPER_ADMINs and up to five extra addresses.

const KEY = 'alerts';
const BRAKE_TEXT: Record<string, string> = {
  off: 'Bütçe freni kapalı: üretim sürüyor.',
  free_single_variant: 'Fren açık: bütçe aşılınca ücretsiz kullanıcılar tek seçenekle üretir.',
  free_paused: 'Fren açık: bütçe aşılınca ücretsiz üretim durur.',
};
const REFRESH_MS = 15_000;
const CHECK_MS = 15 * 60_000;
const HOUR = 3_600_000;

@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private settings: AlertSettings = DEFAULT_ALERTS;
  private meta: { updatedAt: Date | null; updatedBy: string | null } = { updatedAt: null, updatedBy: null };
  private timers: NodeJS.Timeout[] = [];

  constructor(private prisma: PrismaService, private mailer: MailerService, private usage: UsageService, @Inject(CONFIG) private cfg: Config, private queues?: QueuesService) {}

  async onModuleInit() {
    await this.reload().catch((e: Error) => log.warn('alerts_load_failed', { error: e.name }));
    setErrorSink((error, ctx) => void this.recordError(error, ctx).catch((e: Error) => log.warn('alert_record_failed', { error: e.name })));
    if (this.cfg.NODE_ENV === 'test') return;
    this.timers.push(setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS));
    this.timers.push(setInterval(() => void this.checks().catch((e: Error) => log.warn('alert_checks_failed', { error: e.name })), CHECK_MS));
    this.timers.forEach((t) => t.unref());
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
    setErrorSink(null);
  }

  async reload() {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const { settings, ok } = parseAlerts(row?.value);
    if (!ok) log.error('alerts_invalid', { key: KEY });
    this.settings = settings;
    this.meta = { updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  }

  // ---- errors ----

  async recordError(error: unknown, ctx: ErrorContext = {}, now = new Date()) {
    const c = classify(error, ctx);
    const rows = await this.prisma.$queryRaw<Array<{ id: string; count: number; lastAlertedAt: Date | null }>>`
      INSERT INTO "ErrorGroup" (id, fingerprint, kind, name, message, location, "lastRequestId", "firstSeen", "lastSeen")
      VALUES (gen_random_uuid(), ${c.fingerprint}, ${c.kind}, ${c.name}, ${c.message}, ${c.location}, ${ctx.requestId?.slice(0, 64) ?? null}, ${now}, ${now})
      ON CONFLICT (fingerprint) DO UPDATE SET
        count = "ErrorGroup".count + 1, "lastSeen" = ${now}, "lastRequestId" = EXCLUDED."lastRequestId", "resolvedAt" = NULL
      RETURNING id, count, "lastAlertedAt"`;
    const g = rows[0];
    if (!g) return;
    const toggle = c.kind === 'job' ? this.settings.jobs.enabled : this.settings.errors.enabled;
    if (!toggle) return;
    const repeatMs = this.settings.errors.repeatMinutes * 60_000;
    const due = !g.lastAlertedAt || now.getTime() - g.lastAlertedAt.getTime() >= repeatMs;
    if (!due) return;
    // Claim the alert for this group, so two failing requests at the same moment send one mail.
    const claimed = await this.prisma.errorGroup.updateMany({
      where: { id: g.id, OR: [{ lastAlertedAt: null }, { lastAlertedAt: { lte: new Date(now.getTime() - repeatMs) } }] },
      data: { lastAlertedAt: now },
    });
    if (!claimed.count) return;
    const first = g.count === 1;
    await this.send(c.kind === 'job' ? 'job' : 'error', `err:${c.fingerprint}`, 0, {
      subject: `${first ? 'Yeni hata' : 'Hata sürüyor'}: ${c.name} — ${c.location}`.slice(0, 180),
      heading: first ? 'Yeni bir hata görüldü' : `Bu hata sürüyor (${g.count} kez)`,
      lines: [`${c.name}: ${c.message}`, `Yer: ${c.location}`, ...(ctx.requestId ? [`İstek: ${ctx.requestId}`] : [])],
      path: '/alerts',
    });
  }

  async resolve(id: string) {
    const r = await this.prisma.errorGroup.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: new Date(), lastAlertedAt: null } });
    if (!r.count) throw new AppError(404, 'not_found', 'Bulunamadı');
  }

  // ---- purchases (from the billing processor) ----

  purchase(e: { type: string; productId: string | null; price: number | null; currency: string | null; store: string | null; environment: string | null }) {
    if (!this.settings.purchases.enabled || (e.environment && e.environment !== 'PRODUCTION')) return;
    const price = e.price !== null ? `${e.price.toFixed(2)} ${e.currency ?? 'USD'}` : 'tutar yok';
    void this.send('purchase', `buy:${Date.now()}:${Math.random()}`, 0, {
      subject: `Satın alma: ${e.productId ?? '?'} (${price})`,
      heading: e.type === 'RENEWAL' ? 'Abonelik yenilendi' : 'Yeni satın alma',
      lines: [`Ürün: ${e.productId ?? '?'}`, `Tutar: ${price}`, `Mağaza: ${e.store ?? '?'}`],
      path: '/subscriptions',
    }).catch((err: Error) => log.warn('purchase_alert_failed', { error: err.name }));
  }

  // ---- periodic: disk and AI budget ----

  async checks(now = new Date()) {
    const s = this.settings;
    const out: Record<string, unknown> = {};
    if (s.disk.enabled) {
      const fs = await statfs(this.cfg.DATA_DIR).catch(() => null);
      if (fs) {
        const usedPct = Math.round((1 - fs.bavail / fs.blocks) * 100);
        out.diskPct = usedPct;
        if (usedPct >= s.disk.thresholdPct) {
          await this.send('disk', 'disk', 12 * HOUR, {
            subject: `Disk %${usedPct} dolu`,
            heading: 'Sunucu diski dolmak üzere',
            lines: [`Kullanılan: %${usedPct} (eşik %${s.disk.thresholdPct}).`, 'Eski görselleri ve yedekleri kontrol et; disk dolarsa yükleme ve tasarım durur.'],
            path: '/system',
          });
        }
      }
    }
    // API.md §7.42: a scheduler whose next run is long overdue means the worker stopped.
    if (s.jobs.enabled && this.queues) {
      const late = (await scheduleStatus(this.queues.maintenance, this.prisma).catch(() => [])).filter((j) => j.late);
      out.lateJobs = late.map((j) => j.name);
      for (const j of late) {
        await this.send('job', `late:${j.name}`, 6 * HOUR, {
          subject: `Zamanlı iş gecikti: ${j.name}`,
          heading: 'Bir zamanlı iş zamanında çalışmadı',
          lines: [`İş: ${j.name}`, `Beklenen: ${j.next ?? '?'}`, 'İşçi durmuş ya da takılmış olabilir; Sistem durumu ve pm2 loglarına bak.'],
          path: '/jobs',
        });
      }
    }
    if (s.budget.enabled) {
      const b = await this.usage.budget();
      out.budget = b.state;
      if (b.state !== 'normal') {
        await this.send('budget', `budget:${b.state}:${todayInIstanbul(now)}`, 24 * HOUR, {
          subject: b.state === 'exceeded' ? `AI bütçesi aşıldı ($${b.spentTodayUsd} / $${b.dailyBudgetUsd})` : `AI bütçesinin %80'i harcandı ($${b.spentTodayUsd} / $${b.dailyBudgetUsd})`,
          heading: b.state === 'exceeded' ? 'Günlük AI bütçesi aşıldı' : 'Günlük AI bütçesine yaklaşıldı',
          lines: [`Bugün: $${b.spentTodayUsd}, bütçe: $${b.dailyBudgetUsd}.`, BRAKE_TEXT[b.brakeMode] ?? ''],
          path: '/ai-costs',
        });
      }
    }
    return out;
  }

  // ---- sending ----

  private async recipients(): Promise<string[]> {
    const owners = this.settings.superAdmins
      ? (await this.prisma.user.findMany({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE', email: { not: null } }, select: { email: true } })).map((u) => u.email!)
      : [];
    return [...new Set([...owners, ...this.settings.extraRecipients])];
  }

  /** Sends one alert unless the same key went out within `windowMs` or the hourly cap is reached. */
  async send(kind: AlertKind, dedupeKey: string, windowMs: number, m: { subject: string; heading: string; lines: string[]; path: string }) {
    const now = Date.now();
    const [lastHour, same] = await Promise.all([
      this.prisma.alertLog.count({ where: { createdAt: { gte: new Date(now - HOUR) } } }),
      windowMs > 0 ? this.prisma.alertLog.count({ where: { dedupeKey, createdAt: { gte: new Date(now - windowMs) } } }) : Promise.resolve(0),
    ]);
    if (same > 0) return { sent: 0, reason: 'duplicate' as const };
    if (lastHour >= HOURLY_CAP) {
      log.warn('alert_capped', { kind });
      return { sent: 0, reason: 'capped' as const };
    }
    const to = await this.recipients();
    const subject = maskText(`[Casalume] ${m.subject}`).slice(0, 200);
    await this.prisma.alertLog.create({ data: { kind, subject, dedupeKey: dedupeKey.slice(0, 120), sentTo: to.length } });
    for (const address of to) {
      await this.mailer
        .send(renderActionMail({ to: address, subject, heading: m.heading, lines: m.lines.map(maskText), cta: 'Panelde aç', url: `${this.cfg.ADMIN_APP_URL}${m.path}`, footer: 'Kurucu uyarısı · ayarlar: Admin → Sistem → Uyarılar' }))
        .catch((e: Error) => log.warn('alert_mail_failed', { kind, error: e.name }));
    }
    log.info('alert_sent', { kind, recipients: to.length });
    return { sent: to.length, reason: 'sent' as const };
  }

  // ---- admin ----

  async forAdmin() {
    await this.reload();
    const [groups, recent, editor] = await Promise.all([
      this.prisma.errorGroup.findMany({ orderBy: [{ resolvedAt: { sort: 'asc', nulls: 'first' } }, { lastSeen: 'desc' }], take: 100 }),
      this.prisma.alertLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      this.meta.updatedBy ? this.prisma.user.findUnique({ where: { id: this.meta.updatedBy }, select: { name: true, email: true } }) : null,
    ]);
    return {
      settings: this.settings,
      recipients: await this.recipients(),
      errors: groups.map((g) => ({
        id: g.id, kind: g.kind, name: g.name, message: g.message, location: g.location, count: g.count,
        firstSeen: g.firstSeen.toISOString(), lastSeen: g.lastSeen.toISOString(), lastRequestId: g.lastRequestId, resolvedAt: g.resolvedAt?.toISOString() ?? null,
      })),
      recent: recent.map((a) => ({ id: a.id, kind: a.kind, subject: a.subject, sentTo: a.sentTo, createdAt: a.createdAt.toISOString() })),
      version: this.meta.updatedAt?.toISOString() ?? null,
      updatedAt: this.meta.updatedAt?.toISOString() ?? null,
      updatedBy: editor ? (editor.name ?? editor.email) : null,
    };
  }

  async save(next: AlertSettings, version: string | null, actorId: string) {
    const changes = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      if ((row?.updatedAt.toISOString() ?? null) !== version) throw new AppError(409, 'version_conflict', 'Ayar bu arada değişti; sayfayı yenileyip yeniden dene.');
      const prev = parseAlerts(row?.value).settings;
      const value = next as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      return alertsDiff(prev, next);
    });
    await this.reload();
    return { changes };
  }
}

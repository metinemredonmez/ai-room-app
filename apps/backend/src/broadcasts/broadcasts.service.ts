import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { AppError, notFound } from '../common/errors.js';
import { todayInIstanbul } from '../common/http.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import type { Broadcast, DeliveryStatus, Prisma } from '../generated/prisma/client.js';
import { isUuid } from '../images/images.service.js';
import { QueuesService } from '../jobs/queues.service.js';
import { ConsentsService } from '../kvkk/consents.service.js';
import { LegalService } from '../kvkk/legal.service.js';
import { MailerService } from '../mail/mailer.service.js';
import { PushRetryableError, PushService, type PushMessage } from '../push/push.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  AudienceSchema, PUSH_BODY_MAX, commercialSignals, inQuietHours, nextSendableTime,
  type Audience, type BroadcastInput, type Content,
} from './broadcast.rules.js';
import { TEST_DELIVERY, renderBroadcastMail, unsubscribeKey, unsubscribeSignature, verifyUnsubscribeSignature } from './broadcast.mail.js';

const DAY = 86_400_000;
const BATCH = 50; // users per send round; ≤ 10 devices each keeps one round within a few Expo requests
const MAX_AUDIENCE = 100_000;
const INSERT_CHUNK = 5_000;
const KEEP_DELIVERIES_DAYS = 180;
const EMAIL_INTERVAL_MS = 1_000; // one mail a second keeps the shared mail server's reputation safe

type Channel = 'PUSH' | 'EMAIL';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Admin "Toplu Gönderim" (fal-app broadcast, ported to Expo push). Safety rules carried over:
 * - a draft is claimed for sending with one conditional update, so two triggers never send it twice;
 * - MARKETING goes only to users whose marketing consent is valid *when the message is sent*, at most
 *   `weeklyMarketingCap` per user per 7 days, and never in the Istanbul quiet window;
 * - SERVICE text that reads like a commercial message is refused (6563 / İYS);
 * - delivery is at-most-once: a row is marked SENDING before Expo is called, and rows left SENDING by a
 *   crash are closed as `interrupted` instead of being sent again.
 */
@Injectable()
export class BroadcastsService {
  private unsubKey: Buffer;

  constructor(
    private prisma: PrismaService,
    private push: PushService,
    private mailer: MailerService,
    private settings: SettingsService,
    private queues: QueuesService,
    private legal: LegalService,
    private consents: ConsentsService,
    @Inject(CONFIG) private cfg: Config,
  ) {
    this.unsubKey = unsubscribeKey(cfg.JWT_SECRET);
  }

  // --- content and audience ---

  precheck(content: Pick<Content, 'title' | 'body' | 'link' | 'kind'> & { channel?: Channel }) {
    const signals = commercialSignals(content);
    return { signals, blocked: content.kind === 'SERVICE' && signals.length > 0 };
  }

  private assertContent(content: Pick<Content, 'title' | 'body' | 'link' | 'kind'> & { channel?: Channel }) {
    if (content.channel !== 'EMAIL' && content.body.length > PUSH_BODY_MAX) {
      throw new AppError(400, 'validation_failed', `Bildirim metni en çok ${PUSH_BODY_MAX} karakter olabilir`);
    }
    const check = this.precheck(content);
    if (check.blocked) {
      throw new AppError(422, 'looks_commercial', `Bu metin ticari ileti gibi görünüyor (${check.signals.join(', ')}); türünü "Kampanya" seç`);
    }
  }

  private where(a: Audience, channel: Channel, now = new Date()): Prisma.UserWhereInput {
    const pro: Prisma.UserWhereInput = {
      OR: [{ plan: 'PRO', OR: [{ planExpiresAt: null }, { planExpiresAt: { gt: now } }] }, { storeProUntil: { gt: now } }],
    };
    const and: Prisma.UserWhereInput[] = [
      // API.md §7.40: never the store review account (its address has no mailbox; it is not a customer).
      { status: 'ACTIVE', role: 'USER', reviewUntil: null },
      channel === 'EMAIL'
        ? { isGuest: false, email: { not: null }, emailVerifiedAt: { not: null } }
        : { pushTokens: { some: a.platform ? { platform: a.platform } : {} } },
    ];
    if (a.plan === 'PRO') and.push(pro);
    if (a.plan === 'FREE') and.push({ NOT: pro });
    if (a.locale) and.push({ locale: a.locale });
    if (a.accounts === 'registered') and.push({ isGuest: false });
    if (a.accounts === 'guests') and.push({ isGuest: true });
    if (a.inactiveDays) and.push({ OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - a.inactiveDays * DAY) } }] });
    if (a.activeDays) and.push({ lastSeenAt: { gte: new Date(now.getTime() - a.activeDays * DAY) } });
    if (a.registeredAfter) and.push({ createdAt: { gte: new Date(`${a.registeredAfter}T00:00:00+03:00`) } });
    if (a.registeredBefore) and.push({ createdAt: { lt: new Date(new Date(`${a.registeredBefore}T00:00:00+03:00`).getTime() + DAY) } });
    if (a.emails) and.push({ email: { in: a.emails.map((e) => e.trim().toLowerCase()) } });
    return { AND: and };
  }

  /** User ids whose latest marketing decision is a grant still valid for the published text. */
  /** Users whose latest marketing consent is granted and still valid (also used by lifecycle e-mails, §7.48). */
  async withMarketingConsent(userIds: string[]): Promise<Set<string>> {
    const ok = new Set<string>();
    for (let i = 0; i < userIds.length; i += INSERT_CHUNK) {
      const rows = await this.prisma.consent.findMany({
        where: { userId: { in: userIds.slice(i, i + INSERT_CHUNK) }, kind: 'marketing' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { userId: true, granted: true, version: true },
      });
      const seen = new Set<string>();
      for (const r of rows) {
        if (seen.has(r.userId)) continue;
        seen.add(r.userId);
        if (r.granted && this.legal.acceptanceValid('marketing', r.version)) ok.add(r.userId);
      }
    }
    return ok;
  }

  /** Marketing pushes each user already received in the last 7 days (other broadcasts). */
  private async marketingThisWeek(userIds: string[], excludeId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.broadcastDelivery.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds }, status: 'SENT', broadcastId: { not: excludeId },
        sentAt: { gte: new Date(Date.now() - 7 * DAY) }, broadcast: { kind: 'MARKETING' },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.userId, r._count._all]));
  }

  async estimate(audienceIn: unknown, kind: 'SERVICE' | 'MARKETING', channel: Channel = 'PUSH') {
    const audience = AudienceSchema.parse(audienceIn);
    const where = this.where(audience, channel);
    const withDevice = await this.prisma.user.count({ where });
    if (kind === 'SERVICE') return { withDevice, eligible: withDevice };
    const ids = (await this.prisma.user.findMany({ where, select: { id: true }, take: MAX_AUDIENCE })).map((u) => u.id);
    return { withDevice, eligible: (await this.withMarketingConsent(ids)).size };
  }

  // --- CRUD ---

  async create(input: BroadcastInput, actorId: string) {
    this.assertContent(input);
    const b = await this.prisma.broadcast.create({
      data: {
        title: input.title, body: input.body, link: input.link ?? null, kind: input.kind, channel: input.channel,
        audience: input.audience as Prisma.InputJsonValue, createdById: actorId,
      },
    });
    return this.toDto(b);
  }

  async update(id: string, input: BroadcastInput) {
    this.assertContent(input);
    const changed = await this.prisma.broadcast.updateMany({
      where: { id: this.uuid(id), status: { in: ['DRAFT', 'SCHEDULED'] } },
      data: { title: input.title, body: input.body, link: input.link ?? null, kind: input.kind, channel: input.channel, audience: input.audience as Prisma.InputJsonValue },
    });
    if (changed.count !== 1) throw await this.notEditable(id);
    return this.toDto(await this.get(id));
  }

  async schedule(id: string, at: Date) {
    if (at.getTime() < Date.now() + 60_000 || at.getTime() > Date.now() + 60 * DAY) {
      throw new AppError(400, 'validation_failed', 'Zaman en az 1 dakika sonra, en çok 60 gün içinde olmalı');
    }
    const b = await this.get(id);
    this.assertContent(b);
    const s = this.settings.current.broadcast;
    const when = b.kind === 'MARKETING' ? nextSendableTime(at, s.quietStart, s.quietEnd) : at;
    const changed = await this.prisma.broadcast.updateMany({
      where: { id: b.id, status: { in: ['DRAFT', 'SCHEDULED'] } },
      data: { status: 'SCHEDULED', scheduledAt: when },
    });
    if (changed.count !== 1) throw await this.notEditable(id);
    return this.toDto(await this.get(id));
  }

  async cancel(id: string) {
    const b = await this.get(id);
    const changed = await this.prisma.broadcast.updateMany({
      where: { id: b.id, status: { in: ['DRAFT', 'SCHEDULED', 'SENDING'] } },
      // A running send stops at its next round and then records its own finish time.
      data: { status: 'CANCELLED', ...(b.status === 'SENDING' ? {} : { finishedAt: new Date() }) },
    });
    if (changed.count !== 1) throw new AppError(409, 'conflict', 'Bu gönderim zaten bitmiş');
    return this.toDto(await this.get(id));
  }

  async remove(id: string) {
    const b = await this.get(id);
    const gone = await this.prisma.broadcast.deleteMany({ where: { id: b.id, status: { not: 'SENDING' } } });
    if (gone.count !== 1) throw new AppError(409, 'conflict', 'Gönderim sürerken silinemez; önce iptal et');
    return b;
  }

  async list(opts: { cursor?: string; limit: number }) {
    const rows = await this.prisma.broadcast.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      ...(opts.cursor && isUuid(opts.cursor) ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: { createdBy: { select: { email: true } } },
    });
    const page = rows.slice(0, opts.limit);
    return { items: page.map((b) => this.toDto(b, b.createdBy?.email ?? null)), nextCursor: rows.length > opts.limit ? page[page.length - 1].id : null };
  }

  async detail(id: string) {
    const b = await this.prisma.broadcast.findUnique({ where: { id: this.uuid(id) }, include: { createdBy: { select: { email: true } } } });
    if (!b) throw notFound();
    const [byReason, recent] = await Promise.all([
      this.prisma.broadcastDelivery.groupBy({ by: ['status', 'reason'], where: { broadcastId: b.id }, _count: { _all: true } }),
      this.prisma.broadcastDelivery.findMany({
        where: { broadcastId: b.id }, orderBy: [{ sentAt: 'desc' }, { id: 'asc' }], take: 50,
        select: { status: true, reason: true, devices: true, sentAt: true, openedAt: true, user: { select: { id: true, email: true } } },
      }),
    ]);
    return {
      ...this.toDto(b, b.createdBy?.email ?? null),
      breakdown: byReason.map((r) => ({ status: r.status, reason: r.reason, count: r._count._all })),
      recent: recent.map((r) => ({
        userId: r.user.id, email: r.user.email, status: r.status, reason: r.reason, devices: r.devices,
        sentAt: r.sentAt?.toISOString() ?? null, openedAt: r.openedAt?.toISOString() ?? null,
      })),
    };
  }

  // --- sending ---

  /** Claims the broadcast (DRAFT/SCHEDULED → SENDING), writes one delivery row per recipient and queues the send. */
  async start(id: string): Promise<ReturnType<BroadcastsService['toDto']>> {
    const b = await this.get(id);
    if (this.precheck(b).blocked && b.status === 'SCHEDULED') {
      // A scheduled send that no longer passes the content rule stops here instead of being retried every minute.
      await this.prisma.broadcast.updateMany({
        where: { id: b.id, status: 'SCHEDULED' },
        data: { status: 'FAILED', error: 'Metin ticari ileti gibi görünüyor; türü "Kampanya" olmalı', finishedAt: new Date() },
      });
    }
    this.assertContent(b);
    const s = this.settings.current.broadcast;
    if (b.kind === 'MARKETING' && inQuietHours(new Date(), s.quietStart, s.quietEnd)) {
      // Marketing never wakes anyone up: it moves to the end of the quiet window instead.
      const at = nextSendableTime(new Date(), s.quietStart, s.quietEnd);
      await this.prisma.broadcast.updateMany({ where: { id: b.id, status: { in: ['DRAFT', 'SCHEDULED'] } }, data: { status: 'SCHEDULED', scheduledAt: at } });
      return this.toDto(await this.get(id));
    }
    const claimed = await this.prisma.broadcast.updateMany({
      where: { id: b.id, status: { in: ['DRAFT', 'SCHEDULED'] } },
      data: { status: 'SENDING', startedAt: new Date(), error: null },
    });
    if (claimed.count !== 1) throw await this.notEditable(id);
    try {
      const audience = AudienceSchema.parse(b.audience);
      let ids = (await this.prisma.user.findMany({ where: this.where(audience, b.channel), select: { id: true }, take: MAX_AUDIENCE + 1 })).map((u) => u.id);
      if (ids.length > MAX_AUDIENCE) throw new AppError(422, 'audience_too_large', `Kitle ${MAX_AUDIENCE} kişiyi aşıyor; daralt`);
      if (b.kind === 'MARKETING') {
        const consented = await this.withMarketingConsent(ids);
        ids = ids.filter((u) => consented.has(u));
      }
      if (!ids.length) {
        const reach = b.channel === 'EMAIL' ? 'e-postası doğrulanmış' : 'cihazı kayıtlı';
        await this.finish(b.id, 'FAILED', b.kind === 'MARKETING' ? `Kitlede pazarlama izni veren ve ${reach} kullanıcı yok` : `Kitlede ${reach} kullanıcı yok`);
        return this.toDto(await this.get(id));
      }
      for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
        await this.prisma.broadcastDelivery.createMany({
          data: ids.slice(i, i + INSERT_CHUNK).map((userId) => ({ broadcastId: b.id, userId })),
          skipDuplicates: true,
        });
      }
      await this.prisma.broadcast.update({ where: { id: b.id }, data: { targetCount: ids.length } });
      await this.queues.broadcasts.add('send', { broadcastId: b.id }, { jobId: `broadcast-${b.id}` });
      log.info('broadcast_started', { broadcastId: b.id, kind: b.kind, targets: ids.length });
    } catch (e) {
      await this.finish(b.id, 'FAILED', e instanceof AppError ? e.message : 'Gönderim başlatılamadı');
      throw e;
    }
    return this.toDto(await this.get(id));
  }

  /** Worker: sends round by round until nothing is pending, then records the result. */
  async process(broadcastId: string) {
    await this.prisma.broadcastDelivery.updateMany({ where: { broadcastId, status: 'SENDING' }, data: { status: 'FAILED', reason: 'interrupted' } });
    for (;;) {
      const b = await this.prisma.broadcast.findUnique({ where: { id: broadcastId } });
      if (!b) return { gone: true };
      if (b.status === 'CANCELLED') {
        await this.prisma.broadcastDelivery.updateMany({ where: { broadcastId, status: 'PENDING' }, data: { status: 'CANCELLED', reason: 'cancelled' } });
        break;
      }
      if (b.status !== 'SENDING') return { skipped: b.status };
      // Marketing never wakes anyone up: a send that reaches the quiet hours pauses and due() resumes it after.
      if (this.quietFor(b)) return { paused: 'quiet_hours' };
      const batch = await this.prisma.broadcastDelivery.findMany({
        where: { broadcastId, status: 'PENDING' }, orderBy: { id: 'asc' }, take: BATCH, select: { id: true, userId: true },
      });
      if (!batch.length) break;
      await this.prisma.broadcastDelivery.updateMany({ where: { id: { in: batch.map((d) => d.id) }, status: 'PENDING' }, data: { status: 'SENDING' } });
      try {
        if (b.channel === 'EMAIL') {
          const stop = await this.emailRound(b, batch);
          if (stop) {
            await this.refreshCounters(broadcastId);
            return { paused: stop };
          }
        } else {
          await this.sendRound(b, batch);
        }
      } catch (e) {
        // Expo is rate limiting or down: give the round back and let BullMQ retry with backoff.
        if (e instanceof PushRetryableError) {
          await this.prisma.broadcastDelivery.updateMany({ where: { id: { in: batch.map((d) => d.id) }, status: 'SENDING' }, data: { status: 'PENDING' } });
        }
        throw e;
      }
      await this.refreshCounters(broadcastId);
      await sleep(200);
    }
    return this.complete(broadcastId);
  }

  /** True while a MARKETING broadcast may not be sent (Istanbul quiet hours). */
  private quietFor(b: Pick<Broadcast, 'kind'>, at = new Date()) {
    const s = this.settings.current.broadcast;
    return b.kind === 'MARKETING' && inQuietHours(at, s.quietStart, s.quietEnd);
  }

  /** Who may receive this marketing round, as skip reasons; SERVICE rounds skip nobody here. */
  private async marketingGate(b: Broadcast, userIds: string[]) {
    if (b.kind !== 'MARKETING') return () => null;
    const consented = await this.withMarketingConsent(userIds);
    const thisWeek = await this.marketingThisWeek(userIds, b.id);
    const cap = this.settings.current.broadcast.weeklyMarketingCap;
    return (userId: string) => (!consented.has(userId) ? 'consent_missing' : (thisWeek.get(userId) ?? 0) >= cap ? 'weekly_cap' : null);
  }

  /** E-mails sent today (Istanbul) by broadcasts and lifecycle mails (§7.48): one shared `emailDailyCap`. */
  async emailSentToday() {
    const since = new Date(`${todayInIstanbul()}T00:00:00+03:00`);
    const [broadcasts, lifecycle] = await Promise.all([
      this.prisma.broadcastDelivery.count({ where: { status: 'SENT', broadcast: { channel: 'EMAIL' }, sentAt: { gte: since } } }),
      this.prisma.lifecycleSend.count({ where: { status: 'SENT', createdAt: { gte: since } } }),
    ]);
    return broadcasts + lifecycle;
  }

  /**
   * E-mail round: one message a second through our own mail server, never more than `emailDailyCap` a day across
   * all broadcasts. A round takes ~50 s, so for MARKETING the quiet hours and the user's consent are checked again
   * right before each message (an unsubscribe during the round is honoured). Returns why the round stopped early —
   * `email_daily_cap` or `quiet_hours` — with the unsent rows back in PENDING for the scheduler to resume, or null.
   */
  private async emailRound(b: Broadcast, batch: Array<{ id: string; userId: string }>): Promise<'email_daily_cap' | 'quiet_hours' | null> {
    const left = this.settings.current.broadcast.emailDailyCap - (await this.emailSentToday());
    const now = batch.slice(0, Math.max(0, left));
    const later = batch.slice(now.length).map((d) => d.id);
    const giveBack = (ids: string[]) =>
      ids.length ? this.prisma.broadcastDelivery.updateMany({ where: { id: { in: ids }, status: 'SENDING' }, data: { status: 'PENDING' } }) : null;
    await giveBack(later);
    if (!now.length) return 'email_daily_cap';
    const users = new Map(
      (await this.prisma.user.findMany({
        where: { id: { in: now.map((d) => d.userId) } },
        select: { id: true, status: true, email: true, emailVerifiedAt: true, locale: true },
      })).map((u) => [u.id, u]),
    );
    const gate = await this.marketingGate(b, now.map((d) => d.userId));
    for (const [i, d] of now.entries()) {
      if (this.quietFor(b)) {
        await giveBack(now.slice(i).map((x) => x.id));
        return 'quiet_hours';
      }
      const u = users.get(d.userId);
      let reason = !u || u.status !== 'ACTIVE' ? 'inactive' : !u.email || !u.emailVerifiedAt ? 'no_email' : gate(u.id);
      // Consent read again for this one message: it may have been withdrawn since the round started.
      if (!reason && b.kind === 'MARKETING' && !(await this.withMarketingConsent([u!.id])).has(u!.id)) reason = 'consent_missing';
      if (reason) {
        await this.prisma.broadcastDelivery.update({ where: { id: d.id }, data: { status: 'SKIPPED', reason } });
        continue;
      }
      try {
        await this.mailer.send(this.mailFor(b, { email: u!.email!, locale: u!.locale }, d.id));
        await this.prisma.broadcastDelivery.update({ where: { id: d.id }, data: { status: 'SENT', devices: 1, sentAt: new Date() } });
      } catch (e) {
        log.warn('broadcast_mail_failed', { broadcastId: b.id, error: (e as Error).name });
        await this.prisma.broadcastDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', reason: 'provider_error' } });
      }
      await sleep(EMAIL_INTERVAL_MS);
    }
    return later.length > 0 ? 'email_daily_cap' : null;
  }

  /** The e-mail for one delivery; lifecycle mails (§7.48) use it with their own send id as the delivery id. */
  mailFor(b: Pick<Broadcast, 'kind' | 'title' | 'body' | 'link'>, to: { email: string; locale: string }, deliveryId: string) {
    const sig = unsubscribeSignature(deliveryId, this.unsubKey);
    const q = `r=${encodeURIComponent(deliveryId)}&t=${encodeURIComponent(sig)}`;
    const marketing = b.kind === 'MARKETING';
    return renderBroadcastMail({
      to: to.email, locale: to.locale, kind: b.kind, subject: b.title, body: b.body,
      ctaUrl: b.link ? `${this.cfg.WEB_APP_URL}${b.link}` : null,
      unsubscribeUrl: marketing ? `${this.cfg.WEB_APP_URL}/abonelikten-cik?${q}` : null,
      oneClickUrl: marketing ? `${this.cfg.PUBLIC_BASE_URL}/v1/unsubscribe/one-click?${q}` : null,
      sender: { name: this.cfg.LEGAL_CONTROLLER_NAME, address: this.cfg.LEGAL_CONTROLLER_ADDRESS, email: this.cfg.LEGAL_CONTACT_EMAIL },
    });
  }

  /** Link in a marketing e-mail (web page or RFC 8058 one-click): withdraws the user's marketing consent. */
  async unsubscribe(deliveryId: string, signature: string, ip?: string) {
    if (typeof deliveryId !== 'string' || typeof signature !== 'string' || !verifyUnsubscribeSignature(deliveryId, signature, this.unsubKey)) {
      throw new AppError(400, 'invalid_link', 'Bağlantı geçersiz');
    }
    if (deliveryId === TEST_DELIVERY) return { ok: true };
    // A lifecycle e-mail (§7.48) carries its send id in the same link: ids are UUIDs, so the two never collide.
    const d = isUuid(deliveryId)
      ? ((await this.prisma.broadcastDelivery.findUnique({ where: { id: deliveryId }, select: { userId: true } })) ??
        (await this.prisma.lifecycleSend.findUnique({ where: { id: deliveryId }, select: { userId: true } })))
      : null;
    // The delivery row may be gone (180-day purge, account deleted): the link still answers "done".
    if (d) await this.consents.record(d.userId, 'marketing', this.legal.versionOf('marketing').version, false, ip);
    log.info('broadcast_unsubscribe', { found: Boolean(d) });
    return { ok: true };
  }

  private async sendRound(b: Broadcast, batch: Array<{ id: string; userId: string }>) {
    const audience = AudienceSchema.parse(b.audience);
    const userIds = batch.map((d) => d.userId);
    const users = new Map(
      (await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, status: true, pushTokens: { select: { token: true, platform: true } } },
      })).map((u) => [u.id, u]),
    );
    const gate = await this.marketingGate(b, userIds);

    const skipped = new Map<string, string>(); // delivery id → reason
    const tokensOf = new Map<string, string[]>(); // delivery id → tokens
    const messages: PushMessage[] = [];
    const data: Record<string, string> = { type: 'broadcast', broadcastId: b.id, kind: b.kind, ...(b.link ? { url: `casalume:/${b.link}`, path: b.link } : {}) };
    for (const d of batch) {
      const u = users.get(d.userId);
      const tokens = (u?.pushTokens ?? []).filter((t) => !audience.platform || t.platform === audience.platform).map((t) => t.token);
      if (!u || u.status !== 'ACTIVE') skipped.set(d.id, 'inactive');
      else if (!tokens.length) skipped.set(d.id, 'no_device');
      else if (gate(u.id)) skipped.set(d.id, gate(u.id)!);
      else {
        tokensOf.set(d.id, tokens);
        for (const to of tokens) messages.push({ to, title: b.title, body: b.body, data, sound: 'default', priority: 'high', channelId: 'news' });
      }
    }

    // At most once: a chunk that failed is reported as provider_error, never sent again; chunks that went out
    // before it count as SENT (not "interrupted").
    const out = messages.length ? await this.push.send(messages) : { receipts: {}, unsent: [], error: null };
    const receipts = out.receipts;
    const unsent = new Set(out.unsent.map((m) => m.to));
    const accepted = this.push.transport === 'outbox' ? new Set(messages.map((m) => m.to).filter((t) => !unsent.has(t))) : new Set(Object.values(receipts));
    const now = new Date();
    const updates: Prisma.PrismaPromise<unknown>[] = [];
    for (const [deliveryId, reason] of skipped) {
      updates.push(this.prisma.broadcastDelivery.update({ where: { id: deliveryId }, data: { status: 'SKIPPED', reason } }));
    }
    for (const [deliveryId, tokens] of tokensOf) {
      const ok = tokens.filter((t) => accepted.has(t)).length;
      updates.push(this.prisma.broadcastDelivery.update({
        where: { id: deliveryId },
        data: ok ? { status: 'SENT', devices: ok, sentAt: now } : { status: 'FAILED', reason: 'provider_error' },
      }));
    }
    await this.prisma.$transaction(updates);
    if (Object.keys(receipts).length) {
      await this.queues.notifications.add('push-receipts', { receipts }, { delay: 15 * 60_000, attempts: 2 }).catch(() => undefined);
    }
  }

  private async counts(broadcastId: string) {
    const rows = await this.prisma.broadcastDelivery.groupBy({ by: ['status'], where: { broadcastId }, _count: { _all: true } });
    const n = (s: DeliveryStatus) => rows.find((r) => r.status === s)?._count._all ?? 0;
    const opened = await this.prisma.broadcastDelivery.count({ where: { broadcastId, openedAt: { not: null } } });
    return { sent: n('SENT'), skipped: n('SKIPPED'), failed: n('FAILED'), open: n('PENDING') + n('SENDING'), opened };
  }

  private async refreshCounters(broadcastId: string) {
    const c = await this.counts(broadcastId);
    await this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: { sentCount: c.sent, skippedCount: c.skipped, failedCount: c.failed, openedCount: c.opened },
    });
    return c;
  }

  private async complete(broadcastId: string) {
    const c = await this.refreshCounters(broadcastId);
    const b = await this.prisma.broadcast.findUnique({ where: { id: broadcastId } });
    if (!b || c.open > 0) return c;
    if (b.status === 'CANCELLED') {
      await this.prisma.broadcast.update({ where: { id: broadcastId }, data: { finishedAt: new Date() } });
    } else if (b.status === 'SENDING') {
      const none = c.sent === 0;
      await this.finish(broadcastId, none ? 'FAILED' : 'SENT', none ? 'Hiçbir cihaza ulaşılamadı (izin, haftalık sınır ya da cihaz yok)' : null);
    }
    log.info('broadcast_finished', { broadcastId, ...c });
    return c;
  }

  private async finish(id: string, status: 'SENT' | 'FAILED', error: string | null) {
    await this.prisma.broadcast.updateMany({ where: { id, status: 'SENDING' }, data: { status, error, finishedAt: new Date() } });
  }

  /** Every minute: start what is due, and pick up sends a restart left behind. */
  async due() {
    const now = new Date();
    const scheduled = await this.prisma.broadcast.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } }, select: { id: true }, take: 20,
    });
    let started = 0;
    for (const { id } of scheduled) {
      await this.start(id).then(() => started++).catch((e: Error) => log.warn('broadcast_start_failed', { broadcastId: id, error: e.name }));
    }
    const stale = await this.prisma.broadcast.findMany({
      where: { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, select: { id: true, kind: true }, take: 20,
    });
    let resumed = 0;
    for (const { id, kind } of stale) {
      // A marketing send paused for the quiet hours stays paused until they end.
      if (this.quietFor({ kind }, now)) continue;
      const job = await this.queues.broadcasts.getJob(`broadcast-${id}`);
      const state = job ? await job.getState() : null;
      if (state === 'active' || state === 'waiting' || state === 'delayed') continue;
      await this.queues.broadcasts.add('send', { broadcastId: id }, { jobId: `broadcast-${id}-${now.getTime()}` });
      resumed++;
    }
    return { started, resumed };
  }

  /** The app reports that the user opened the notification; counted once per user. */
  async opened(broadcastId: string, userId: string) {
    if (!isUuid(broadcastId)) return;
    const marked = await this.prisma.broadcastDelivery.updateMany({
      where: { broadcastId, userId, status: 'SENT', openedAt: null },
      data: { openedAt: new Date() },
    });
    if (marked.count) await this.prisma.broadcast.update({ where: { id: broadcastId }, data: { openedCount: { increment: 1 } } });
  }

  /** Sends the draft text to one user's devices only (the admin's own app account); nothing is recorded as a delivery. */
  async test(content: Content, email: string) {
    this.assertContent(content);
    const user = await this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), status: 'ACTIVE' },
      select: { id: true, email: true, locale: true, pushTokens: { select: { token: true } } },
    });
    if (!user) throw new AppError(404, 'not_found', 'Bu e-postayla bir uygulama hesabı yok');
    if (content.channel === 'EMAIL') {
      await this.mailer.send(this.mailFor({ ...content, title: `[Test] ${content.title}`, link: content.link ?? null }, { email: user.email!, locale: user.locale }, TEST_DELIVERY));
      return { userId: user.id, devices: 1, accepted: 1 };
    }
    if (!user.pushTokens.length) throw new AppError(422, 'no_device', 'Bu hesapta bildirim izni verilmiş bir cihaz yok');
    const data: Record<string, string> = { type: 'broadcast', test: '1', ...(content.link ? { url: `casalume:/${content.link}`, path: content.link } : {}) };
    const messages: PushMessage[] = user.pushTokens.map(({ token }) => ({
      to: token, title: `[Test] ${content.title}`, body: content.body, data, sound: 'default', priority: 'high', channelId: 'news',
    }));
    const out = await this.push.send(messages);
    const accepted = this.push.transport === 'outbox' ? messages.length - out.unsent.length : Object.keys(out.receipts).length;
    return { userId: user.id, devices: messages.length, accepted };
  }

  /** KVKK data minimisation: per-user rows go after 180 days; the counters on the broadcast stay. */
  purgeOldDeliveries() {
    return this.prisma.broadcastDelivery.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_DELIVERIES_DAYS * DAY) } } });
  }

  // --- helpers ---

  private uuid(id: string) {
    if (!isUuid(id)) throw notFound();
    return id;
  }

  private async get(id: string) {
    const b = await this.prisma.broadcast.findUnique({ where: { id: this.uuid(id) } });
    if (!b) throw notFound();
    return b;
  }

  private async notEditable(id: string) {
    const b = await this.get(id);
    return new AppError(409, 'conflict', `Bu gönderim artık değiştirilemez (${b.status})`);
  }

  toDto(b: Broadcast, createdBy: string | null = null) {
    return {
      id: b.id, title: b.title, body: b.body, link: b.link, kind: b.kind, channel: b.channel, audience: b.audience, status: b.status,
      scheduledAt: b.scheduledAt?.toISOString() ?? null, startedAt: b.startedAt?.toISOString() ?? null,
      finishedAt: b.finishedAt?.toISOString() ?? null,
      counts: { target: b.targetCount, sent: b.sentCount, skipped: b.skippedCount, failed: b.failedCount, opened: b.openedCount },
      error: b.error, createdBy, createdAt: b.createdAt.toISOString(), updatedAt: b.updatedAt.toISOString(),
    };
  }
}

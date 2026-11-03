import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { CONFIG, type Config } from '../config.js';
import { safeEqual } from '../auth/crypto.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { Prisma } from '../generated/prisma/client.js';
import { QueuesService } from '../jobs/queues.service.js';
import { isUuid } from '../images/images.service.js';

// RevenueCat store billing (palemi billing/revenuecat + yoga revenueCat patterns). Order matters
// (yoga BE-01 lesson): authenticate the request BEFORE anything is written, then store the event once
// (event.id is the idempotency key — retries reuse it), answer 200 fast and process from the queue.

const RC_API = 'https://api.revenuecat.com/v1/subscribers/';
const SIGNATURE_TOLERANCE_SEC = 300;

export interface RcEvent {
  id: string;
  type: string;
  app_user_id?: string | null;
  original_app_user_id?: string | null;
  aliases?: string[] | null;
  transferred_to?: string[] | null;
  product_id?: string | null;
  entitlement_ids?: string[] | null;
  period_type?: string | null;
  expiration_at_ms?: number | null;
  grace_period_expiration_at_ms?: number | null;
  environment?: string | null;
  store?: string | null;
  transaction_id?: string | null;
  cancel_reason?: string | null;
}

interface RcSubscriber {
  subscriber?: {
    entitlements?: Record<string, { expires_date?: string | null; product_identifier?: string; grace_period_expires_date?: string | null }>;
    subscriptions?: Record<string, {
      expires_date?: string | null; period_type?: string; store?: string; is_sandbox?: boolean;
      unsubscribe_detected_at?: string | null; billing_issues_detected_at?: string | null; grace_period_expires_date?: string | null;
    }>;
    non_subscriptions?: Record<string, Array<{ id: string; store?: string; is_sandbox?: boolean }>>;
  };
}

@Injectable()
export class BillingService {
  private packs: Map<string, number>;

  constructor(private prisma: PrismaService, private queues: QueuesService, @Inject(CONFIG) private cfg: Config) {
    this.packs = new Map(
      cfg.CREDIT_PACKS.split(',')
        .map((p) => p.trim().split(':'))
        .filter(([id, n]) => id && Number(n) > 0)
        .map(([id, n]) => [id, Math.trunc(Number(n))]),
    );
  }

  get enabled() {
    return Boolean(this.cfg.REVENUECAT_WEBHOOK_AUTH || this.cfg.REVENUECAT_WEBHOOK_SECRET);
  }

  creditPacks() {
    return [...this.packs].map(([productId, credits]) => ({ productId, credits }));
  }

  /** Authorization header (if configured) AND HMAC signature (if configured) must both pass. */
  verify(headers: Record<string, string | string[] | undefined>, rawBody: Buffer | undefined, now = Date.now()) {
    if (!this.enabled) throw new AppError(404, 'not_found', 'Bulunamadı');
    const auth = this.cfg.REVENUECAT_WEBHOOK_AUTH;
    if (auth && !safeEqual(String(headers.authorization ?? ''), auth)) throw new AppError(401, 'unauthorized', 'İmza geçersiz');
    const secret = this.cfg.REVENUECAT_WEBHOOK_SECRET;
    if (secret) {
      const header = String(headers['x-revenuecat-webhook-signature'] ?? '');
      const parts = Object.fromEntries(header.split(',').map((kv) => kv.trim().split('=') as [string, string]));
      const t = Number(parts.t);
      if (!rawBody || !Number.isFinite(t) || !parts.v1 || Math.abs(now / 1000 - t) > SIGNATURE_TOLERANCE_SEC) {
        throw new AppError(401, 'unauthorized', 'İmza geçersiz');
      }
      const expected = createHmac('sha256', secret).update(`${parts.t}.`).update(rawBody).digest('hex');
      if (!safeEqual(expected, parts.v1)) throw new AppError(401, 'unauthorized', 'İmza geçersiz');
    }
  }

  /** Stores the (already authenticated) event once and queues it. Duplicates are acknowledged, not re-run. */
  async receive(body: unknown): Promise<'queued' | 'duplicate'> {
    const event = (body as { event?: RcEvent } | null)?.event;
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string' || event.id.length > 200) {
      throw new AppError(400, 'bad_request', 'Geçersiz olay');
    }
    try {
      await this.prisma.webhookEvent.create({
        data: {
          id: event.id, source: 'revenuecat', type: event.type.slice(0, 60),
          appUserId: event.app_user_id?.slice(0, 200) ?? null, status: 'queued', payload: event as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'duplicate';
      throw e;
    }
    await this.queues.maintenance.add(
      'revenuecat-event',
      { eventId: event.id },
      { jobId: `rc-${event.id}`, attempts: 5, backoff: { type: 'exponential', delay: 10_000 } },
    );
    return 'queued';
  }

  private resolveUser(event: RcEvent): string | null {
    const candidates = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? []), ...(event.transferred_to ?? [])];
    return candidates.find((c): c is string => typeof c === 'string' && isUuid(c)) ?? null;
  }

  async process(eventId: string) {
    const row = await this.prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!row || row.status === 'processed') return;
    const event = row.payload as unknown as RcEvent;
    const done = (status: string, extra: { userId?: string | null; error?: string } = {}) =>
      this.prisma.webhookEvent.update({ where: { id: eventId }, data: { status, processedAt: new Date(), ...extra } });

    if (event.type === 'TEST') return done('ignored');
    const userId = this.resolveUser(event);
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }) : null;
    if (!user) {
      log.warn('billing_unmatched', { eventId, type: event.type });
      return done('unmatched');
    }
    try {
      if (this.cfg.REVENUECAT_API_KEY) await this.syncFromRest(user.id);
      else await this.applyEvent(user.id, event);
      await done('processed', { userId: user.id, error: undefined });
      log.info('billing_event_processed', { eventId, type: event.type, userId: user.id });
    } catch (e) {
      await this.prisma.webhookEvent.update({ where: { id: eventId }, data: { status: 'failed', userId: user.id, error: (e as Error).message.slice(0, 300) } });
      throw e; // queue retries
    }
  }

  /** Source of truth: RevenueCat's subscriber record (recommended after every webhook). */
  async syncFromRest(userId: string) {
    if (!this.cfg.REVENUECAT_API_KEY) return;
    const res = await fetch(RC_API + encodeURIComponent(userId), {
      headers: { authorization: `Bearer ${this.cfg.REVENUECAT_API_KEY}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`revenuecat_http_${res.status}`);
    const sub = ((await res.json()) as RcSubscriber).subscriber ?? {};
    const ent = sub.entitlements?.[this.cfg.REVENUECAT_ENTITLEMENT];
    const product = ent?.product_identifier ? sub.subscriptions?.[ent.product_identifier] : undefined;
    const expires = ent ? (ent.expires_date ? new Date(ent.expires_date) : new Date('9999-12-31')) : null;
    const grace = ent?.grace_period_expires_date ? new Date(ent.grace_period_expires_date) : null;
    const until = [expires, grace].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const now = new Date();
    const status = !until || until <= now ? 'expired'
      : grace && (!expires || expires <= now) ? 'grace'
      : product?.billing_issues_detected_at ? 'billing_issue'
      : product?.unsubscribe_detected_at ? 'cancelled' : 'active';
    await this.saveState(userId, {
      productId: ent?.product_identifier ?? null, store: product?.store ?? null,
      environment: product ? (product.is_sandbox ? 'SANDBOX' : 'PRODUCTION') : null,
      periodType: product?.period_type ?? null, status, expiresAt: expires, gracePeriodExpiresAt: grace, until,
    });
    for (const [productId, purchases] of Object.entries(sub.non_subscriptions ?? {})) {
      for (const p of purchases) await this.creditPack(userId, p.id, productId, p.store ?? null);
    }
  }

  /** Fallback when no REST key is configured: derive state from the event itself. */
  async applyEvent(userId: string, e: RcEvent) {
    if (e.type === 'NON_RENEWING_PURCHASE' && e.product_id && e.transaction_id) {
      await this.creditPack(userId, e.transaction_id, e.product_id, e.store ?? null);
      return;
    }
    if (e.entitlement_ids && !e.entitlement_ids.includes(this.cfg.REVENUECAT_ENTITLEMENT)) return;
    const expires = e.expiration_at_ms ? new Date(e.expiration_at_ms) : null;
    const base = { productId: e.product_id ?? null, store: e.store ?? null, environment: e.environment ?? null, periodType: e.period_type ?? null };
    switch (e.type) {
      case 'INITIAL_PURCHASE': case 'RENEWAL': case 'UNCANCELLATION': case 'PRODUCT_CHANGE':
      case 'SUBSCRIPTION_EXTENDED': case 'REFUND_REVERSED': case 'TEMPORARY_ENTITLEMENT_GRANT': case 'TRANSFER':
        return this.saveState(userId, { ...base, status: 'active', expiresAt: expires, gracePeriodExpiresAt: null, until: expires });
      case 'CANCELLATION':
        // Refunds revoke now; an ordinary cancellation keeps access until the period ends.
        return e.cancel_reason === 'CUSTOMER_SUPPORT'
          ? this.saveState(userId, { ...base, status: 'expired', expiresAt: new Date(), gracePeriodExpiresAt: null, until: null })
          : this.saveState(userId, { ...base, status: 'cancelled', expiresAt: expires, gracePeriodExpiresAt: null, until: expires });
      case 'BILLING_ISSUE': {
        const grace = e.grace_period_expiration_at_ms ? new Date(e.grace_period_expiration_at_ms) : null;
        return this.saveState(userId, { ...base, status: grace ? 'grace' : 'billing_issue', expiresAt: expires, gracePeriodExpiresAt: grace, until: grace ?? expires });
      }
      case 'EXPIRATION':
        return this.saveState(userId, { ...base, status: 'expired', expiresAt: expires, gracePeriodExpiresAt: null, until: null });
      default:
        return; // SUBSCRIPTION_PAUSED etc. do not change access
    }
  }

  private async saveState(
    userId: string,
    s: { productId: string | null; store: string | null; environment: string | null; periodType: string | null; status: string; expiresAt: Date | null; gracePeriodExpiresAt: Date | null; until: Date | null },
  ) {
    const entitlement = this.cfg.REVENUECAT_ENTITLEMENT;
    const data = { productId: s.productId, store: s.store, environment: s.environment, periodType: s.periodType, status: s.status, expiresAt: s.expiresAt, gracePeriodExpiresAt: s.gracePeriodExpiresAt };
    await this.prisma.$transaction([
      this.prisma.subscription.upsert({ where: { userId_entitlement: { userId, entitlement } }, create: { userId, entitlement, ...data }, update: data }),
      this.prisma.user.update({ where: { id: userId }, data: { storeProUntil: s.until && s.until > new Date() ? s.until : null } }),
    ]);
  }

  /** Consumable credit pack: the store purchase id is the primary key, so a purchase is credited once. */
  private async creditPack(userId: string, purchaseId: string, productId: string, store: string | null) {
    const credits = this.packs.get(productId);
    if (!credits) return;
    try {
      await this.prisma.$transaction([
        this.prisma.storePurchase.create({ data: { id: purchaseId.slice(0, 200), userId, productId, credits, store } }),
        this.prisma.user.update({ where: { id: userId }, data: { credits: { increment: credits } } }),
        this.prisma.creditLedger.create({ data: { userId, delta: credits, reason: `purchase:${productId}`, refId: purchaseId.slice(0, 200) } }),
      ]);
      log.info('credits_purchased', { userId, productId, credits });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
      throw e;
    }
  }
}

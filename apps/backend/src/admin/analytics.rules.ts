import { todayInIstanbul } from '../common/http.js';

// Admin analytics (API.md §7.20), the pure part: RevenueCat events → revenue summary, active subscriptions → MRR,
// weekly cohort counts → retention grid. The SQL lives in analytics.service.ts; everything here is plain data, so it
// is unit-tested without a database. Days and weeks are Europe/Istanbul calendar days (weeks start on Monday).

/** AI calls that count as a user being active, next to creating a design (marketing is the team's own work). */
export const ACTIVITY_AI_KINDS = ['chat', 'analyze', 'segment', 'describe'] as const;
export const REVENUE_EVENT_TYPES = ['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'CANCELLATION', 'EXPIRATION'] as const;
export const BILLING_ENVS = ['PRODUCTION', 'SANDBOX'] as const;
export type BillingEnv = (typeof BILLING_ENVS)[number];

const DAY = 86_400_000;
const AVG_MONTH_DAYS = 30.4375;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const cents = (v: number) => Math.round(v * 100) / 100;
const round1 = (v: number) => Math.round(v * 10) / 10;
/** RevenueCat sends the store and tax shares as fractions (0.15); a value above 1 is read as a percentage. */
const share = (v: unknown) => {
  const n = num(v);
  if (n === null || n <= 0) return 0;
  return Math.min(1, n > 1 ? n / 100 : n);
};

/** The last `days` calendar days ending `today` (YYYY-MM-DD), oldest first. */
export function dayRange(today: string, days: number): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * DAY).toISOString().slice(0, 10));
}

/** 00:00 Istanbul (UTC+3, no DST since 2016) of the first day of the window. */
export function windowStart(today: string, days: number): Date {
  return new Date(Date.parse(`${today}T00:00:00+03:00`) - (days - 1) * DAY);
}

export type RevenueRow = { type: string; receivedAt: Date; userId: string | null; payload: unknown };

/**
 * USD amounts from the webhook payload (`price`: USD, 0 for trials, negative for refunds). Income: first paid
 * purchase, renewal, credit pack. A refund is a CANCELLATION with `cancel_reason: CUSTOMER_SUPPORT`; any other
 * cancellation only stops the next renewal. PRODUCT_CHANGE is not counted (the store bills it as a purchase or
 * renewal). Proceeds take off the store commission and tax when the event reports them.
 */
export function summarizeRevenue(rows: RevenueRow[], o: { env: BillingEnv; days: number; today: string }) {
  const range = dayRange(o.today, o.days);
  const from = range[0];
  const daily = new Map(range.map((d) => [d, { gross: 0, refunds: 0 }]));
  const byProduct = new Map<string, { revenueUsd: number; purchases: number }>();
  const byStore = new Map<string, number>();
  const byCurrency = new Map<string, number>();
  const payers = new Set<string>();
  const t = {
    grossUsd: 0, refundsUsd: 0, proceedsUsd: 0,
    newSubscriptions: 0, trials: 0, trialConversions: 0, renewals: 0, creditPacks: 0, refunds: 0, cancellations: 0, expirations: 0,
  };

  for (const r of rows) {
    const p = (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Record<string, unknown>;
    if ((str(p.environment) ?? 'PRODUCTION') !== o.env) continue;
    const at = num(p.event_timestamp_ms);
    const day = todayInIstanbul(at === null ? r.receivedAt : new Date(at));
    const bucket = daily.get(day);
    if (!bucket) continue;
    const price = num(p.price);
    const local = num(p.price_in_purchased_currency);
    const currency = str(p.currency);
    const product = str(p.product_id) ?? '—';
    const store = str(p.store) ?? '—';
    const keep = 1 - Math.min(1, share(p.commission_percentage) + share(p.tax_percentage));
    const book = (amount: number, localAmount: number | null) => {
      const prod = byProduct.get(product) ?? { revenueUsd: 0, purchases: 0 };
      prod.revenueUsd += amount;
      if (amount > 0) prod.purchases += 1;
      byProduct.set(product, prod);
      byStore.set(store, (byStore.get(store) ?? 0) + amount);
      if (currency && localAmount !== null) byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + localAmount);
      t.proceedsUsd += amount * keep;
    };
    const income = () => {
      if (price === null || price <= 0) return;
      t.grossUsd += price;
      bucket.gross += price;
      if (r.userId) payers.add(r.userId);
      book(price, local !== null ? Math.abs(local) : null);
    };

    switch (r.type) {
      case 'INITIAL_PURCHASE':
        if (str(p.period_type) === 'TRIAL') t.trials += 1;
        else {
          t.newSubscriptions += 1;
          income();
        }
        break;
      case 'RENEWAL':
        t.renewals += 1;
        if (p.is_trial_conversion === true) t.trialConversions += 1;
        income();
        break;
      case 'NON_RENEWING_PURCHASE':
        t.creditPacks += 1;
        income();
        break;
      case 'CANCELLATION':
        if (str(p.cancel_reason) === 'CUSTOMER_SUPPORT') {
          t.refunds += 1;
          const amount = price === null ? 0 : Math.abs(price);
          t.refundsUsd += amount;
          bucket.refunds += amount;
          book(-amount, local !== null ? -Math.abs(local) : null);
        } else t.cancellations += 1;
        break;
      case 'EXPIRATION':
        t.expirations += 1;
        break;
    }
  }

  const netUsd = t.grossUsd - t.refundsUsd;
  return {
    env: o.env,
    from,
    to: o.today,
    totals: {
      ...t,
      grossUsd: cents(t.grossUsd),
      refundsUsd: cents(t.refundsUsd),
      netUsd: cents(netUsd),
      proceedsUsd: cents(t.proceedsUsd),
      payers: payers.size,
      arppuUsd: payers.size ? cents(netUsd / payers.size) : null,
    },
    daily: range.map((date) => {
      const d = daily.get(date)!;
      return { date, grossUsd: cents(d.gross), refundsUsd: cents(d.refunds), netUsd: cents(d.gross - d.refunds) };
    }),
    byProduct: [...byProduct]
      .map(([productId, v]) => ({ productId, revenueUsd: cents(v.revenueUsd), purchases: v.purchases }))
      .sort((a, b) => b.revenueUsd - a.revenueUsd),
    byStore: [...byStore].map(([store, v]) => ({ store, revenueUsd: cents(v) })).sort((a, b) => b.revenueUsd - a.revenueUsd),
    byCurrency: [...byCurrency].map(([currency, v]) => ({ currency, amount: cents(v) })).sort((a, b) => b.amount - a.amount),
  };
}

export type ActiveSubscription = { status: string; periodType: string | null; price: number | null; periodDays: number | null };

/** Price per month: the last billed price over the period it bought (a year → /12, a week → ×4.35). */
export function monthlyAmount(price: number, periodDays: number | null): number {
  return periodDays && periodDays >= 1 ? (price * AVG_MONTH_DAYS) / periodDays : price;
}

/**
 * Subscriptions that give access right now. MRR counts the ones that will renew: not trials, not cancelled
 * (those keep access until the period ends but bring nothing next month). `priced` says how many of them had a
 * known price, so a low number explains a low MRR.
 */
export function summarizeSubscriptions(subs: ActiveSubscription[]) {
  const byStatus: Record<string, number> = {};
  let trials = 0;
  let mrr = 0;
  let renewing = 0;
  let priced = 0;
  for (const s of subs) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    if (s.periodType === 'TRIAL') {
      trials += 1;
      continue;
    }
    if (s.status === 'cancelled') continue;
    renewing += 1;
    if (s.price !== null && s.price > 0) {
      priced += 1;
      mrr += monthlyAmount(s.price, s.periodDays);
    }
  }
  return { active: subs.length, byStatus, trials, renewing, priced, mrrUsd: cents(mrr) };
}

/**
 * Weekly signup cohorts (oldest first). `retention[k]`: share of the cohort active in week k after the signup week
 * (k = 0 is the signup week itself); null where that week has not started yet or the cohort is empty. `average[k]`
 * weighs every cohort that has reached week k by its size.
 */
export function cohortGrid(o: {
  currentWeek: string;
  weeks: number;
  sizes: Array<{ cohort: string; n: number }>;
  active: Array<{ cohort: string; k: number; n: number }>;
}) {
  const size = new Map(o.sizes.map((s) => [s.cohort, s.n]));
  const act = new Map(o.active.map((a) => [`${a.cohort}|${a.k}`, a.n]));
  const end = Date.parse(`${o.currentWeek}T00:00:00Z`);
  const rows = Array.from({ length: o.weeks }, (_, i) => {
    const week = new Date(end - (o.weeks - 1 - i) * 7 * DAY).toISOString().slice(0, 10);
    const n = size.get(week) ?? 0;
    const elapsed = o.weeks - 1 - i;
    const active = Array.from({ length: o.weeks }, (_, k) => (k > elapsed ? null : (act.get(`${week}|${k}`) ?? 0)));
    const retention = active.map((a) => (a === null || n === 0 ? null : round1((a / n) * 100)));
    return { week, size: n, active, retention };
  });
  const average = Array.from({ length: o.weeks }, (_, k) => {
    let users = 0;
    let base = 0;
    for (const r of rows) {
      const a = r.active[k];
      if (a === null || r.size === 0) continue;
      users += a;
      base += r.size;
    }
    return base ? round1((users / base) * 100) : null;
  });
  return { currentWeek: o.currentWeek, weeks: o.weeks, rows, average };
}

/** Fills the days a query returned no row for with 0. */
export function fillDaily(range: string[], rows: Array<{ date: string; n: number }>) {
  const m = new Map(rows.map((r) => [r.date, r.n]));
  return range.map((date) => ({ date, activeUsers: m.get(date) ?? 0 }));
}

import { cohortGrid, dayRange, monthlyAmount, summarizeRevenue, summarizeSubscriptions, windowStart, type RevenueRow } from './admin/analytics.rules.js';

// API.md §7.20: admin analytics. The money and retention rules are pure functions over webhook payloads and counts.

const today = '2026-11-04';
const at = (iso: string) => new Date(iso).getTime();
const ev = (type: string, payload: Record<string, unknown>, userId: string | null = 'u1'): RevenueRow => ({
  type,
  userId,
  receivedAt: new Date(typeof payload.event_timestamp_ms === 'number' ? payload.event_timestamp_ms : at('2026-11-04T10:00:00Z')),
  payload: { environment: 'PRODUCTION', store: 'APP_STORE', product_id: 'pro_monthly', ...payload },
});

describe('analytics: revenue', () => {
  it('counts paid purchases, renewals and packs; a trial or another environment adds nothing', () => {
    const s = summarizeRevenue(
      [
        ev('INITIAL_PURCHASE', { period_type: 'TRIAL', price: 0 }),
        ev('INITIAL_PURCHASE', { period_type: 'NORMAL', price: 9.99 }),
        ev('RENEWAL', { price: 9.99, is_trial_conversion: true }, 'u2'),
        ev('NON_RENEWING_PURCHASE', { price: 2.5, product_id: 'credits_10', store: 'PLAY_STORE' }, 'u2'),
        ev('INITIAL_PURCHASE', { period_type: 'NORMAL', price: 100, environment: 'SANDBOX' }),
      ],
      { env: 'PRODUCTION', days: 7, today },
    );
    expect(s.totals).toMatchObject({ grossUsd: 22.48, netUsd: 22.48, trials: 1, newSubscriptions: 1, renewals: 1, trialConversions: 1, creditPacks: 1, payers: 2, arppuUsd: 11.24 });
    expect(s.byProduct).toEqual([
      { productId: 'pro_monthly', revenueUsd: 19.98, purchases: 2 },
      { productId: 'credits_10', revenueUsd: 2.5, purchases: 1 },
    ]);
    expect(s.byStore.map((x) => x.store)).toEqual(['APP_STORE', 'PLAY_STORE']);
    expect(summarizeRevenue([ev('INITIAL_PURCHASE', { price: 100, environment: 'SANDBOX' })], { env: 'SANDBOX', days: 7, today }).totals.grossUsd).toBe(100);
  });

  it('a refund (CUSTOMER_SUPPORT) comes off; an ordinary cancellation does not', () => {
    const s = summarizeRevenue(
      [
        ev('INITIAL_PURCHASE', { price: 10, price_in_purchased_currency: 330, currency: 'TRY' }),
        ev('CANCELLATION', { cancel_reason: 'CUSTOMER_SUPPORT', price: -10, price_in_purchased_currency: -330, currency: 'TRY' }),
        ev('CANCELLATION', { cancel_reason: 'UNSUBSCRIBE', price: 10 }),
        ev('EXPIRATION', { price: 10 }),
      ],
      { env: 'PRODUCTION', days: 7, today },
    );
    expect(s.totals).toMatchObject({ grossUsd: 10, refundsUsd: 10, netUsd: 0, refunds: 1, cancellations: 1, expirations: 1 });
    expect(s.byCurrency).toEqual([{ currency: 'TRY', amount: 0 }]);
    expect(s.daily.at(-1)).toMatchObject({ date: today, grossUsd: 10, refundsUsd: 10, netUsd: 0 });
  });

  it('proceeds take off store commission and tax (fractions or percentages)', () => {
    const s = summarizeRevenue(
      [
        ev('RENEWAL', { price: 10, commission_percentage: 0.15, tax_percentage: 0.2 }),
        ev('RENEWAL', { price: 10, commission_percentage: 30 }),
        ev('RENEWAL', { price: 10 }),
      ],
      { env: 'PRODUCTION', days: 7, today },
    );
    expect(s.totals.grossUsd).toBe(30);
    expect(s.totals.proceedsUsd).toBe(6.5 + 7 + 10);
  });

  it('buckets by the Istanbul day of the event and drops what is outside the window', () => {
    const s = summarizeRevenue(
      [
        ev('RENEWAL', { price: 1, event_timestamp_ms: at('2026-11-03T22:30:00Z') }), // 01:30 on 4 Nov in Istanbul
        ev('RENEWAL', { price: 2, event_timestamp_ms: at('2026-10-28T20:59:00Z') }), // 23:59 on 28 Oct: before the window
        ev('RENEWAL', { price: 4, event_timestamp_ms: at('2026-10-28T21:00:00Z') }), // 00:00 on 29 Oct: first day
      ],
      { env: 'PRODUCTION', days: 7, today },
    );
    expect(s.from).toBe('2026-10-29');
    expect(s.daily).toHaveLength(7);
    expect(s.daily[0]).toMatchObject({ date: '2026-10-29', grossUsd: 4 });
    expect(s.daily[6]).toMatchObject({ date: today, grossUsd: 1 });
    expect(s.totals.grossUsd).toBe(5);
  });

  it('ignores malformed payloads instead of failing (EXC-01)', () => {
    const rows: RevenueRow[] = [
      { type: 'RENEWAL', userId: null, receivedAt: new Date(at('2026-11-04T10:00:00Z')), payload: null },
      ev('RENEWAL', { price: '9.99' }),
      ev('RENEWAL', { price: Number.NaN }),
    ];
    const s = summarizeRevenue(rows, { env: 'PRODUCTION', days: 7, today });
    expect(s.totals).toMatchObject({ grossUsd: 0, renewals: 3, payers: 0, arppuUsd: null });
  });

  it('the event window starts at 00:00 Istanbul of the first day', () => {
    expect(windowStart(today, 7).toISOString()).toBe('2026-10-28T21:00:00.000Z');
    expect(dayRange(today, 3)).toEqual(['2026-11-02', '2026-11-03', today]);
  });
});

describe('analytics: subscriptions and MRR', () => {
  it('normalises the last billed price to a month and leaves out trials and cancelled ones', () => {
    expect(monthlyAmount(120, 365.25)).toBeCloseTo(10, 5);
    expect(monthlyAmount(10, null)).toBe(10);
    const s = summarizeSubscriptions([
      { status: 'active', periodType: 'NORMAL', price: 9.99, periodDays: 30.4375 },
      { status: 'active', periodType: 'NORMAL', price: 120, periodDays: 365.25 },
      { status: 'grace', periodType: 'NORMAL', price: null, periodDays: null },
      { status: 'cancelled', periodType: 'NORMAL', price: 9.99, periodDays: 30 },
      { status: 'active', periodType: 'TRIAL', price: null, periodDays: 7 },
    ]);
    expect(s).toEqual({ active: 5, byStatus: { active: 3, grace: 1, cancelled: 1 }, trials: 1, renewing: 3, priced: 2, mrrUsd: 19.99 });
  });
});

describe('analytics: cohorts', () => {
  it('weeks that have not started are empty; the average weighs cohorts by size', () => {
    const g = cohortGrid({
      currentWeek: '2026-11-02',
      weeks: 4,
      sizes: [
        { cohort: '2026-10-12', n: 10 },
        { cohort: '2026-10-19', n: 0 },
        { cohort: '2026-11-02', n: 4 },
      ],
      active: [
        { cohort: '2026-10-12', k: 0, n: 8 },
        { cohort: '2026-10-12', k: 1, n: 5 },
        { cohort: '2026-10-12', k: 3, n: 2 },
        { cohort: '2026-11-02', k: 0, n: 3 },
      ],
    });
    expect(g.rows.map((r) => r.week)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
    expect(g.rows[0]).toEqual({ week: '2026-10-12', size: 10, active: [8, 5, 0, 2], retention: [80, 50, 0, 20] });
    expect(g.rows[1].retention).toEqual([null, null, null, null]); // nobody signed up
    expect(g.rows[3]).toEqual({ week: '2026-11-02', size: 4, active: [3, null, null, null], retention: [75, null, null, null] });
    expect(g.average).toEqual([78.6, 50, 0, 20]); // week 0: (8 + 3) / (10 + 4)
  });
});

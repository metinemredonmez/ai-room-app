import { anniversaryKeys, DEFAULT_LOYALTY, loyaltyDiff, LoyaltySettingsSchema, parseLoyalty, PUSH_TEXT, streakPays } from './loyalty/loyalty.rules.js';
import { ledgerKind, publicLedgerEntry } from './users/ledger.js';

// API.md §7.35: automatic loyalty gifts. Everything starts off; bounds keep a typo from giving away the shop; the
// streak pays at its length and every multiple; 29 February accounts still get an anniversary. (Granting, the daily
// job and "nobody is paid twice" run against PostgreSQL: see the smoke test and the local check in the PR notes.)

describe('loyalty rules', () => {
  it('every rule starts switched off', () => {
    expect(parseLoyalty(undefined)).toEqual({ settings: DEFAULT_LOYALTY, ok: true });
    expect(Object.values(DEFAULT_LOYALTY).every((r) => r.enabled === false)).toBe(true);
  });

  it('bounds: streak 3–60 days / 1–20 credits, anniversary ≤ 50, win-back cooldown ≥ 30 days, cap ≤ 2000', () => {
    const ok = (mut: (s: typeof DEFAULT_LOYALTY) => void) => {
      const s = structuredClone(DEFAULT_LOYALTY);
      mut(s);
      return LoyaltySettingsSchema.safeParse(s).success;
    };
    expect(ok(() => undefined)).toBe(true);
    expect(ok((s) => (s.streak.days = 2))).toBe(false);
    expect(ok((s) => (s.streak.credits = 21))).toBe(false);
    expect(ok((s) => (s.anniversary.credits = 51))).toBe(false);
    expect(ok((s) => (s.winback.cooldownDays = 7))).toBe(false);
    expect(ok((s) => (s.winback.dailyCap = 5000))).toBe(false);
    expect(ok((s) => (s.winback.inactiveDays = 3))).toBe(false);
    expect(ok((s) => (s.winback.message.tr = 'x'.repeat(141)))).toBe(false);
    expect(ok((s) => ((s.streak as Record<string, unknown>).bonus = 5))).toBe(false);
  });

  it('a stored row missing a rule takes its default; junk falls back to all off', () => {
    const partial = { streak: { ...DEFAULT_LOYALTY.streak, enabled: true } };
    const r = parseLoyalty(partial);
    expect(r.ok).toBe(true);
    expect(r.settings.streak.enabled).toBe(true);
    expect(r.settings.winback).toEqual(DEFAULT_LOYALTY.winback);
    expect(parseLoyalty({ streak: { enabled: 'yes' } })).toEqual({ settings: DEFAULT_LOYALTY, ok: false });
    expect(parseLoyalty([1, 2])).toEqual({ settings: DEFAULT_LOYALTY, ok: false });
  });

  it('the streak pays at its length and every multiple', () => {
    expect([1, 6, 7, 8, 13, 14, 21].filter((d) => streakPays(d, 7))).toEqual([7, 14, 21]);
    expect(streakPays(0, 7)).toBe(false);
  });

  it('anniversary days: 29 February accounts celebrate on 28 February in a non-leap year', () => {
    expect(anniversaryKeys('2027-02-28')).toEqual(['02-28', '02-29']);
    expect(anniversaryKeys('2028-02-28')).toEqual(['02-28']);
    expect(anniversaryKeys('2028-02-29')).toEqual(['02-29']);
    expect(anniversaryKeys('2026-11-06')).toEqual(['11-06']);
  });

  it('push texts and the audit diff read well', () => {
    expect(PUSH_TEXT.streak.tr(2, 7)).toEqual({ title: '7 gündür buradasın', body: 'Teşekkürler! Hesabına 2 hediye kredi eklendi.' });
    expect(PUSH_TEXT.anniversary.en(3, 1).title).toBe('1 year with Casalume');
    const next = structuredClone(DEFAULT_LOYALTY);
    next.winback.enabled = true;
    next.winback.inactiveDays = 45;
    next.streak.message.tr = 'Harikasın!';
    expect(loyaltyDiff(DEFAULT_LOYALTY, next)).toEqual(['streak: mesaj değişti', 'winback: açıldı', 'winback.inactiveDays: 30 → 45']);
  });

  it('loyalty gifts read as a gift in the app; the grant id never leaves the server', () => {
    for (const r of ['loyalty:streak', 'loyalty:anniversary', 'loyalty:winback']) expect(ledgerKind(r)).toBe('gift');
    const e = publicLedgerEntry({ id: 'a', delta: 2, reason: 'loyalty:winback', refId: '0b8f3a3c-5a3e-4c1b-9b8e-2f1c3d4e5f60', createdAt: new Date(0) });
    expect(e).toMatchObject({ kind: 'gift', designId: null, productId: null });
  });
});

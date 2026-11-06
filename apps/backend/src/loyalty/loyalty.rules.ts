import { z } from 'zod';

// Automatic loyalty gifts (API.md §7.35; YediOda #63). Three rules, each switched on and tuned from the admin, all off
// until someone switches them on:
//   streak       — active on N consecutive days (Istanbul calendar) → credits, again at 2N, 3N…
//   anniversary  — the yearly anniversary of the account → credits (a birthday would need a birth date; we don't
//                  collect one: KVKK data minimisation)
//   winback      — not seen for N days → credits and a push, at most once per cooldown, at most dailyCap people a day
// Only real, verified, active USER accounts are paid (no guests, no staff). Every gift is a LoyaltyGrant row with a
// unique (user, rule, period), so a retry, a second request or a rerun of the daily job never pays twice (BUS-02).

export const LOYALTY_RULES = ['streak', 'anniversary', 'winback'] as const;
export type LoyaltyRule = (typeof LOYALTY_RULES)[number];

const Message = z.object({ tr: z.string().trim().max(140), en: z.string().trim().max(140) }).strict();
const Credits = (max: number) => z.number().int().min(1).max(max);

export const LoyaltySettingsSchema = z
  .object({
    streak: z.object({ enabled: z.boolean(), days: z.number().int().min(3).max(60), credits: Credits(20), message: Message }).strict(),
    anniversary: z.object({ enabled: z.boolean(), credits: Credits(50), message: Message }).strict(),
    winback: z
      .object({
        enabled: z.boolean(),
        inactiveDays: z.number().int().min(7).max(365),
        credits: Credits(20),
        cooldownDays: z.number().int().min(30).max(365),
        dailyCap: z.number().int().min(1).max(2000),
        message: Message,
      })
      .strict(),
  })
  .strict();
export type LoyaltySettings = z.infer<typeof LoyaltySettingsSchema>;

// Each rule gets its own message object: a shared one would change all three when one is edited.
export const DEFAULT_LOYALTY: LoyaltySettings = {
  streak: { enabled: false, days: 7, credits: 1, message: { tr: '', en: '' } },
  anniversary: { enabled: false, credits: 3, message: { tr: '', en: '' } },
  winback: { enabled: false, inactiveDays: 30, credits: 2, cooldownDays: 90, dailyCap: 300, message: { tr: '', en: '' } },
};

/** Stored row → settings; a missing rule (added in a later deploy) takes its default, junk falls back to all off. */
export function parseLoyalty(value: unknown): { settings: LoyaltySettings; ok: boolean } {
  if (value === undefined || value === null) return { settings: DEFAULT_LOYALTY, ok: true };
  if (typeof value !== 'object' || Array.isArray(value)) return { settings: DEFAULT_LOYALTY, ok: false };
  const merged = { ...DEFAULT_LOYALTY, ...(value as Record<string, unknown>) };
  const r = LoyaltySettingsSchema.safeParse(merged);
  return r.success ? { settings: r.data, ok: true } : { settings: DEFAULT_LOYALTY, ok: false };
}

/** A streak pays when it reaches its length and every multiple of it (7, 14, 21… days). */
export const streakPays = (streakDays: number, length: number) => streakDays > 0 && streakDays % length === 0;

/** Default push texts; a message set in the admin replaces the body (Turkish for tr, English for everyone else). */
export const PUSH_TEXT = {
  streak: {
    tr: (n: number, days: number) => ({ title: `${days} gündür buradasın`, body: `Teşekkürler! Hesabına ${n} hediye kredi eklendi.` }),
    en: (n: number, days: number) => ({ title: `${days} days in a row`, body: `Thank you! ${n} gift credits were added to your account.` }),
  },
  anniversary: {
    tr: (n: number, years: number) => ({ title: `Casalume'de ${years}. yılın`, body: `Birlikte bir yıl daha! Hesabına ${n} hediye kredi eklendi.` }),
    en: (n: number, years: number) => ({ title: `${years} ${years === 1 ? 'year' : 'years'} with Casalume`, body: `Another year together! ${n} gift credits were added to your account.` }),
  },
  winback: {
    tr: (n: number) => ({ title: 'Seni özledik', body: `Hesabına ${n} hediye kredi ekledik; yeni bir tasarım dene.` }),
    en: (n: number) => ({ title: 'We missed you', body: `We added ${n} gift credits to your account; try a new design.` }),
  },
} as const;

/** Human-readable change list for the audit log. */
export function loyaltyDiff(prev: LoyaltySettings, next: LoyaltySettings): string[] {
  const out: string[] = [];
  for (const rule of LOYALTY_RULES) {
    const a = prev[rule] as Record<string, unknown>;
    const b = next[rule] as Record<string, unknown>;
    for (const k of Object.keys(b)) {
      const x = JSON.stringify(a[k]);
      const y = JSON.stringify(b[k]);
      if (x === y) continue;
      if (k === 'enabled') out.push(`${rule}: ${b[k] ? 'açıldı' : 'kapandı'}`);
      else if (k === 'message') out.push(`${rule}: mesaj değişti`);
      else out.push(`${rule}.${k}: ${x} → ${y}`);
    }
  }
  return out;
}

/** Anniversary month-day keys for a day: on 28 February of a non-leap year, accounts opened on 29 February count too. */
export function anniversaryKeys(today: string): string[] {
  const [y, m, d] = today.split('-').map(Number);
  const md = today.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return m === 2 && d === 28 && !leap ? [md, '02-29'] : [md];
}

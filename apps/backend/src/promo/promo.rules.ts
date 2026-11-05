import { randomInt } from 'node:crypto';
import { z } from 'zod';

// Promotion and gift codes (API.md §7.29; YediOda #64, maeyja coupons, fal-app promo). Pure rules: how a code is
// written, generated and validated. The service does the locking and granting.

/** No 0/O, 1/I/L or U: a code read out loud or typed from a card is not mistaken. 30^12 ≈ 5·10^17 possibilities. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const GENERATED_LENGTH = 12;
export const MAX_BATCH = 1000;
export const LIMITS_BY_KIND = { CREDITS: 500, PRO_DAYS: 365 } as const;

/** Case, spaces and dashes do not matter: "yaz 2026", "YAZ-2026" and "YAZ2026" are one code. */
export function normalizeCode(raw: string): string | null {
  const v = raw.normalize('NFKC').toUpperCase().replace(/[\s-]+/g, '');
  return /^[A-Z0-9]{4,32}$/.test(v) ? v : null;
}

export function generateCode(): string {
  let s = '';
  for (let i = 0; i < GENERATED_LENGTH; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** What the panel shows for a generated code after creation: enough to recognise it, not to use it. */
export const maskCode = (normalized: string) => `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;

const kind = z.enum(['CREDITS', 'PRO_DAYS']);
const when = z.iso.datetime({ offset: true }).nullable().default(null);
const base = {
  campaign: z.string().trim().min(2).max(80),
  kind,
  amount: z.number().int().min(1),
  startsAt: when,
  endsAt: when,
  newUsersOnly: z.boolean().default(false),
  reason: z.string().trim().min(3).max(200),
};

function checkCommon(v: { kind: keyof typeof LIMITS_BY_KIND; amount: number; startsAt: string | null; endsAt: string | null }, ctx: z.RefinementCtx) {
  if (v.amount > LIMITS_BY_KIND[v.kind]) ctx.addIssue({ code: 'custom', path: ['amount'], message: v.kind === 'CREDITS' ? 'en çok 500 kredi' : 'en çok 365 gün' });
  if (v.startsAt && v.endsAt && new Date(v.endsAt) <= new Date(v.startsAt)) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'bitiş başlangıçtan sonra olmalı' });
}

/** A shared campaign code the admin chooses, e.g. YAZ2026: many people, once each. */
export const CreateCodeSchema = z
  .object({ ...base, code: z.string().max(40), maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().default(null) })
  .strict()
  .superRefine((v, ctx) => {
    if (!normalizeCode(v.code) || normalizeCode(v.code)!.length < 6) ctx.addIssue({ code: 'custom', path: ['code'], message: '6–32 harf ve rakam' });
    checkCommon(v, ctx);
  });

/** Gift codes: `count` single-use codes for one campaign (cards, partners). */
export const BatchSchema = z
  .object({ ...base, count: z.number().int().min(1).max(MAX_BATCH) })
  .strict()
  .superRefine(checkCommon);

export const UpdateCodeSchema = z
  .object({
    active: z.boolean().optional(),
    endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
    reason: z.string().trim().min(3).max(200),
  })
  .strict()
  .refine((v) => v.active !== undefined || v.endsAt !== undefined || v.maxRedemptions !== undefined, { message: 'nothing_to_change' });

export const RedeemSchema = z.object({ code: z.string().max(60) }).strict();

type Usable = { active: boolean; startsAt: Date | null; endsAt: Date | null; maxRedemptions: number | null; redeemed: number; newUsersOnly: boolean; createdAt: Date };

/** Whether this account may use the code now. One generic refusal for the user (no oracle for guessing codes). */
export function usable(code: Usable, account: { createdAt: Date }, now = new Date()): boolean {
  if (!code.active) return false;
  if (code.startsAt && now < code.startsAt) return false;
  if (code.endsAt && now >= code.endsAt) return false;
  if (code.maxRedemptions !== null && code.redeemed >= code.maxRedemptions) return false;
  if (code.newUsersOnly && account.createdAt < code.createdAt) return false;
  return true;
}

/** PRO days stack on PRO the account already has from the panel; a store subscription runs alongside, untouched. */
export function proUntilAfter(u: { plan: string; planExpiresAt: Date | null }, days: number, now = new Date()): Date {
  const from = u.plan === 'PRO' && u.planExpiresAt && u.planExpiresAt > now ? u.planExpiresAt : now;
  return new Date(from.getTime() + days * 24 * 3600 * 1000);
}

import { randomInt } from 'node:crypto';
import { z } from 'zod';

// Invite-a-friend (API.md §7.30; YediOda #65, fal-app referral). Pure rules: settings, codes, eligibility.

/** Off until the admin switches it on: it gives credits away. */
export const ReferralSettingsSchema = z
  .object({
    enabled: z.boolean(),
    inviterCredits: z.number().int().min(1).max(50),
    inviteeCredits: z.number().int().min(0).max(50),
    /** Inviter rewards per calendar month (Istanbul); more invites still count, without credits. */
    monthlyCap: z.number().int().min(1).max(100),
    /** A new account may enter a friend's code within this many days of signing up. */
    claimDays: z.number().int().min(1).max(60),
  })
  .strict();
export type ReferralSettings = z.infer<typeof ReferralSettingsSchema>;
export const DEFAULT_REFERRAL: ReferralSettings = { enabled: false, inviterCredits: 3, inviteeCredits: 2, monthlyCap: 10, claimDays: 14 };

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const generateReferralCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export function normalizeReferralCode(raw: string): string | null {
  const v = raw.normalize('NFKC').toUpperCase().replace(/[\s-]+/g, '');
  return /^[A-Z0-9]{6,16}$/.test(v) ? v : null;
}

/** Start of this month in Istanbul, as a UTC instant (the monthly cap resets there). */
export function monthStartIstanbul(now = new Date()): Date {
  const local = new Date(now.getTime() + 3 * 3600 * 1000); // Türkiye is UTC+3 all year
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 3 * 3600 * 1000);
}

/** Who may enter a friend's code: a verified, active, real account, new enough. */
export function claimProblem(u: { isGuest: boolean; email: string | null; emailVerifiedAt: Date | null; createdAt: Date }, s: ReferralSettings, now = new Date()) {
  if (!s.enabled) return 'disabled' as const;
  if (u.isGuest || !u.email || !u.emailVerifiedAt) return 'verification_required' as const;
  if (now.getTime() - u.createdAt.getTime() > s.claimDays * 24 * 3600 * 1000) return 'claim_closed' as const;
  return null;
}

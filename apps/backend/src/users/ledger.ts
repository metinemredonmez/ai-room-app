import { isUuid } from '../images/images.service.js';

// "My credit movements" (API.md §7.24): the user's own ledger, in words the app can translate. Staff adjustments
// show as "adjustment" only: their free-text reason and the staff member's id (stored in refId) never leave the
// admin side.

export const LEDGER_KINDS = ['daily_free', 'generation', 'refund', 'welcome', 'purchase', 'promo', 'referral', 'adjustment', 'other'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export function ledgerKind(reason: string): LedgerKind {
  if (reason === 'daily_free' || reason === 'generation' || reason === 'refund' || reason === 'welcome') return reason;
  if (reason.startsWith('purchase:')) return 'purchase';
  // API.md §7.29: a promo code's credits, or its PRO days (delta 0).
  if (reason === 'promo' || reason === 'promo_pro') return 'promo';
  // API.md §7.30: credits for joining by invitation, or for a friend's first design.
  if (reason === 'referral_invitee' || reason === 'referral_inviter') return 'referral';
  if (reason.startsWith('admin:')) return 'adjustment';
  return 'other';
}

export function publicLedgerEntry(r: { id: string; delta: number; reason: string; refId: string | null; createdAt: Date }) {
  const kind = ledgerKind(r.reason);
  const aboutDesign = kind === 'generation' || kind === 'refund' || kind === 'daily_free';
  return {
    id: r.id,
    delta: r.delta,
    kind,
    designId: aboutDesign && r.refId && isUuid(r.refId) ? r.refId : null,
    productId: kind === 'purchase' ? r.reason.slice('purchase:'.length).slice(0, 100) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

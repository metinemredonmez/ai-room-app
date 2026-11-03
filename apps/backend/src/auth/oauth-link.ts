/**
 * Who does a verified Apple / Google sign-in belong to? Kept pure so every branch is unit-tested.
 *
 * Pre-account-hijacking: an e-mail match links to an existing account only when *both* sides proved
 * control of that address (provider says verified, and the local account verified it by mail). An
 * unverified local account with the same e-mail is never taken over — nor silently merged.
 */
export type LinkDecision =
  | { kind: 'login'; userId: string } // this provider account is already known
  | { kind: 'attach'; userId: string; upgradeGuest: boolean } // add it to the signed-in account
  | { kind: 'attach-by-email'; userId: string } // add it to the verified account with the same e-mail
  | { kind: 'create' }
  | { kind: 'reject'; status: 409; code: 'identity_in_use' | 'account_exists'; message: string };

export interface LinkInput {
  identityUserId: string | null;
  /** The caller's own valid app session, when the request carried one. */
  current: { id: string; isGuest: boolean } | null;
  /** A local account (other than `current`) whose e-mail equals the provider e-mail. */
  emailOwner: { id: string; emailVerified: boolean } | null;
  providerEmailVerified: boolean;
}

const EXISTS: LinkDecision = {
  kind: 'reject',
  status: 409,
  code: 'account_exists',
  message: 'Bu e-posta ile kayıtlı bir hesap var. E-posta ve şifrenle giriş yapıp profilden bağlayabilirsin.',
};

export function decideLink(i: LinkInput): LinkDecision {
  if (i.identityUserId) {
    // A registered user explicitly linking someone else's provider account is refused; a guest just switches.
    if (i.current && !i.current.isGuest && i.current.id !== i.identityUserId) {
      return { kind: 'reject', status: 409, code: 'identity_in_use', message: 'Bu hesap başka bir AI Room hesabına bağlı' };
    }
    return { kind: 'login', userId: i.identityUserId };
  }
  const bothVerified = !!i.emailOwner?.emailVerified && i.providerEmailVerified;
  if (i.current && !i.current.isGuest) return { kind: 'attach', userId: i.current.id, upgradeGuest: false };
  if (i.emailOwner) return bothVerified ? { kind: 'attach-by-email', userId: i.emailOwner.id } : EXISTS;
  if (i.current) return { kind: 'attach', userId: i.current.id, upgradeGuest: true };
  return { kind: 'create' };
}

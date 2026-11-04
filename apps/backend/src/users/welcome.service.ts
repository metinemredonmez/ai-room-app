import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { CONFIG, type Config } from '../config.js';
import { SettingsService } from '../settings/settings.service.js';

// Welcome credits (API.md §7.22; palemi `welcome_promo_credits` pattern). A registered account gets them once, when
// it first proves an identity: an e-mail address it verified, or an Apple/Google account. Guests never get them
// (they have the daily free designs). Each identity is remembered as a keyed hash that outlives account deletion,
// so deleting and signing up again does not pay twice.

const RETAIN_DAYS = 3 * 365;

/**
 * One mailbox, one key: case and Unicode forms folded, `+tag` dropped, and for Gmail the dots too (those all reach
 * the same inbox). Other providers' dots are kept: they can be different people.
 */
export function welcomeEmailKey(email: string): string {
  const v = email.normalize('NFKC').trim().toLowerCase();
  const at = v.lastIndexOf('@');
  if (at <= 0) return `email:${v}`;
  let local = v.slice(0, at).split('+')[0];
  let domain = v.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `email:${local}@${domain}`;
}

export const oauthKey = (provider: string, subject: string) => `${provider}:${subject}`;

@Injectable()
export class WelcomeService {
  constructor(private prisma: PrismaService, private settings: SettingsService, @Inject(CONFIG) private cfg: Config) {}

  private hash(key: string) {
    return createHmac('sha256', this.cfg.DEVICE_PEPPER).update(`welcome:${key}`).digest('hex');
  }

  /**
   * Grants the welcome credits if they are switched on, the account is registered and active, it has not had them
   * and none of `identities` has had them before. Returns the credits granted (0 otherwise). Never throws: a
   * failed gift must not fail a sign-up.
   */
  async grant(userId: string, identities: string[]): Promise<number> {
    const amount = this.settings.current.welcomeCredits;
    if (!amount || identities.length === 0) return 0;
    const hashes = [...new Set(identities.map((k) => this.hash(k)))];
    try {
      const granted = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`welcome:${userId}`}))) AS l`;
        const user = await tx.user.findUnique({ where: { id: userId }, select: { isGuest: true, status: true } });
        if (!user || user.isGuest || user.status !== 'ACTIVE') return 0;
        const already = await tx.creditLedger.findFirst({ where: { userId, reason: 'welcome' }, select: { id: true } });
        // The unique key settles races too: an identity another account recorded first is not "new" here.
        const { count } = await tx.welcomeGrant.createMany({ data: hashes.map((hash) => ({ hash })), skipDuplicates: true });
        if (already || count < hashes.length) return 0;
        await tx.user.update({ where: { id: userId }, data: { credits: { increment: amount } } });
        await tx.creditLedger.create({ data: { userId, delta: amount, reason: 'welcome' } });
        return amount;
      });
      if (granted) log.info('welcome_credits_granted', { userId, credits: granted });
      return granted;
    } catch (e) {
      log.warn('welcome_credits_failed', { userId, error: (e as Error).message });
      return 0;
    }
  }

  /** Retention: identities older than three years may ask again. */
  async purgeOld(now = Date.now()) {
    const { count } = await this.prisma.welcomeGrant.deleteMany({ where: { createdAt: { lt: new Date(now - RETAIN_DAYS * 86_400_000) } } });
    return count;
  }
}

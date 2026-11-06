import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hashPassword } from '../auth/crypto.js';
import { TokensService } from '../auth/tokens.service.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';

// The App Store / Google Play review account (API.md §7.40; Palemi S9). App Review needs a working sign-in; this is a
// normal USER account with an e-mail and password, issued from the admin and only for a limited time:
//   - the password is generated on the server and shown once (to paste into App Store Connect / Play Console);
//   - PRO and credits for the review period; after `reviewUntil` sign-in, token refresh and requests are refused;
//   - issuing again (a new review) sets a new password and ends earlier sessions; closing ends it now.
// The address is ours and has no mailbox: it is verified on creation and never gets a reset link.

export const REVIEW_EMAIL = 'appreview@casalume.app';
const DAY = 86_400_000;

export const IssueSchema = z
  .object({ days: z.number().int().min(1).max(30), credits: z.number().int().min(0).max(200), reason: z.string().trim().min(3).max(200) })
  .strict();

/** A password reviewers can type: 4 groups of 5 from an unambiguous alphabet (~100 bits). */
export function reviewPassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXY3479';
  const bytes = randomBytes(20);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-');
}

export const reviewExpired = (u: { reviewUntil: Date | null }, now = new Date()) => !!u.reviewUntil && u.reviewUntil.getTime() <= now.getTime();

@Injectable()
export class ReviewAccountService {
  constructor(private prisma: PrismaService, private tokens: TokensService) {}

  async status() {
    const u = await this.prisma.user.findUnique({
      where: { email: REVIEW_EMAIL },
      select: { id: true, reviewUntil: true, credits: true, createdAt: true, _count: { select: { designs: true } } },
    });
    if (!u) return { email: REVIEW_EMAIL, exists: false as const };
    const [lastLogin, sessions] = await Promise.all([
      this.prisma.loginEvent.findFirst({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, select: { ok: true, createdAt: true, device: true, ipPrefix: true } }),
      this.prisma.authSession.count({ where: { userId: u.id, revokedAt: null } }),
    ]);
    return {
      email: REVIEW_EMAIL,
      exists: true as const,
      id: u.id,
      active: !!u.reviewUntil && !reviewExpired(u),
      reviewUntil: u.reviewUntil?.toISOString() ?? null,
      credits: u.credits,
      designs: u._count.designs,
      openSessions: sessions,
      lastLogin: lastLogin ? { ok: lastLogin.ok, at: lastLogin.createdAt.toISOString(), device: lastLogin.device, ipPrefix: lastLogin.ipPrefix } : null,
    };
  }

  /** Creates the account or starts a new review period with a new password; earlier sessions end. */
  async issue(input: z.infer<typeof IssueSchema>, now = new Date()) {
    const password = reviewPassword();
    const reviewUntil = new Date(now.getTime() + input.days * DAY);
    const data = {
      passwordHash: await hashPassword(password),
      reviewUntil,
      plan: 'PRO' as const,
      planExpiresAt: reviewUntil,
      credits: input.credits,
      status: 'ACTIVE' as const,
      emailVerifiedAt: now,
      isGuest: false,
      role: 'USER' as const,
    };
    const existing = await this.prisma.user.findUnique({ where: { email: REVIEW_EMAIL }, select: { id: true, role: true } });
    // Never turn a staff account into the review account (AZ-05): the address is reserved for this one purpose.
    if (existing && existing.role !== 'USER') throw new Error('review address belongs to a staff account');
    const user = existing
      ? await this.prisma.user.update({ where: { id: existing.id }, data })
      : await this.prisma.user.create({ data: { ...data, email: REVIEW_EMAIL, name: 'App Review' } });
    if (existing) await this.tokens.revokeAll(user.id);
    log.info('review_account_issued', { userId: user.id, days: input.days });
    return { email: REVIEW_EMAIL, password, reviewUntil: reviewUntil.toISOString(), userId: user.id };
  }

  /** Ends the review period now: sign-in refused, every session closed. */
  async close(now = new Date()) {
    const u = await this.prisma.user.findUnique({ where: { email: REVIEW_EMAIL }, select: { id: true } });
    if (!u) return { closed: false };
    await this.prisma.user.update({ where: { id: u.id }, data: { reviewUntil: now, planExpiresAt: now } });
    await this.tokens.revokeAll(u.id);
    return { closed: true, userId: u.id };
  }
}

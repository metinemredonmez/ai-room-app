import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type AuthIdentity } from '../generated/prisma/client.js';
import { CONFIG, type Config } from '../config.js';
import { AppError, unauthorized } from '../common/errors.js';
import { PrismaService, RedisService } from '../common/infra.js';
import { log } from '../common/log.js';
import { QueuesService } from '../jobs/queues.service.js';
import { MailerService, renderActionMail } from '../mail/mailer.service.js';
import { UsersService } from '../users/users.service.js';
import { AppleService } from './apple.service.js';
import { randomToken, sha256 } from './crypto.js';
import { IdTokenVerifier, type IdClaims, type OAuthProvider } from './oidc.js';
import { decideLink } from './oauth-link.js';
import { AUD_APP, TokensService } from './tokens.service.js';

const NONCE_TTL_SEC = 600;
const PROVIDER_TR: Record<OAuthProvider, string> = { google: 'Google', apple: 'Apple' };

export interface SignInInput {
  token: string;
  nonce: string;
  authorizationCode?: string;
  name?: string;
  authorization?: string;
}

const isUniqueViolation = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') ||
  (e as { cause?: { kind?: string } } | null)?.cause?.kind === 'UniqueConstraintViolation';

/**
 * Sign in with Apple / Google (#7). Native SDKs hand the app an ID token; the app sends it here with
 * the nonce this server issued (TOK-03). Linking rules live in oauth-link.ts.
 */
@Injectable()
export class OAuthService {
  readonly verifier: IdTokenVerifier;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private tokens: TokensService,
    private users: UsersService,
    private apple: AppleService,
    private queues: QueuesService,
    private mailer: MailerService,
    @Inject(CONFIG) private cfg: Config,
  ) {
    const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);
    this.verifier = new IdTokenVerifier({ google: list(cfg.GOOGLE_CLIENT_IDS), apple: list(cfg.APPLE_CLIENT_IDS) });
  }

  /** TOK-03: a single-use nonce bound to one sign-in attempt; the app passes SHA-256(nonce) to the provider SDK. */
  async issueNonce(): Promise<string> {
    const nonce = randomToken(32);
    await this.redis.client.set(`oauth:nonce:${sha256(nonce)}`, '1', 'EX', NONCE_TTL_SEC);
    return nonce;
  }

  /** A present but invalid session is a 401 (the app refreshes and retries), never a silent new account. */
  private async caller(authorization?: string) {
    if (!authorization) return null;
    if (!authorization.startsWith('Bearer ')) throw unauthorized();
    const claims = await this.tokens.verify(authorization.slice(7), AUD_APP);
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.tokenVersion !== claims.ver) throw unauthorized();
    return user;
  }

  async signIn(provider: OAuthProvider, input: SignInInput) {
    const current = await this.caller(input.authorization);
    const claims = await this.verifier.verifyIdToken(provider, input.token, sha256(input.nonce));
    // Consumed only after the token proved it was minted for this nonce; a replay finds it gone.
    if ((await this.redis.client.del(`oauth:nonce:${sha256(input.nonce)}`)) !== 1) {
      throw new AppError(401, 'invalid_token', 'Giriş isteğinin süresi doldu, tekrar dene');
    }

    const identity = await this.prisma.authIdentity.findUnique({ where: { provider_subject: { provider, subject: claims.sub } } });
    const owner = claims.email ? await this.prisma.user.findUnique({ where: { email: claims.email } }) : null;
    const decision = decideLink({
      identityUserId: identity?.userId ?? null,
      current: current ? { id: current.id, isGuest: current.isGuest } : null,
      emailOwner: owner && owner.id !== current?.id ? { id: owner.id, emailVerified: !!owner.emailVerifiedAt } : null,
      providerEmailVerified: claims.emailVerified,
    });
    if (decision.kind === 'reject') throw new AppError(decision.status, decision.code, decision.message);

    const target = decision.kind === 'create' ? null : await this.users.get(decision.userId);
    if (target && target.status !== 'ACTIVE') throw new AppError(403, 'forbidden', 'Hesap askıya alınmış');

    // Apple: trade the one-time code for a refresh token we can revoke on deletion (App Store 5.1.1(v)).
    const refreshTokenEnc = provider === 'apple' && input.authorizationCode ? await this.apple.exchangeCode(claims.audience, input.authorizationCode) : null;
    const name = input.name?.trim() || claims.name;
    const identityData = {
      clientId: claims.audience, email: claims.email, emailVerified: claims.emailVerified, isPrivateEmail: claims.isPrivateEmail,
      ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
    };

    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        let id: string;
        if (decision.kind === 'create') {
          id = (await tx.user.create({
            data: {
              isGuest: false, name: name ?? null, email: claims.email,
              emailVerifiedAt: claims.email && claims.emailVerified ? new Date() : null,
            },
          })).id;
        } else if (decision.kind === 'attach' && decision.upgradeGuest) {
          // Same as e-mail registration: the guest keeps its designs, loses the device link, gets a new session.
          id = (await tx.user.update({
            where: { id: decision.userId },
            data: {
              isGuest: false, deviceHash: null, tokenVersion: { increment: 1 },
              ...(claims.email ? { email: claims.email, emailVerifiedAt: claims.emailVerified ? new Date() : null } : {}),
              ...(name && !target?.name ? { name } : {}),
            },
          })).id;
          await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        } else {
          id = decision.userId;
        }
        await tx.authIdentity.upsert({
          where: { provider_subject: { provider, subject: claims.sub } },
          create: { userId: id, provider, subject: claims.sub, ...identityData },
          update: { ...identityData, lastUsedAt: new Date() },
        });
        return id;
      });
    } catch (e) {
      // A parallel first sign-in with the same provider account won the race: use its account.
      if (!isUniqueViolation(e)) throw e;
      const winner = await this.prisma.authIdentity.findUnique({ where: { provider_subject: { provider, subject: claims.sub } } });
      if (!winner) throw e;
      userId = winner.userId;
    }

    if (decision.kind === 'attach-by-email' || (decision.kind === 'attach' && !decision.upgradeGuest)) {
      this.notifyLinked(userId, provider);
    }
    log.info('oauth_sign_in', { provider, userId, result: decision.kind, upgradedGuest: decision.kind === 'attach' && decision.upgradeGuest });
    const user = await this.users.get(userId);
    return { ...(await this.tokens.issueUser(user)), user: this.users.toDto(user), result: decision.kind === 'create' ? 'created' : decision.kind === 'login' ? 'signed_in' : 'linked' };
  }

  async identities(userId: string) {
    const [user, rows] = await Promise.all([
      this.users.get(userId),
      this.prisma.authIdentity.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      hasPassword: !!user.passwordHash,
      items: rows.map((r) => ({
        provider: r.provider, email: r.email, isPrivateEmail: r.isPrivateEmail,
        createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt.toISOString(),
      })),
    };
  }

  /** The last way to sign in can't be removed — that would lock the user out of their own data. */
  async unlink(userId: string, provider: OAuthProvider) {
    const user = await this.users.get(userId);
    const rows = await this.prisma.authIdentity.findMany({ where: { userId } });
    const target = rows.find((r) => r.provider === provider);
    if (!target) throw new AppError(404, 'not_found', 'Bu hesap bağlı değil');
    if (!user.passwordHash && rows.length < 2) {
      throw new AppError(409, 'last_login_method', 'Bu, hesabına girmenin tek yolu. Önce bir şifre belirle ya da başka bir hesap bağla.');
    }
    await this.scheduleRevoke(target);
    await this.prisma.authIdentity.delete({ where: { id: target.id } });
    log.info('oauth_unlinked', { userId, provider });
  }

  /** Before an account is deleted: queue the Apple revokes (the rows go with the account). */
  async scheduleAccountRevocations(userId: string) {
    const rows = await this.prisma.authIdentity.findMany({ where: { userId, provider: 'apple', refreshTokenEnc: { not: null } } });
    await Promise.all(rows.map((r) => this.scheduleRevoke(r)));
    return rows.length;
  }

  private async scheduleRevoke(identity: AuthIdentity) {
    if (identity.provider !== 'apple' || !identity.refreshTokenEnc || !identity.clientId) return;
    await this.queues.maintenance.add(
      'apple-revoke',
      { clientId: identity.clientId, tokenEnc: identity.refreshTokenEnc },
      { jobId: `apple-revoke-${identity.id}`, attempts: 6, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 200, removeOnFail: 500 },
    );
  }

  /**
   * TOK-05: Apple server-to-server notifications. consent-revoked ends local sessions (the next Apple
   * sign-in reaches the same account); account-delete also removes the identity.
   */
  async appleEvent(payload: string) {
    const claims = await this.verifier.verifyJwt('apple', payload);
    let event: { type?: string; sub?: string };
    try {
      event = typeof claims.events === 'string' ? JSON.parse(claims.events) : (claims.events as typeof event);
    } catch {
      throw new AppError(400, 'bad_request', 'Geçersiz olay');
    }
    if (!event?.type || !event.sub) throw new AppError(400, 'bad_request', 'Geçersiz olay');
    if ((await this.redis.client.set(`apple:event:${sha256(payload)}`, '1', 'EX', 172_800, 'NX')) !== 'OK') return { duplicate: true };
    const identity = await this.prisma.authIdentity.findUnique({ where: { provider_subject: { provider: 'apple', subject: event.sub } } });
    if (!identity) {
      log.info('apple_event_unmatched', { type: event.type });
      return { matched: false };
    }
    if (event.type === 'consent-revoked') {
      await this.prisma.authIdentity.update({ where: { id: identity.id }, data: { refreshTokenEnc: null } });
      await this.tokens.revokeAll(identity.userId);
    } else if (event.type === 'account-delete') {
      await this.prisma.authIdentity.delete({ where: { id: identity.id } });
      await this.tokens.revokeAll(identity.userId);
    }
    log.info('apple_event', { type: event.type, userId: identity.userId });
    return { matched: true };
  }

  private notifyLinked(userId: string, provider: OAuthProvider) {
    void this.users
      .get(userId)
      .then((u) => {
        if (!u.email) return;
        return this.mailer.send(
          renderActionMail({
            to: u.email, subject: `AI Room · ${PROVIDER_TR[provider]} hesabın bağlandı`, heading: `${PROVIDER_TR[provider]} hesabın bağlandı`,
            lines: [`AI Room hesabına artık ${PROVIDER_TR[provider]} ile de giriş yapabilirsin.`, 'Bunu sen yapmadıysan şifreni değiştir ve bize yaz.'],
            cta: 'AI Room', url: this.cfg.WEB_APP_URL, footer: 'Bu e-posta hesap güvenliğin için gönderildi.',
          }),
        );
      })
      .catch((e: Error) => log.error('oauth_notice_failed', { error: e.name }));
  }
}

export type { IdClaims };

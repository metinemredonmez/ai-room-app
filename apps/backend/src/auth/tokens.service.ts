import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { CONFIG, type Config } from '../config.js';
import { unauthorized, AppError } from '../common/errors.js';
import { todayInIstanbul, type AppRequest } from '../common/http.js';
import { PrismaService } from '../common/infra.js';
import type { User } from '../generated/prisma/client.js';
import { MIN_ROLE, atLeast, isAdminRole, type AdminRole } from '../admin/roles.js';
import { log } from '../common/log.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import type { ClientInfo } from './client-info.js';
import { randomToken, sha256 } from './crypto.js';

// TOK-01 / TOK-02: HS256 only, fixed issuer, one audience per purpose, explicit token type.
const ISSUER = 'casalume';
export const AUD_APP = 'casalume-app';
export const AUD_ADMIN = 'casalume-admin';
const ACCESS_TTL_SEC = 15 * 60;
const ADMIN_TTL_SEC = 2 * 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface Claims {
  sub: string;
  ver: number;
  typ: 'access';
  amr?: string[];
  /** API.md §7.37: the session (refresh family) this app token belongs to; a closed session's tokens stop at once. */
  sid?: string;
}

export type SessionMethod = 'password' | 'register' | 'guest' | 'google' | 'apple' | 'review';
export type SessionOrigin = { method: SessionMethod; client: ClientInfo };

@Injectable()
export class TokensService {
  private key: Uint8Array;
  /** ADMIN_DEV_SKIP_MFA (development only): admin tokens without a second factor are accepted. */
  readonly devSkipMfa: boolean;
  /** ADMIN_PANEL_KEY set: logins through the IP-restricted admin panel need no second factor (owner decision). */
  readonly panelKey: string | null;

  constructor(private prisma: PrismaService, @Inject(CONFIG) cfg: Config) {
    this.key = new TextEncoder().encode(cfg.JWT_SECRET);
    this.devSkipMfa = cfg.ADMIN_DEV_SKIP_MFA;
    this.panelKey = cfg.ADMIN_PANEL_KEY ?? null;
  }

  /** Constant-time check of the admin panel key header. */
  isPanel(header: unknown): boolean {
    if (!this.panelKey || typeof header !== 'string') return false;
    const a = Buffer.from(header);
    const b = Buffer.from(this.panelKey);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private sign(user: Pick<User, 'id' | 'tokenVersion'>, audience: string, ttlSec: number, amr?: string[], sid?: string) {
    return new SignJWT({ ver: user.tokenVersion, typ: 'access', ...(amr ? { amr } : {}), ...(sid ? { sid } : {}) })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(audience)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(`${ttlSec}s`)
      .sign(this.key);
  }

  async verify(token: string, audience: string): Promise<Claims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'], issuer: ISSUER, audience });
      if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.ver !== 'number') {
        throw new Error('bad claims');
      }
      return payload as unknown as Claims;
    } catch {
      throw unauthorized();
    }
  }

  /** A new sign-in (no familyId) opens a session row (API.md §7.37); a rotation keeps the family and its session. */
  async issueUser(user: User, familyId?: string, origin?: SessionOrigin) {
    const family = familyId ?? randomUUID();
    if (!familyId) {
      await this.prisma.authSession.create({
        data: { id: family, userId: user.id, method: origin?.method ?? 'unknown', device: origin?.client.device ?? 'Bilinmeyen cihaz', ipPrefix: origin?.client.ipPrefix ?? '?' },
      });
    }
    const refreshToken = randomToken(32);
    await this.prisma.refreshToken.create({
      data: { userId: user.id, familyId: family, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
    });
    return { accessToken: await this.sign(user, AUD_APP, ACCESS_TTL_SEC, undefined, family), refreshToken, expiresIn: ACCESS_TTL_SEC };
  }

  /**
   * amr records the second factor: `otp` (TOTP), `mfa` (single-use recovery code), `dev` (none, ADMIN_DEV_SKIP_MFA)
   * or `panel` (none, login through the IP-restricted admin panel, ADMIN_PANEL_KEY).
   */
  async issueAdmin(user: User, factor: 'otp' | 'backup' | 'dev' | 'panel' = 'otp') {
    const amr = ['pwd', factor === 'otp' ? 'otp' : factor === 'backup' ? 'mfa' : factor];
    return { accessToken: await this.sign(user, AUD_ADMIN, ADMIN_TTL_SEC, amr), expiresIn: ADMIN_TTL_SEC };
  }

  /** SES-05: single-use rotation; presenting a used token revokes the whole family. */
  async rotate(refreshToken: string, client?: ClientInfo): Promise<{ user: User; tokens: Awaited<ReturnType<TokensService['issueUser']>> }> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!row) throw unauthorized();
    if (row.usedAt || row.revokedAt) {
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: now } }),
        this.prisma.authSession.updateMany({ where: { id: row.familyId, revokedAt: null }, data: { revokedAt: now } }),
      ]);
      throw unauthorized('Oturum yeniden kullanım nedeniyle kapatıldı');
    }
    if (row.expiresAt < new Date() || row.user.status !== 'ACTIVE') throw unauthorized();
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw unauthorized(); // lost a race with a concurrent refresh
    // Families opened before sessions were recorded get their row on the first rotation.
    await this.prisma.authSession.upsert({
      where: { id: row.familyId },
      create: { id: row.familyId, userId: row.userId, method: 'unknown', device: client?.device ?? 'Bilinmeyen cihaz', ipPrefix: client?.ipPrefix ?? '?' },
      update: { lastUsedAt: new Date(), ...(client ? { device: client.device, ipPrefix: client.ipPrefix } : {}) },
    });
    return { user: row.user, tokens: await this.issueUser(row.user, row.familyId) };
  }

  async revoke(refreshToken: string) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (row) {
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: now } }),
        this.prisma.authSession.updateMany({ where: { id: row.familyId, revokedAt: null }, data: { revokedAt: now } }),
      ]);
    }
  }

  /** SES-04: bumping tokenVersion invalidates every outstanding access token; refresh families go too. */
  async revokeAll(userId: string) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
    ]);
  }

  /** SES-04 (API.md §7.37): close one session of this user; its access token is refused from the next request. */
  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const now = new Date();
    const [, closed] = await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({ where: { userId, familyId: sessionId, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.authSession.updateMany({ where: { userId, id: sessionId, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    return closed.count > 0;
  }

  /** Every session but this one (families opened before sessions were recorded included). */
  async revokeOthers(userId: string, keepSessionId: string): Promise<number> {
    const now = new Date();
    const [, closed] = await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({ where: { userId, familyId: { not: keepSessionId }, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.authSession.updateMany({ where: { userId, id: { not: keepSessionId }, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    return closed.count;
  }
}

function bearer(req: AppRequest): string {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();
  return token;
}

/** AZ-01: authenticated app user whose account is active and whose token version is current. */
@Injectable()
export class UserGuard implements CanActivate {
  constructor(private tokens: TokensService, private prisma: PrismaService, private loyalty: LoyaltyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const claims = await this.tokens.verify(bearer(req), AUD_APP);
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true, role: true, isGuest: true, status: true, tokenVersion: true, lastSeenAt: true, streakDay: true,
        ...(claims.sid ? { authSessions: { where: { id: claims.sid }, select: { revokedAt: true } } } : {}),
      },
    });
    if (!user || user.tokenVersion !== claims.ver) throw unauthorized();
    // SES-04: a closed session's access token stops working at once, not when it expires.
    if (claims.sid) {
      const session = (user as { authSessions?: Array<{ revokedAt: Date | null }> }).authSessions?.[0];
      if (!session || session.revokedAt) throw unauthorized('Bu oturum kapatıldı');
    }
    if (user.status !== 'ACTIVE') throw new AppError(403, 'forbidden', 'Hesap askıya alınmış');
    req.auth = { userId: user.id, role: user.role, isGuest: user.isGuest, admin: false, sessionId: claims.sid ?? null };
    if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 5 * 60_000) {
      void this.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    }
    // API.md §7.35: the first request of an Istanbul day moves the streak (and may pay its gift), in the background.
    if (user.streakDay !== todayInIstanbul()) {
      void this.loyalty.activeDay(user.id).catch((e: Error) => log.warn('loyalty_streak_failed', { error: e.name }));
    }
    return true;
  }
}

/**
 * AUT-01 / AZ-05: admin audience, MFA-complete token, and the role re-read from the database on every
 * request — a demotion or MFA reset takes effect on the very next call, not when the token expires.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private tokens: TokensService, private prisma: PrismaService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const claims = await this.tokens.verify(bearer(req), AUD_ADMIN);
    // A `dev` token stops working as soon as ADMIN_DEV_SKIP_MFA is switched off.
    // A panel token stops working as soon as ADMIN_PANEL_KEY is removed (the code is required again).
    if (!claims.amr?.some((m) => m === 'otp' || m === 'mfa' || (m === 'dev' && this.tokens.devSkipMfa) || (m === 'panel' && this.tokens.panelKey))) throw unauthorized();
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, role: true, status: true, tokenVersion: true },
    });
    if (!user || user.tokenVersion !== claims.ver || user.status !== 'ACTIVE') throw unauthorized();
    if (!isAdminRole(user.role)) throw new AppError(403, 'forbidden', 'Yönetici yetkisi gerekli');
    const need = this.reflector.getAllAndOverride<AdminRole | undefined>(MIN_ROLE, [ctx.getHandler(), ctx.getClass()]);
    if (!need || !atLeast(user.role, need)) {
      log.warn('admin_forbidden', { userId: user.id, role: user.role, need: need ?? 'undeclared', path: req.path });
      throw new AppError(403, 'forbidden', 'Bu işlem için yetkiniz yok');
    }
    req.auth = { userId: user.id, role: user.role, isGuest: false, admin: true };
    return true;
  }
}

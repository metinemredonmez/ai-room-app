import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { CONFIG, type Config } from '../config.js';
import { unauthorized, AppError } from '../common/errors.js';
import type { AppRequest } from '../common/http.js';
import { PrismaService } from '../common/infra.js';
import type { User } from '../generated/prisma/client.js';
import { randomToken, sha256 } from './crypto.js';

// TOK-01 / TOK-02: HS256 only, fixed issuer, one audience per purpose, explicit token type.
const ISSUER = 'ai-room';
export const AUD_APP = 'ai-room-app';
export const AUD_ADMIN = 'ai-room-admin';
const ACCESS_TTL_SEC = 15 * 60;
const ADMIN_TTL_SEC = 2 * 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface Claims {
  sub: string;
  ver: number;
  typ: 'access';
  amr?: string[];
}

@Injectable()
export class TokensService {
  private key: Uint8Array;

  constructor(private prisma: PrismaService, @Inject(CONFIG) cfg: Config) {
    this.key = new TextEncoder().encode(cfg.JWT_SECRET);
  }

  private sign(user: Pick<User, 'id' | 'tokenVersion'>, audience: string, ttlSec: number, amr?: string[]) {
    return new SignJWT({ ver: user.tokenVersion, typ: 'access', ...(amr ? { amr } : {}) })
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

  async issueUser(user: User, familyId: string = randomUUID()) {
    const refreshToken = randomToken(32);
    await this.prisma.refreshToken.create({
      data: { userId: user.id, familyId, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
    });
    return { accessToken: await this.sign(user, AUD_APP, ACCESS_TTL_SEC), refreshToken, expiresIn: ACCESS_TTL_SEC };
  }

  async issueAdmin(user: User) {
    return { accessToken: await this.sign(user, AUD_ADMIN, ADMIN_TTL_SEC, ['pwd', 'otp']), expiresIn: ADMIN_TTL_SEC };
  }

  /** SES-05: single-use rotation; presenting a used token revokes the whole family. */
  async rotate(refreshToken: string): Promise<{ user: User; tokens: Awaited<ReturnType<TokensService['issueUser']>> }> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!row) throw unauthorized();
    if (row.usedAt || row.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw unauthorized('Oturum yeniden kullanım nedeniyle kapatıldı');
    }
    if (row.expiresAt < new Date() || row.user.status !== 'ACTIVE') throw unauthorized();
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw unauthorized(); // lost a race with a concurrent refresh
    return { user: row.user, tokens: await this.issueUser(row.user, row.familyId) };
  }

  async revoke(refreshToken: string) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (row) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
  }

  /** SES-04: bumping tokenVersion invalidates every outstanding access token; refresh families go too. */
  async revokeAll(userId: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
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
  constructor(private tokens: TokensService, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const claims = await this.tokens.verify(bearer(req), AUD_APP);
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, role: true, isGuest: true, status: true, tokenVersion: true, lastSeenAt: true },
    });
    if (!user || user.tokenVersion !== claims.ver) throw unauthorized();
    if (user.status !== 'ACTIVE') throw new AppError(403, 'forbidden', 'Hesap askıya alınmış');
    req.auth = { userId: user.id, role: user.role, isGuest: user.isGuest, admin: false };
    if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 5 * 60_000) {
      void this.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    }
    return true;
  }
}

/** AUT-01 / AZ-05: admin audience, MFA-complete token, ADMIN role re-checked on every request. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private tokens: TokensService, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const claims = await this.tokens.verify(bearer(req), AUD_ADMIN);
    if (!claims.amr?.includes('otp')) throw unauthorized();
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, role: true, status: true, tokenVersion: true },
    });
    if (!user || user.tokenVersion !== claims.ver || user.status !== 'ACTIVE') throw unauthorized();
    if (user.role !== 'ADMIN') throw new AppError(403, 'forbidden', 'Yönetici yetkisi gerekli');
    req.auth = { userId: user.id, role: 'ADMIN', isGuest: false, admin: true };
    return true;
  }
}

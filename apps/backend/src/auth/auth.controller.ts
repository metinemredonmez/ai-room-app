import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type Config } from '../config.js';
import { AppError, parse, unauthorized } from '../common/errors.js';
import { Req, type AppRequest } from '../common/http.js';
import { LIMITS, PrismaService, RateLimiter } from '../common/infra.js';
import { log } from '../common/log.js';
import { AuditService } from '../admin/audit.service.js';
import { UsersService } from '../users/users.service.js';
import { hashPassword, sha256, verifyPassword, verifyTotp } from './crypto.js';
import { AUD_APP, TokensService } from './tokens.service.js';

const email = z.email().max(254).transform((v) => v.trim().toLowerCase());
// PWD (NIST 800-63B): length over composition rules; 10+ chars, no arbitrary complexity rules.
const password = z.string().min(10).max(128);

const GuestSchema = z.object({ deviceId: z.string().regex(/^[A-Za-z0-9-]{16,64}$/) }).strict();
const RegisterSchema = z.object({ email, password, name: z.string().trim().min(1).max(80).optional() }).strict();
const LoginSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
const RefreshSchema = z.object({ refreshToken: z.string().min(20).max(200) }).strict();
const AdminLoginSchema = z.object({ email, password: z.string().min(1).max(128), otp: z.string().regex(/^\d{6}$/) }).strict();

const INVALID = () => new AppError(401, 'unauthorized', 'E-posta veya şifre hatalı');

@Controller('v1/auth')
export class AuthController {
  constructor(
    private prisma: PrismaService,
    private tokens: TokensService,
    private users: UsersService,
    private limiter: RateLimiter,
    private audit: AuditService,
    @Inject(CONFIG) private cfg: Config,
  ) {}

  private async respond(userId: string, familyId?: string) {
    const user = await this.users.get(userId);
    const tokens = await this.tokens.issueUser(user, familyId);
    return { ...tokens, user: this.users.toDto(user) };
  }

  @Post('guest')
  async guest(@Body() body: unknown, @Req() req: AppRequest) {
    const { deviceId } = parse(GuestSchema, body);
    await this.limiter.hit(LIMITS.guest, req.clientIp);
    const deviceHash = sha256(`${this.cfg.DEVICE_PEPPER}:${deviceId}`);
    const existing = await this.prisma.user.findUnique({ where: { deviceHash } });
    if (existing) {
      if (existing.status !== 'ACTIVE') throw new AppError(403, 'forbidden', 'Hesap askıya alınmış');
      return this.respond(existing.id);
    }
    const user = await this.prisma.user.create({ data: { deviceHash, isGuest: true } });
    return this.respond(user.id);
  }

  @Post('register')
  async register(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(RegisterSchema, body);
    await this.limiter.hit(LIMITS.register, req.clientIp);
    if (await this.prisma.user.findUnique({ where: { email: input.email } })) {
      throw new AppError(409, 'conflict', 'Bu e-posta ile kayıtlı bir hesap var');
    }
    const passwordHash = await hashPassword(input.password);

    // A valid guest token upgrades that guest (keeps designs); the device link is dropped so the
    // device id can no longer be used to sign into a registered account.
    let guestId: string | null = null;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const claims = await this.tokens.verify(header.slice(7), AUD_APP).catch(() => null);
      const guest = claims ? await this.prisma.user.findUnique({ where: { id: claims.sub } }) : null;
      if (guest?.isGuest && guest.tokenVersion === claims?.ver) guestId = guest.id;
    }
    const data = { email: input.email, passwordHash, name: input.name ?? null, isGuest: false, deviceHash: null };
    const user = guestId
      ? await this.prisma.user.update({ where: { id: guestId }, data: { ...data, tokenVersion: { increment: 1 } } })
      : await this.prisma.user.create({ data });
    if (guestId) await this.tokens.revokeAll(user.id).catch(() => undefined); // SES-02: new session on privilege change
    log.info('user_registered', { userId: user.id, upgradedGuest: Boolean(guestId) });
    return this.respond(user.id);
  }

  @Post('login')
  async login(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(LoginSchema, body);
    // AUT-02: per-IP and per-account budgets; no permanent lockout a third party could trigger.
    await this.limiter.hit(LIMITS.loginIp, req.clientIp);
    await this.limiter.hit(LIMITS.loginAccount, sha256(input.email));
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const ok = await verifyPassword(user?.passwordHash, input.password);
    if (!user || !ok) {
      log.warn('login_failed', { ip: req.clientIp, reason: user ? 'bad_password' : 'unknown_account' });
      throw INVALID();
    }
    if (user.status !== 'ACTIVE') throw new AppError(403, 'forbidden', 'Hesap askıya alınmış');
    await this.limiter.reset(LIMITS.loginAccount, sha256(input.email));
    log.info('login_succeeded', { userId: user.id, ip: req.clientIp });
    return this.respond(user.id);
  }

  @Post('refresh')
  async refresh(@Body() body: unknown, @Req() req: AppRequest) {
    const { refreshToken } = parse(RefreshSchema, body);
    await this.limiter.hit(LIMITS.ip, req.clientIp);
    const { user, tokens } = await this.tokens.rotate(refreshToken);
    return { ...tokens, user: this.users.toDto(user) };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: unknown) {
    const { refreshToken } = parse(RefreshSchema, body);
    await this.tokens.revoke(refreshToken);
  }
}

@Controller('v1/admin/auth')
export class AdminAuthController {
  constructor(
    private prisma: PrismaService,
    private tokens: TokensService,
    private users: UsersService,
    private limiter: RateLimiter,
    private audit: AuditService,
  ) {}

  /** AUT-01: password + TOTP in one step; codes are single-use (step must advance). */
  @Post('login')
  async login(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(AdminLoginSchema, body);
    await this.limiter.hit(LIMITS.adminLogin, req.clientIp);
    await this.limiter.hit(LIMITS.loginAccount, sha256(`admin:${input.email}`));
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const ok = await verifyPassword(user?.passwordHash, input.password);
    const step = user?.totpSecret ? verifyTotp(user.totpSecret, input.otp) : null;
    const fresh = step !== null && (user?.totpLastStep == null || BigInt(step) > user.totpLastStep);
    if (!user || !ok || user.role !== 'ADMIN' || user.status !== 'ACTIVE' || !fresh) {
      await this.audit.record(null, 'admin.login_failed', 'user', user?.id ?? null, { email: sha256(input.email).slice(0, 12) }, req.clientIp);
      throw new AppError(401, 'unauthorized', 'Giriş bilgileri hatalı');
    }
    const claimed = await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: BigInt(step!) } }] },
      data: { totpLastStep: BigInt(step!), lastSeenAt: new Date() },
    });
    if (claimed.count !== 1) throw unauthorized('Kod zaten kullanıldı');
    await this.limiter.reset(LIMITS.loginAccount, sha256(`admin:${input.email}`));
    await this.audit.record(user.id, 'admin.login', 'user', user.id, {}, req.clientIp);
    const tokens = await this.tokens.issueAdmin(user);
    return { ...tokens, admin: this.users.toDto(user) };
  }
}

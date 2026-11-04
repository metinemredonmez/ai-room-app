import { Body, Controller, Headers, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Doc } from '../common/openapi.js';
import { z } from 'zod';
import { CONFIG, type Config } from '../config.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, PrismaService, RateLimiter } from '../common/infra.js';
import { log } from '../common/log.js';
import { AuditService } from '../admin/audit.service.js';
import { AdminSecurityService } from '../admin/admin-security.service.js';
import { isAdminRole } from '../admin/roles.js';
import { UsersService } from '../users/users.service.js';
import { hashPassword, newTotpSecret, otpauthUri, sha256, verifyPassword, verifyTotp } from './crypto.js';
import { EmailTokensService } from './email-tokens.service.js';
import { OAuthService } from './oauth.service.js';
import { AUD_APP, TokensService, UserGuard } from './tokens.service.js';

const email = z.email().max(254).transform((v) => v.trim().toLowerCase());
// PWD (NIST 800-63B): length over composition rules; 10+ chars, no arbitrary complexity rules.
const password = z.string().min(10).max(128);

const GuestSchema = z.object({ deviceId: z.string().regex(/^[A-Za-z0-9-]{16,64}$/) }).strict();
const RegisterSchema = z.object({ email, password, name: z.string().trim().min(1).max(80).optional() }).strict();
const LoginSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
const RefreshSchema = z.object({ refreshToken: z.string().min(20).max(200) }).strict();
const emailToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const ForgotSchema = z.object({ email }).strict();
const ResetSchema = z.object({ token: emailToken, password }).strict();
const VerifySchema = z.object({ token: emailToken }).strict();
const nonce = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const idToken = z.string().min(100).max(4096);
const GoogleSchema = z.object({ idToken, nonce }).strict();
const AppleSchema = z
  .object({
    identityToken: idToken,
    nonce,
    authorizationCode: z.string().regex(/^[A-Za-z0-9._-]{10,1024}$/).optional(),
    name: z.string().trim().min(1).max(80).optional(), // Apple sends the name to the app only on first sign-in
  })
  .strict();
const otp = z.string().regex(/^\d{6}$/);
const AdminLoginSchema = z
  .object({ email, password: z.string().min(1).max(128), otp: otp.optional(), backupCode: z.string().min(10).max(16).optional() })
  .strict()
  .refine((v) => !(v.otp && v.backupCode), { message: 'otp veya backupCode (yalnız biri)', path: ['otp'] });
const AdminEnrollSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
const AdminConfirmSchema = z.object({ email, password: z.string().min(1).max(128), otp }).strict();

const INVALID = () => new AppError(401, 'unauthorized', 'E-posta veya şifre hatalı');

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private prisma: PrismaService,
    private tokens: TokensService,
    private users: UsersService,
    private limiter: RateLimiter,
    private audit: AuditService,
    private emailTokens: EmailTokensService,
    private oauth: OAuthService,
    @Inject(CONFIG) private cfg: Config,
  ) {}

  private async respond(userId: string, familyId?: string) {
    const user = await this.users.get(userId);
    const tokens = await this.tokens.issueUser(user, familyId);
    return { ...tokens, user: this.users.toDto(user) };
  }

  @Post('guest')
  @Doc('Misafir girişi (cihaz kimliğiyle)', { body: GuestSchema, status: 201, response: 'AuthResponse', errors: [400, 403, 429] })
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
  @Doc('Kayıt ol (geçerli misafir Bearer varsa misafir hesabı yükseltilir)', { body: RegisterSchema, status: 201, response: 'AuthResponse', errors: [400, 409, 429] })
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
    void this.emailTokens.sendVerification(user).catch((e: Error) => log.error('mail_failed', { kind: 'verify', error: e.name }));
    return this.respond(user.id);
  }

  @Post('login')
  @Doc('E-posta + parola ile giriş', { body: LoginSchema, status: 201, response: 'AuthResponse', errors: [400, 401, 403, 429] })
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

  /** TOK-03: step 1 of Apple / Google sign-in — a single-use nonce for this attempt (10 minutes). */
  @Post('oauth/nonce')
  @Doc('Apple/Google girişi 1/2: tek kullanımlık nonce (10 dk). Uygulama sağlayıcıya SHA-256(nonce) (hex) verir', { status: 201, response: { type: 'object', properties: { nonce: { type: 'string' }, expiresIn: { type: 'number' } } }, errors: [429] })
  async oauthNonce(@Req() req: AppRequest) {
    await this.limiter.hit(LIMITS.oauthNonce, req.clientIp);
    return { nonce: await this.oauth.issueNonce(), expiresIn: 600 };
  }

  @Post('oauth/google')
  @Doc('Google ile giriş 2/2: ID token + nonce. Geçerli oturum (misafir dahil) Bearer ile gelirse hesaba bağlanır', { body: GoogleSchema, status: 201, response: 'AuthResponse', description: 'Sonuç `result`: created | signed_in | linked. 409 `account_exists`: aynı e-postayla doğrulanmamış hesap var; 409 `identity_in_use`: bu Google hesabı başka kullanıcıya bağlı; 503 `oauth_not_configured`.', errors: [400, 401, 403, 409, 429, 503] })
  async google(@Body() body: unknown, @Req() req: AppRequest, @Headers('authorization') authorization?: string) {
    const input = parse(GoogleSchema, body);
    await this.limiter.hit(LIMITS.oauthLogin, req.clientIp);
    return this.oauth.signIn('google', { token: input.idToken, nonce: input.nonce, authorization });
  }

  @Post('oauth/apple')
  @Doc('Apple ile giriş 2/2: identityToken + nonce (+ authorizationCode: hesap silinince Apple token iptali için)', { body: AppleSchema, status: 201, response: 'AuthResponse', description: 'Bağlama kuralları Google ile aynı. `name` yalnız ilk girişte (Apple adı yalnız o zaman verir).', errors: [400, 401, 403, 409, 429, 503] })
  async appleSignIn(@Body() body: unknown, @Req() req: AppRequest, @Headers('authorization') authorization?: string) {
    const input = parse(AppleSchema, body);
    await this.limiter.hit(LIMITS.oauthLogin, req.clientIp);
    return this.oauth.signIn('apple', {
      token: input.identityToken, nonce: input.nonce, authorizationCode: input.authorizationCode, name: input.name, authorization,
    });
  }

  @Post('refresh')
  @Doc('Refresh token rotasyonu (yeniden kullanımda aile iptali, SES-05)', { body: RefreshSchema, status: 201, response: 'AuthResponse', errors: [401] })
  async refresh(@Body() body: unknown, @Req() req: AppRequest) {
    const { refreshToken } = parse(RefreshSchema, body);
    await this.limiter.hit(LIMITS.ip, req.clientIp);
    const { user, tokens } = await this.tokens.rotate(refreshToken);
    return { ...tokens, user: this.users.toDto(user) };
  }

  @Post('logout')
  @HttpCode(204)
  @Doc('Çıkış (refresh ailesi iptal)', { body: RefreshSchema, status: 204 })
  async logout(@Body() body: unknown) {
    const { refreshToken } = parse(RefreshSchema, body);
    await this.tokens.revoke(refreshToken);
  }

  /**
   * Always 202 with the same body: the answer, the per-account budget and (because the mail is sent
   * in the background) the timing do not reveal whether the address has an account.
   */
  @Post('password/forgot')
  @HttpCode(202)
  @Doc('Şifre sıfırlama bağlantısı iste', { body: ForgotSchema, status: 202, response: 'Ok', description: 'Hesap olsun olmasın aynı yanıt döner; bağlantı yalnız WEB_APP_URL üzerinden, token URL fragment\'ında (AUT-03, MAIL-01).', errors: [400, 429] })
  async forgotPassword(@Body() body: unknown, @Req() req: AppRequest) {
    const { email: address } = parse(ForgotSchema, body);
    await this.limiter.hit(LIMITS.forgotIp, req.clientIp);
    const withinBudget = await this.limiter.allow(LIMITS.forgotAccount, sha256(address));
    const user = withinBudget ? await this.prisma.user.findUnique({ where: { email: address } }) : null;
    if (user && !user.isGuest && user.passwordHash && user.status === 'ACTIVE') {
      void this.emailTokens.sendPasswordReset(user).catch((e: Error) => log.error('mail_failed', { kind: 'reset', error: e.name }));
    }
    log.info('password_reset_requested', { ip: req.clientIp, delivered: Boolean(user), throttled: !withinBudget });
    return { ok: true };
  }

  /** AUT-03 + SES-04: one-time token; on success every session and outstanding e-mail token is revoked. */
  @Post('password/reset')
  @HttpCode(204)
  @Doc('Yeni şifre belirle (tüm oturumlar kapanır, SES-04)', { body: ResetSchema, status: 204, errors: [400, 429] })
  async resetPassword(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(ResetSchema, body);
    await this.limiter.hit(LIMITS.tokenIp, req.clientIp);
    const user = await this.emailTokens.consume(input.token, 'RESET_PASSWORD');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.password), emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    });
    await this.tokens.revokeAll(user.id);
    await this.prisma.emailToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    if (user.email) await this.limiter.reset(LIMITS.loginAccount, sha256(user.email));
    if (isAdminRole(user.role)) await this.audit.record(user.id, 'auth.password_reset', 'user', user.id, {}, req.clientIp);
    log.info('password_reset_completed', { userId: user.id });
  }

  @Post('email/verify')
  @Doc('E-posta doğrula', { body: VerifySchema, status: 201, response: 'Ok', errors: [400, 429] })
  async verifyEmail(@Body() body: unknown, @Req() req: AppRequest) {
    const { token } = parse(VerifySchema, body);
    await this.limiter.hit(LIMITS.tokenIp, req.clientIp);
    const user = await this.emailTokens.consume(token, 'VERIFY_EMAIL');
    if (!user.emailVerifiedAt) await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    log.info('email_verified', { userId: user.id });
    return { ok: true };
  }

  @Post('email/resend')
  @HttpCode(202)
  @UseGuards(UserGuard)
  @ApiBearerAuth('user')
  @Doc('Doğrulama e-postasını tekrar gönder', { status: 202, errors: [400, 401, 429] })
  async resendVerification(@Auth() auth: AuthContext) {
    await this.limiter.hit(LIMITS.verifyResend, auth.userId);
    const user = await this.users.get(auth.userId);
    if (user.isGuest || !user.email) throw new AppError(400, 'bad_request', 'Önce bir e-posta ile kayıt olmalısın');
    if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    await this.emailTokens.sendVerification(user);
    return { ok: true, alreadyVerified: false };
  }
}

@ApiTags('admin-auth')
@Controller('v1/admin/auth')
export class AdminAuthController {
  constructor(
    private prisma: PrismaService,
    private tokens: TokensService,
    private users: UsersService,
    private limiter: RateLimiter,
    private audit: AuditService,
    private security: AdminSecurityService,
  ) {}

  /**
   * AUT-01: password + second factor in one step, for every admin role. The factor is a TOTP code
   * (its time step must advance, so a code works once) or a single-use recovery code (AUT-04).
   */
  @Post('login')
  @Doc('Admin girişi: parola + TOTP **veya** tek kullanımlık yedek kod (AUT-01/AUT-04)', { body: AdminLoginSchema, status: 201, description: 'Doğrulayıcısı kayıtlı olmayan, kayıt süresi açık bir yönetici doğru parolayla 403 `mfa_enrollment_required` alır → `/mfa/enroll`.', response: { type: 'object', properties: { accessToken: { type: 'string' }, expiresIn: { type: 'number' }, admin: { $ref: '#/components/schemas/User' }, backupCodesRemaining: { type: 'number' } } }, errors: [400, 401, 403, 429] })
  async login(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(AdminLoginSchema, body);
    // Development machines may switch the second factor off (ADMIN_DEV_SKIP_MFA, refused outside development).
    // Logins through the IP-restricted admin panel skip it too when ADMIN_PANEL_KEY is set (owner decision).
    const panel = this.tokens.isPanel(req.headers['x-admin-panel-key']);
    const devSkip = (this.tokens.devSkipMfa || panel) && !input.otp && !input.backupCode;
    await this.limiter.hit(LIMITS.adminLogin, req.clientIp);
    await this.limiter.hit(LIMITS.loginAccount, sha256(`admin:${input.email}`));
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const ok = await verifyPassword(user?.passwordHash, input.password);
    const fail = async () => {
      await this.audit.record(null, 'admin.login_failed', 'user', user?.id ?? null, { email: sha256(input.email).slice(0, 12) }, req.clientIp);
      return new AppError(401, 'unauthorized', 'Giriş bilgileri hatalı');
    };
    if (!user || !ok || !isAdminRole(user.role) || user.status !== 'ACTIVE') throw await fail();
    if (!user.totpSecret && !devSkip) {
      // Password is right but no authenticator yet: only inside the enrollment window.
      if (user.mfaEnrollBefore && user.mfaEnrollBefore > new Date()) {
        throw new AppError(403, 'mfa_enrollment_required', 'Doğrulayıcı uygulamanı kaydetmen gerekiyor');
      }
      throw await fail();
    }
    // No factor at all fails like a wrong code: a correct password alone reveals nothing. Checked after the
    // enrollment branch, so a newly promoted admin learns that setup is due without having a code yet.
    if (!devSkip && !input.otp && !input.backupCode) throw await fail();
    // Recovery codes are only spent after the password checked out.
    const remaining = input.backupCode ? await this.security.consumeBackupCode(user.id, input.backupCode) : null;
    const passed = devSkip || (input.backupCode ? remaining !== null : await this.security.claimTotp(user, input.otp!));
    const factor = devSkip ? (panel ? 'panel' : 'dev') : input.backupCode ? 'backup' : 'otp';
    if (!passed) throw await fail();
    await this.limiter.reset(LIMITS.loginAccount, sha256(`admin:${input.email}`));
    await this.audit.record(user.id, 'admin.login', 'user', user.id, { factor, ...(remaining !== null ? { backupCodesRemaining: remaining } : {}) }, req.clientIp);
    if (remaining !== null) {
      log.warn('admin_backup_code_used', { userId: user.id, remaining });
      this.security.notify(user, 'Yedek kodla giriş yapıldı', [
        'Casalume yönetim hesabına tek kullanımlık bir yedek kodla giriş yapıldı.',
        `Kalan yedek kod: ${remaining}. ${remaining <= 3 ? 'Panelden yeni kodlar oluşturmanı öneririz.' : ''}`.trim(),
      ]);
    }
    if (devSkip) log.warn('admin_login_without_mfa', { userId: user.id, via: factor });
    const tokens = await this.tokens.issueAdmin(user, factor);
    return { ...tokens, admin: this.users.toDto(user), ...(remaining !== null ? { backupCodesRemaining: remaining } : {}) };
  }

  /** Step 1 for a promoted / MFA-reset admin: password → a fresh secret to add to the authenticator. */
  @Post('mfa/enroll')
  @Doc('Doğrulayıcı kaydı 1/2: parola → TOTP sırrı (yalnız 72 saatlik kayıt penceresinde)', { body: AdminEnrollSchema, status: 201, response: { type: 'object', properties: { secret: { type: 'string' }, otpauth: { type: 'string' } } }, errors: [400, 401, 429] })
  async enroll(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(AdminEnrollSchema, body);
    const user = await this.enrollable(input.email, input.password, req);
    const secret = newTotpSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { totpPendingSecret: secret } });
    await this.audit.record(user.id, 'admin.mfa_enroll_started', 'user', user.id, {}, req.clientIp);
    return { secret, otpauth: otpauthUri(secret, user.email!) };
  }

  /** Step 2: the first code proves the authenticator works; MFA is complete only now, so tokens come only now. */
  @Post('mfa/confirm')
  @Doc('Doğrulayıcı kaydı 2/2: ilk kod → oturum + 10 yedek kod (bir kez gösterilir)', { body: AdminConfirmSchema, status: 201, response: { type: 'object', properties: { accessToken: { type: 'string' }, expiresIn: { type: 'number' }, admin: { $ref: '#/components/schemas/User' }, backupCodes: { type: 'array', items: { type: 'string' } } } }, errors: [400, 401, 429] })
  async confirm(@Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(AdminConfirmSchema, body);
    const user = await this.enrollable(input.email, input.password, req);
    const pending = user.totpPendingSecret;
    const step = pending ? verifyTotp(pending, input.otp) : null;
    const done = step === null ? { count: 0 } : await this.prisma.user.updateMany({
      where: { id: user.id, totpPendingSecret: pending, totpSecret: null },
      data: { totpSecret: pending, totpPendingSecret: null, totpLastStep: BigInt(step), mfaEnrollBefore: null, lastSeenAt: new Date() },
    });
    if (done.count !== 1) {
      await this.audit.record(null, 'admin.mfa_enroll_failed', 'user', user.id, {}, req.clientIp);
      throw new AppError(401, 'unauthorized', 'Kod hatalı ya da kayıt başlatılmadı');
    }
    const backupCodes = await this.security.regenerateBackupCodes(user.id);
    await this.audit.record(user.id, 'admin.mfa_enrolled', 'user', user.id, {}, req.clientIp);
    this.security.notify(user, 'Doğrulayıcı uygulaman kaydedildi', [
      'Casalume yönetim hesabına yeni bir doğrulayıcı uygulama ve 10 yedek kod tanımlandı.',
    ]);
    const fresh = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { ...(await this.tokens.issueAdmin(fresh)), admin: this.users.toDto(fresh), backupCodes };
  }

  /** Same checks for both enrollment steps; one generic error so nothing about the account leaks. */
  private async enrollable(email: string, password: string, req: AppRequest) {
    await this.limiter.hit(LIMITS.adminEnroll, req.clientIp);
    await this.limiter.hit(LIMITS.loginAccount, sha256(`admin:${email}`));
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await verifyPassword(user?.passwordHash, password);
    const open = !!user && ok && isAdminRole(user.role) && user.status === 'ACTIVE' && !user.totpSecret && !!user.mfaEnrollBefore && user.mfaEnrollBefore > new Date();
    if (!open) {
      await this.audit.record(null, 'admin.mfa_enroll_failed', 'user', user?.id ?? null, { email: sha256(email).slice(0, 12) }, req.clientIp);
      throw new AppError(401, 'unauthorized', 'Giriş bilgileri hatalı ya da kayıt süresi doldu');
    }
    return user;
  }
}

/** TOK-05: Sign in with Apple server-to-server notifications (consent revoked, Apple ID deleted). */
@ApiTags('auth')
@Controller('v1/webhooks')
export class AppleWebhookController {
  constructor(private oauth: OAuthService, private limiter: RateLimiter) {}

  @Post('apple')
  @HttpCode(200)
  @Doc('Apple sunucu bildirimleri: Apple imzalı JWT (`payload`) doğrulanmadan hiçbir şey yazılmaz', { body: z.object({ payload: z.string().min(100).max(8192) }).strict(), errors: [400, 401, 429, 503] })
  async apple(@Body() body: unknown, @Req() req: AppRequest) {
    const { payload } = parse(z.object({ payload: z.string().min(100).max(8192) }).strict(), body);
    await this.limiter.hit(LIMITS.webhooks, req.clientIp);
    return this.oauth.appleEvent(payload);
  }
}


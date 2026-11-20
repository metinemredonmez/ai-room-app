import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Inject, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Doc } from './common/openapi.js';
import type { Response } from 'express';
import { z } from 'zod';
import { CONFIG, type Config } from './config.js';
import { AiClient } from './ai/ai.client.js';
import { UserGuard } from './auth/tokens.service.js';
import { TokensService } from './auth/tokens.service.js';
import { CatalogService } from './catalog/catalog.service.js';
import { LOCALES, isLocale, type Locale } from './catalog/catalog.data.js';
import { ProductCatalogService } from './catalog/product.service.js';
import { FeaturesService } from './features/features.service.js';
import { AppError, parse } from './common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from './common/http.js';
import { LIMITS, PrismaService, RateLimiter, RedisService } from './common/infra.js';
import { ConsentsService } from './kvkk/consents.service.js';
import { CONSENT_KINDS } from './kvkk/legal.js';
import { UsageService } from './usage/usage.service.js';
import { log } from './common/log.js';
import { CreateDesignSchema, DesignsService, FeedbackSchema, SelectionSchema, cursorArgs } from './designs/designs.service.js';
import { ALLOWED_MIME, ImagesService, isUuid } from './images/images.service.js';
import { SAMPLE_IDS, loadSample } from './images/samples.js';
import { UsersService } from './users/users.service.js';
import { PUSH_TOKEN_RE, PushService, maskToken } from './push/push.service.js';
import { AuditService } from './admin/audit.service.js';
import { EmailTokensService } from './auth/email-tokens.service.js';
import { assertPassword } from './auth/password-policy.js';
import { hashPassword, verifyPassword } from './auth/crypto.js';
import { MailerService, renderActionMail } from './mail/mailer.service.js';
import { clientInfo } from './auth/client-info.js';
import { maskEmail } from './waitlist/waitlist.rules.js';
import { AccountDeletionService } from './users/account-deletion.service.js';
import { OAuthService } from './auth/oauth.service.js';
import { OAUTH_PROVIDERS } from './auth/oidc.js';
import { APP_PLATFORMS, SkipVersionGate } from './common/app-version.js';
import { clientVersion, compareVersions } from './common/semver.js';
import { SettingsService } from './settings/settings.service.js';
import { OrgsService } from './orgs/orgs.service.js';
import { publicLedgerEntry } from './users/ledger.js';
import { CoachService } from './coach/coach.service.js';
import { crisisReply, detectCrisis } from './coach/coach.rules.js';
import { PromptTemplatesService } from './prompts/prompts.service.js';

/** ?locale= first, then the best supported Accept-Language entry (q-values respected), then the fallback. */
export function localeOf(req: AppRequest, fallback?: string): Locale {
  const q = typeof req.query.locale === 'string' ? req.query.locale : '';
  if (isLocale(q)) return q;
  const ranked = (req.headers['accept-language'] ?? '')
    .toString()
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const weight = Number(params.find((p) => p.trim().startsWith('q='))?.trim().slice(2) ?? '1');
      return { base: tag.trim().toLowerCase().split('-')[0], weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((x) => x.base && x.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((x) => x.base)
    .find(isLocale);
  return ranked ?? (isLocale(fallback) ? fallback : 'tr');
}

const AppVersionQuery = z.object({ platform: z.enum(APP_PLATFORMS), version: z.string().max(20) }).strict();

const PageQuery = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  favorite: z.enum(['true', 'false']).optional(),
  locale: z.enum(LOCALES).optional(),
  /** API.md §7.23: list this firm's workspace instead of the personal one. */
  orgId: z.uuid().optional(),
  /** API.md §7.23 step 4: everyone's designs in this firm project (needs orgId). */
  projectId: z.uuid().optional(),
});

const EmailConfirmSchema = z.object({ token: z.string().min(20).max(100) }).strict();

@ApiTags('public')
@Controller('v1')
export class PublicController {
  constructor(
    private catalog: CatalogService,
    private images: ImagesService,
    private prisma: PrismaService,
    private redis: RedisService,
    private ai: AiClient,
    private settings: SettingsService,
    private product: ProductCatalogService,
    private designs: DesignsService,
    private limiter: RateLimiter,
    private emailTokens: EmailTokensService,
    private mailer: MailerService,
    @Inject(CONFIG) private cfg: Config,
  ) {}

  @Get('health')
  @SkipVersionGate()
  @Doc('Servis sağlığı (DB, Redis, AI servisi)', { response: { type: 'object', properties: { status: { type: 'string', enum: ['ok', 'degraded'] }, db: { type: 'string' }, redis: { type: 'string' }, ai: { type: 'string' } } } })
  async health() {
    const [db, redis, ai, storage] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const, () => 'down' as const),
      this.redis.client.ping().then(() => 'ok' as const, () => 'down' as const),
      this.ai.health().then((h) => h.status),
      this.images.store.health(),
    ]);
    const ok = db === 'ok' && redis === 'ok' && ai === 'ok' && storage === 'ok';
    return { status: ok ? 'ok' : 'degraded', db, redis, ai, storage };
  }

  /** Soft and forced update check at app start; reachable by an outdated build (no 426 here). */
  @Get('app/version')
  @SkipVersionGate()
  @Doc('Uygulama sürüm kontrolü: en düşük ve en güncel sürüm, mağaza bağlantısı', {
    description: '`?platform=ios|android&version=1.2.3`. Mobil istekler `X-App-Platform` + `X-App-Version` gönderir; en düşük sürümün altındaysa her uç 426 `update_required` döner.',
    response: { type: 'object', properties: { platform: { type: 'string' }, minVersion: { type: 'string' }, latestVersion: { type: 'string' }, storeUrl: { type: 'string', nullable: true }, updateRequired: { type: 'boolean' }, updateAvailable: { type: 'boolean' } } },
    errors: [400],
  })
  appVersion(@Query() query: unknown) {
    const q = parse(AppVersionQuery, query);
    const rule = this.settings.current.appVersions[q.platform];
    const version = clientVersion(q.version);
    return {
      platform: q.platform, minVersion: rule.min, latestVersion: rule.latest, storeUrl: rule.storeUrl || null,
      updateRequired: compareVersions(version, rule.min) < 0, updateAvailable: compareVersions(version, rule.latest) < 0,
    };
  }

  @Get('catalog')
  @Doc('Katalog: araçlar, stiller, odalar, zeminler, renkler, planlar, duyuru, bakım, yasal sürümler', { response: 'Catalog', description: '`?locale=` (11 dil) ya da Accept-Language' })
  async getCatalog(@Req() req: AppRequest) {
    return this.catalog.catalog(localeOf(req));
  }

  @Get('styles/:id/preview.jpg')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'public, max-age=86400')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Doc('Stil önizleme görseli (herkese açık, kullanıcı verisi içermez)', { produces: 'image/jpeg', errors: [404] })
  async stylePreview(@Param('id') id: string, @Res() res: Response) {
    res.end(await this.catalog.preview(id));
  }

  /** FIL-04: signed, expiring URL; the signature is the bearer capability for this one image. */
  @Get('images/:id')
  @Doc('İmzalı görsel (FIL-04): `exp` + `sig` sorgu parametreleri zorunlu', { produces: 'image/jpeg', errors: [403, 404] })
  async image(@Param('id') id: string, @Query('exp') exp: string | undefined, @Query('sig') sig: string | undefined, @Res() res: Response) {
    if (!this.images.verifySignature(id, exp, sig)) throw new AppError(403, 'forbidden', 'Bağlantının süresi dolmuş veya geçersiz');
    const buf = await this.images.read(id);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Disposition', 'inline');
    res.end(buf);
  }

  @Get('shared/:token/og.jpg')
  @Header('Cache-Control', 'public, max-age=86400')
  @Doc('Paylaşım sayfasının og:image görselleri (tarayıcı botları)', { description: 'Sayaç artmaz; içerik-türü image/jpeg.' })
  async sharedOg(@Param('token') token: string, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.limiter.hit(LIMITS.shareOg, req.clientIp); // RES-01: each call composes an image
    const { jpeg } = await this.designs.sharedOg(token);
    res.type('image/jpeg');
    return res.send(jpeg);
  }

  @Get('shared/:token')
  @Header('Cache-Control', 'no-store')
  @Doc('Herkese açık önce/sonra sayfası (hesap gerekmez)', { description: 'Her çağrı görüntülenme sayacını bir artırır; süresi dolmuş ya da kaldırılmış bağlantı 404.', errors: [404, 429] })
  async shared(@Param('token') token: string, @Req() req: AppRequest) {
    await this.limiter.hit(LIMITS.shareView, req.clientIp);
    return this.designs.shared(token);
  }

  /** Public by design: confirming an e-mail change bumps tokenVersion (every session dies), so the click may carry no token. */
  @Post('me/email/confirm')
  @Doc('E-posta değişikliğini onayla (yeni adresteki bağlantı)', { body: EmailConfirmSchema, description: 'Oturum isterse de istemezse de çalışır; onayda oturumların hepsi kapanır.', errors: [400, 409, 429] })
  async confirmEmailChange(@Body() body: unknown, @Req() req: AppRequest) {
    const { token } = parse(EmailConfirmSchema, body);
    await this.limiter.hit(LIMITS.tokenIp, req.clientIp);
    const { user, email } = await this.emailTokens.consumeEmailChange(token);
    if (await this.prisma.user.findFirst({ where: { email, id: { not: user.id } }, select: { id: true } })) {
      throw new AppError(409, 'email_taken', 'Bu adres bu arada başka bir hesapta kullanılmaya başlandı.');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { email, emailVerifiedAt: new Date(), tokenVersion: { increment: 1 } } });
    log.info('account_email_changed', { userId: user.id, to: maskEmail(email) });
    // AUT: the previous address learns of the change, so a hijack does not go unnoticed.
    if (user.email && user.email !== email) {
      const en = user.locale !== 'tr';
      void this.mailer
        .send(
          renderActionMail({
            to: user.email,
            subject: en ? 'Your Casalume e-mail address was changed' : 'Casalume e-posta adresin değiştirildi',
            heading: en ? 'E-mail address changed' : 'E-posta adresi değiştirildi',
            lines: [en ? `Your account now uses ${maskEmail(email)}. If this was not you, contact support right away.` : `Hesabın artık ${maskEmail(email)} adresini kullanıyor. Bu sen değilsen hemen destekle iletişime geç.`],
            cta: en ? 'Contact support' : 'Destek',
            url: `${this.cfg.WEB_APP_URL}/destek`,
            footer: en ? 'You get this mail because your account security changed.' : 'Bu e-posta hesap güvenliğin değiştiği için gönderildi.',
          }),
        )
        .catch(() => undefined);
    }
    return { ok: true, email };
  }

  @Get('inspiration')
  @Doc('İlham galerisi: sahibinin izin verdiği öne çıkarılan tasarımlar + stil kartları')
  async inspiration(@Req() req: AppRequest) {
    const locale = localeOf(req);
    // Only designs their owner allowed (API.md §7.51), from accounts still active.
    const featured = await this.prisma.design.findMany({
      where: { featured: true, status: 'SUCCEEDED', shareConsentAt: { not: null }, user: { status: 'ACTIVE' } },
      include: { results: { take: 1, orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const styles = await this.catalog.styles();
    const byId = new Map(styles.map((s) => [s.id, s]));
    const items = featured
      .filter((d) => d.results[0])
      .map((d) => {
        const s = d.styleId ? byId.get(d.styleId) : undefined;
        const room = this.product.roomName(d.roomId, locale);
        return {
          id: d.id,
          title: [s ? this.catalog.styleName(s, locale) : this.product.toolName(d.tool, locale), room].filter(Boolean).join(' · '),
          styleId: d.styleId, roomId: d.roomId,
          imageUrl: this.images.url(d.results[0].id),
          palette: s?.palette ?? [],
        };
      });
    for (const s of styles) {
      if (items.length >= 24) break;
      items.push({
        id: `style-${s.id}`, title: this.catalog.styleName(s, locale), styleId: s.id, roomId: 'living_room',
        imageUrl: this.catalog.previewUrl(s.id), palette: s.palette,
      });
    }
    return { items };
  }
}

const UploadSchema = z.object({ data: z.string().min(100).max(15_000_000), mimeType: z.enum(ALLOWED_MIME) }).strict();
const SampleSchema = z.object({ sample: z.enum(SAMPLE_IDS) }).strict();
const PatchMeSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), locale: z.enum(LOCALES).optional() }).strict();
const PushTokenSchema = z.object({ token: z.string().max(200).regex(PUSH_TOKEN_RE), platform: z.enum(['ios', 'android']) }).strict();
const PushTokenDeleteSchema = z.object({ token: z.string().max(200) }).strict();
const LedgerQuery = z.object({ cursor: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
const FavoriteSchema = z
  .object({
    favorite: z.boolean().optional(),
    /** API.md §7.23 step 4: move into a firm project, or out (null). */
    projectId: z.uuid().nullable().optional(),
    /** API.md §7.51: allow (or withdraw) showing this design in the public inspiration gallery. */
    shareable: z.boolean().optional(),
    /** API.md §7.51: allow (or withdraw) using this design in social-media / showcase posts. */
    showcase: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.favorite !== undefined || v.projectId !== undefined || v.shareable !== undefined || v.showcase !== undefined, { message: 'nothing_to_change' });
const AnalysisSchema = z.object({ imageId: z.uuid().optional() }).strict();
const ShareSchema = z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) }).strict();

const PasswordChangeSchema = z.object({ current: z.string().min(1).max(128), next: z.string().min(1).max(128) }).strict();
const EmailChangeSchema = z.object({ next: z.email(), password: z.string().min(1).max(128) }).strict();

const ReportSchema = z
  .object({ reason: z.enum(['inappropriate', 'offensive', 'copyright', 'privacy', 'other']), note: z.string().trim().max(500).optional() })
  .strict();
const ConsentSchema = z
  .object({ kind: z.enum(CONSENT_KINDS), version: z.string().max(40), granted: z.boolean() })
  .strict();
const ChatSchema = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(2000), imageId: z.uuid().optional() }).strict())
      .min(1)
      .max(20),
    locale: z.enum(LOCALES).optional(),
  })
  .strict();

@ApiTags('user')
@ApiBearerAuth('user')
@Controller('v1')
@UseGuards(UserGuard)
export class UserController {
  constructor(
    private users: UsersService,
    private tokens: TokensService,
    private audit: AuditService,
    private deletion: AccountDeletionService,
    private mailer: MailerService,
    private emailTokens: EmailTokensService,
    private images: ImagesService,
    private designs: DesignsService,
    private catalog: CatalogService,
    private ai: AiClient,
    private prisma: PrismaService,
    private limiter: RateLimiter,
    private redis: RedisService,
    private usage: UsageService,
    private consents: ConsentsService,
    private push: PushService,
    private oauth: OAuthService,
    @Inject(CONFIG) private cfg: Config,
    private orgs: OrgsService,
    private features: FeaturesService,
    private coach: CoachService,
    private prompts: PromptTemplatesService,
  ) {}

  @Get('me')
  @Doc('Oturumdaki kullanıcı', { response: 'User', errors: [401] })
  async me(@Auth() auth: AuthContext) {
    return this.users.toDto(await this.users.get(auth.userId));
  }

  /** palemi/yoga: a signed-in user changes their own password; other sessions die, this one survives. */
  @Post('me/password')
  @Doc('Şifre değiştir (mevcut şifre doğrulanır; diğer oturumlar kapanır)', { body: PasswordChangeSchema, errors: [400, 401, 409, 429] })
  async changePassword(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(PasswordChangeSchema, body);
    await this.limiter.hit(LIMITS.passwordChange, auth.userId);
    const user = await this.users.get(auth.userId);
    if (!user.passwordHash) throw new AppError(409, 'no_password', 'Bu hesapta bir şifre yok.');
    if (!(await verifyPassword(user.passwordHash, input.current))) {
      await this.audit.record(auth.userId, 'account.password_failed', 'user', auth.userId, {}, req.clientIp);
      throw new AppError(400, 'bad_request', 'Mevcut şifre hatalı.');
    }
    assertPassword(input.next, { email: user.email });
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.next) } });
    const revoked = auth.sessionId ? await this.tokens.revokeOthers(user.id, auth.sessionId) : 0;
    await this.audit.record(auth.userId, 'account.password_change', 'user', user.id, { revoked }, req.clientIp);
    if (user.email) {
      const en = user.locale !== 'tr';
      void this.mailer
        .send(
          renderActionMail({
            to: user.email,
            subject: en ? 'Your Casalume password was changed' : 'Casalume şifren değiştirildi',
            heading: en ? 'Password changed' : 'Şifre değiştirildi',
            lines: [
              en
                ? `This was done from ${clientInfo(req).ipPrefix}. If it was not you, reset your password right away; every session is closed.`
                : `Bu işlem ${clientInfo(req).ipPrefix} adresinden yapıldı. Sen değilsen hemen şifreni sıfırla; bütün oturumların kapanır.`,
            ],
            cta: en ? 'Reset password' : 'Şifremi sıfırla',
            url: `${this.cfg.WEB_APP_URL}/sifremi-unuttu`,
            footer: en ? 'You get this mail because your account security changed.' : 'Bu e-posta hesap güvenliğin değiştiği için gönderildi.',
          }),
        )
        .catch(() => undefined);
    }
    return { ok: true, revoked };
  }

  /** The new address must be confirmed from a mail sent TO IT before the swap (AUT-03). */
  @Post('me/email')
  @Doc('E-posta değiştir (yeni adrese onay postası gider)', { body: EmailChangeSchema, errors: [400, 401, 409, 429] })
  async changeEmail(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(EmailChangeSchema, body);
    await this.limiter.hit(LIMITS.passwordChange, auth.userId);
    const user = await this.users.get(auth.userId);
    if (!user.passwordHash) throw new AppError(409, 'no_password', 'Bu hesapta bir şifre yok.');
    if (!(await verifyPassword(user.passwordHash, input.password))) throw new AppError(400, 'bad_request', 'Şifre hatalı.');
    const next = input.next.toLowerCase();
    if (next === user.email) throw new AppError(400, 'bad_request', 'Yeni adres mevcut adresle aynı.');
    if (await this.prisma.user.findUnique({ where: { email: next }, select: { id: true } })) {
      throw new AppError(409, 'email_taken', 'Bu adres başka bir hesapta kullanılıyor.');
    }
    const token = await this.emailTokens.issue(user, 'EMAIL_CHANGE', next);
    const en = user.locale !== 'tr';
    await this.mailer
      .send(
        renderActionMail({
          to: next,
          subject: en ? 'Confirm your new Casalume address' : 'Yeni Casalume adresini onayla',
          heading: en ? 'Confirm this address' : 'Bu adresi onayla',
          lines: en
            ? ['Your Casalume account wants to use this e-mail address. Confirm to complete the change; the link works for one hour.']
            : ['Casalume hesabın bu e-posta adresini kullanmak istiyor. Değişikliği tamamlamak için onayla; bağlantı bir saat geçerli.'],
          cta: en ? 'Confirm address' : 'Adresi onayla',
          url: this.emailTokens.link('EMAIL_CHANGE', token),
          footer: en ? 'Not you? Ignore this mail — nothing changes.' : 'Bu istek senin değilse e-postayı yok say; hiçbir şey değişmez.',
        }),
      )
      .catch((e: Error) => log.warn('email_change_mail_failed', { error: e.name }));
    await this.audit.record(auth.userId, 'account.email_change_request', 'user', user.id, { to: maskEmail(next) }, req.clientIp);
    return { ok: true, sentTo: maskEmail(next) };
  }

  @Patch('me')
  @Doc('Ad / dil güncelle', { body: PatchMeSchema, response: 'User', errors: [400, 401] })
  async patchMe(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(PatchMeSchema, body);
    return this.users.toDto(await this.prisma.user.update({ where: { id: auth.userId }, data: input }));
  }

  /** KVKK: erases the account, designs, analyses and every stored image file. */
  @Delete('me')
  @HttpCode(204)
  @Doc('Hesabı silmeyi planla (KVKK)', { status: 204, description: 'Silme 30 gün sonraya planlanır; bu süre içinde giriş yapılırsa iptal olur. Oturumlar anında kapanır.', errors: [401] })
  async deleteMe(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    // YediOda #18: the erase is scheduled 30 days out; signing back in within the window cancels it
    // (API.md §7.3). Sessions die immediately; the retention job runs the actual erase.
    await this.deletion.schedule(auth.userId, req.clientIp);
  }

  @Get('me/identities')
  @Doc('Bağlı giriş yöntemleri (Apple / Google) ve şifre olup olmadığı', { errors: [401] })
  async identities(@Auth() auth: AuthContext) {
    return this.oauth.identities(auth.userId);
  }

  @Delete('me/identities/:provider')
  @HttpCode(204)
  @Doc('Apple / Google bağlantısını kaldır (son giriş yöntemi kaldırılamaz; Apple token iptal edilir)', { status: 204, errors: [401, 404, 409] })
  async unlinkIdentity(@Auth() auth: AuthContext, @Param('provider') provider: string) {
    const p = parse(z.enum(OAUTH_PROVIDERS), provider);
    await this.oauth.unlink(auth.userId, p);
  }

  /** Called on every app launch with permission granted; also refreshes lastSeenAt. */
  @Post('me/push-tokens')
  @HttpCode(204)
  @Doc('Push token kaydet ("Tasarımın hazır" bildirimi)', { body: PushTokenSchema, status: 204, description: 'Yalnız Expo push token. Aynı cihaz başka hesapla kaydolursa token o hesaba taşınır. Kullanıcı başına en çok 10 cihaz.', errors: [400, 401, 429] })
  async registerPush(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(PushTokenSchema, body);
    await this.limiter.hit(LIMITS.pushTokens, auth.userId);
    await this.push.register(auth.userId, input.token, input.platform);
  }

  /** Sign-out and "notifications off" call this; a token of another account is silently ignored. */
  @Delete('me/push-tokens')
  @HttpCode(204)
  @Doc('Push token sil (çıkış / bildirim kapalı)', { body: PushTokenDeleteSchema, status: 204, errors: [400, 401] })
  async unregisterPush(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(PushTokenDeleteSchema, body);
    await this.push.unregister(auth.userId, input.token);
  }

  @Post('uploads')
  @Doc('Fotoğraf yükle (base64; imza + MIME kontrolü, EXIF/GPS silinir) + kalite uyarısı', { body: UploadSchema, status: 201, response: 'Upload', errors: [400, 401, 413, 415, 429] })
  async upload(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(UploadSchema, body);
    await this.limiter.hit(LIMITS.uploads, auth.userId);
    const raw = Buffer.from(input.data.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const { buffer } = await this.images.normalize(raw, input.mimeType);
    const img = await this.images.save(buffer, { ownerId: auth.userId, kind: 'UPLOAD' });
    // Advisory capture-quality check (palemi quality gate); null when the AI service can't answer.
    const quality = await this.ai.quality(buffer.toString('base64'));
    return { image: this.images.ref(img), quality };
  }

  @Post('uploads/sample')
  @Doc('Yerleşik örnek fotoğrafı hesaba kopyala', { body: SampleSchema, status: 201, response: 'Upload', errors: [400, 401, 429] })
  async sample(@Auth() auth: AuthContext, @Body() body: unknown) {
    const { sample } = parse(SampleSchema, body);
    await this.limiter.hit(LIMITS.uploads, auth.userId);
    const img = await this.images.save(await loadSample(sample), { ownerId: auth.userId, kind: 'SAMPLE' });
    return { image: this.images.ref(img) };
  }

  /** Tap selection preview (API.md §7.15): the mask shown over the photo before generating. AZ-01: own images only. */
  @Post('uploads/:id/selection')
  @HttpCode(200)
  @Doc('Dokunarak seçim önizlemesi (maske)', { body: SelectionSchema, response: 'Selection', description: 'Değiştir / Nesne Sil / Duvar Boyası için. `points` (0..1, her nokta bir nesne, en çok 8) ya da `target` (nesne adı; o türün hepsi). Aynı noktalar `POST /designs` içinde `points` olarak gönderilir. Her çağrı ücretli bir SAM 3 isteğidir: 10 dakikada 60. `FAL_KEY` yoksa 503 `selection_unavailable`; nesne bulunamazsa 422 `selection_failed`.', errors: [400, 401, 403, 404, 422, 429, 502, 503] })
  async selection(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(SelectionSchema, body);
    this.features.assert('tap_selection');
    await this.limiter.hit(LIMITS.selection, auth.userId);
    return this.designs.selection(auth.userId, id, input, req.id);
  }

  /**
   * Sync by default; `Prefer: respond-async` → 202 + PENDING design (poll GET /designs/:id).
   * `Idempotency-Key` makes retries safe: the same key never starts (or charges) a second generation.
   */
  @Post('designs')
  @Doc('Tasarım üret', { body: CreateDesignSchema, status: 201, response: 'Design', description: 'Varsayılan senkron (201). `Prefer: respond-async` → 202 + PENDING, `GET /designs/:id` ile sorgula. `Idempotency-Key` aynı isteğin iki kez ücretlendirilmesini önler (200 ile mevcut tasarım döner). Kredi: HELD → CAPTURED / RELEASED.', errors: [400, 401, 402, 403, 404, 409, 422, 429, 502, 503] })
  async createDesign(
    @Auth() auth: AuthContext,
    @Body() body: unknown,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('prefer') prefer?: string,
    @Headers('idempotency-key') idemKey?: string,
  ) {
    const input = parse(CreateDesignSchema, body);
    if (input.points) this.features.assert('tap_selection');
    const mode = /\brespond-async\b/i.test(prefer ?? '') ? 'async' : 'sync';
    let idem: string | null = null;
    if (idemKey !== undefined) {
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(idemKey)) throw new AppError(400, 'validation_failed', 'Geçersiz Idempotency-Key');
      idem = `idem:design:${auth.userId}:${idemKey}`;
      const claimed = await this.redis.client.set(idem, 'pending', 'EX', 86_400, 'NX');
      if (claimed !== 'OK') {
        const existing = await this.redis.client.get(idem);
        if (!existing || existing === 'pending') throw new AppError(409, 'conflict', 'Aynı istek hâlâ işleniyor');
        res.status(200);
        return this.designs.toDto(await this.designs.getOwned(auth.userId, existing), localeOf(req));
      }
    }
    try {
      await this.limiter.hit(LIMITS.generateUser, auth.userId);
      await this.limiter.hit(LIMITS.generateIp, req.clientIp);
      const design = await this.designs.create(auth.userId, input, req.id, mode);
      if (idem) await this.redis.client.set(idem, design.id, 'EX', 86_400);
      res.status(mode === 'async' ? 202 : 201);
      return design;
    } catch (e) {
      // Keep the key bound if a design row exists (sync failure after charge+refund); free it otherwise.
      if (idem) await this.redis.client.del(idem);
      throw e;
    }
  }

  @Post('designs/:id/report')
  @Doc('Yapay zekâ içeriğini bildir (Google Play üretken AI politikası)', { body: ReportSchema, status: 201, errors: [400, 401, 404, 429] })
  async reportDesign(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(ReportSchema, body);
    await this.limiter.hit(LIMITS.reports, auth.userId);
    if (!isUuid(id)) throw new AppError(404, 'not_found', 'Bulunamadı');
    // Own designs and publicly featured ones can be reported (Google Play generative-AI policy).
    const design = await this.prisma.design.findFirst({ where: { id, OR: [{ userId: auth.userId }, { featured: true }] } });
    if (!design) throw new AppError(404, 'not_found', 'Bulunamadı');
    const report = await this.prisma.contentReport.create({
      data: { designId: id, reporterId: auth.userId, reason: input.reason, note: input.note ?? null },
    });
    log.info('content_reported', { designId: id, reportId: report.id, reason: input.reason });
    return { id: report.id, status: report.status };
  }

  @Post('designs/:id/feedback')
  @Doc('Sonuca puan ver (beğendim / bana uymadı)', { body: FeedbackSchema, status: 200, response: 'Design', description: 'Yalnız kendi bitmiş tasarımına; son değer geçerli olur. Neden serbest metindir (en çok 300).', errors: [400, 401, 404, 409] })
  async designFeedback(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(FeedbackSchema, body);
    await this.limiter.hit(LIMITS.feedback, auth.userId);
    const updated = await this.designs.feedback(auth.userId, id, input);
    log.info('design_feedback', { designId: updated.id, rating: input.rating, requestId: req.id });
    return this.designs.toDto(await this.designs.getOwned(auth.userId, updated.id), localeOf(req));
  }

  @Post('designs/:id/share')
  @Doc('Herkese açık önce/sonra paylantı bağlantısı üret (süreli)', { body: ShareSchema, status: 201, description: 'Yeni jeton üretilir, eski bağlantı ve sayaç sıfırlanır. Firma tasarımları için yakında.', errors: [401, 404, 409] })
  async shareDesign(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    const { days } = parse(ShareSchema, body);
    const out = await this.designs.share(auth.userId, id, days);
    return { ...out, url: `${this.cfg.WEB_APP_URL}/paylas/${out.token}` };
  }

  @Delete('designs/:id/share')
  @HttpCode(204)
  @Doc('Paylaşım bağlantısını kaldır (erişim anında kesilir)', { errors: [401, 404] })
  async unshareDesign(@Auth() auth: AuthContext, @Param('id') id: string) {
    await this.designs.unshare(auth.userId, id);
  }

  @Get('me/consents')
  @Doc('Onay geçmişi ve güncel durum (KVKK)', { errors: [401] })
  async getConsents(@Auth() auth: AuthContext) {
    return this.consents.list(auth.userId);
  }

  @Post('me/consents')
  @Doc('Onay ver / geri çek (eklemeli kayıt)', { body: ConsentSchema, status: 201, errors: [400, 401, 409] })
  async postConsent(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(ConsentSchema, body);
    return this.consents.record(auth.userId, input.kind, input.version, input.granted, req.clientIp);
  }

  /** API.md §7.24: my credit movements, newest first (staff adjustments without their internal reason). */
  @Get('me/credits')
  @Doc('Kredi hareketlerim', {
    description: '`kind`: daily_free | generation | refund | welcome | purchase | adjustment | other. Yönetici düzeltmesinin gerekçesi gösterilmez.',
    errors: [400, 401],
  })
  async myCredits(@Auth() auth: AuthContext, @Query() query: unknown) {
    const q = parse(LedgerQuery, query);
    const rows = await this.prisma.creditLedger.findMany({
      where: { userId: auth.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...cursorArgs(q.cursor),
    });
    const page = rows.slice(0, q.limit);
    return { items: page.map(publicLedgerEntry), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
  }

  /** KVKK m.11 — everything stored about the account, as JSON (images via signed URLs). */
  @Get('me/export')
  @Doc('Verilerimi indir (KVKK m.11) — JSON ek dosya', { errors: [401, 429] })
  async exportMe(@Auth() auth: AuthContext, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.limiter.hit(LIMITS.export, auth.userId);
    const user = await this.users.get(auth.userId);
    const [designs, ledger, consents, reports, uploads, devices, identities, dataRequests, supportTickets, organizations] = await Promise.all([
      this.prisma.design.findMany({ where: { userId: auth.userId }, include: { inputImage: true, results: true, analyses: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.creditLedger.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.consent.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.contentReport.findMany({ where: { reporterId: auth.userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.image.findMany({ where: { ownerId: auth.userId, kind: { in: ['UPLOAD', 'SAMPLE'] } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.pushToken.findMany({ where: { userId: auth.userId }, orderBy: { lastSeenAt: 'desc' } }),
      this.prisma.authIdentity.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.dataRequest.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.supportTicket.findMany({ where: { userId: auth.userId }, include: { messages: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } }),
      this.orgs.membershipsOf(auth.userId),
    ]);
    log.info('data_export', { userId: auth.userId });
    res.setHeader('Content-Disposition', `attachment; filename="casalume-verilerim-${new Date().toISOString().slice(0, 10)}.json"`);
    const locale = localeOf(req, user.locale);
    return {
      exportedAt: new Date().toISOString(),
      profile: { ...this.users.toDto(user), status: user.status, lastSeenAt: user.lastSeenAt?.toISOString() ?? null, emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null },
      consents: consents.map((c) => ({ kind: c.kind, version: c.version, granted: c.granted, createdAt: c.createdAt.toISOString() })),
      uploads: uploads.map((i) => this.images.ref(i)),
      dataRequests: dataRequests.map((r) => ({ reference: r.reference, type: r.type, status: r.status, details: r.details, response: r.response, receivedAt: r.receivedAt.toISOString(), dueAt: r.dueAt.toISOString(), closedAt: r.closedAt?.toISOString() ?? null })),
      organizations,
      supportTickets: supportTickets.map((t) => ({
        reference: t.reference, category: t.category, subject: t.subject, status: t.status, createdAt: t.createdAt.toISOString(),
        messages: t.messages.map((m) => ({ author: m.author, body: m.body, createdAt: m.createdAt.toISOString() })),
      })),
      signInMethods: identities.map((i) => ({ provider: i.provider, email: i.email, linkedAt: i.createdAt.toISOString(), lastUsedAt: i.lastUsedAt.toISOString() })),
      pushDevices: devices.map((t) => ({ platform: t.platform, token: maskToken(t.token), registeredAt: t.createdAt.toISOString(), lastSeenAt: t.lastSeenAt.toISOString() })),
      designs: await Promise.all(
        designs.map(async (d) => ({
          ...(await this.designs.toDto(d, locale)),
          analyses: d.analyses.map((a) => ({ imageId: a.imageId, createdAt: a.createdAt.toISOString(), ...(a.data as object) })),
        })),
      ),
      creditLedger: ledger.map((l) => ({ delta: l.delta, reason: l.reason, refId: l.refId, createdAt: l.createdAt.toISOString() })),
      reports: reports.map((r) => ({ designId: r.designId, reason: r.reason, note: r.note, status: r.status, createdAt: r.createdAt.toISOString() })),
      note: 'Görsel bağlantıları 24 saat geçerlidir. Hesabını ve tüm verilerini silmek için uygulamadaki "Hesabımı sil" seçeneğini kullanabilirsin.',
    };
  }

  @Get('designs')
  @Doc('Tasarımlarım (sayfalı)', { response: 'DesignPage', errors: [401] })
  async listDesigns(@Auth() auth: AuthContext, @Query() query: unknown, @Req() req: AppRequest) {
    const q = parse(PageQuery, query);
    return this.designs.list(auth.userId, { cursor: q.cursor, limit: q.limit, favorite: q.favorite === 'true', orgId: q.orgId, projectId: q.projectId }, localeOf(req));
  }

  @Get('designs/:id')
  @Doc('Tasarım detayı / durum sorgulama', { response: 'Design', errors: [401, 404] })
  async getDesign(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    // Own designs, and teammates' designs in a shared firm project (API.md §7.23 step 4).
    return this.designs.toDto(await this.designs.getVisible(auth.userId, id), localeOf(req), auth.userId);
  }

  @Patch('designs/:id')
  @Doc('Favori, firma projesi ya da galeride paylaşım izni', {
    body: FavoriteSchema,
    response: 'Design',
    description: '`projectId`: aynı firmanın açık projesi ya da null (yalnız tasarımı yapan). `shareable`: İlham galerisinde gösterilme izni; geri çekince galeriden hemen kalkar (firma tasarımında 409).',
    errors: [400, 401, 404, 409],
  })
  async patchDesign(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(FavoriteSchema, body);
    let out = input.projectId !== undefined ? await this.designs.setProject(auth.userId, id, input.projectId, localeOf(req)) : null;
    if (input.favorite !== undefined) out = await this.designs.setFavorite(auth.userId, id, input.favorite, localeOf(req));
    if (input.shareable !== undefined) out = await this.designs.setShareable(auth.userId, id, input.shareable, localeOf(req));
    if (input.showcase !== undefined) out = await this.designs.setShowcaseConsent(auth.userId, id, input.showcase, localeOf(req));
    return out;
  }

  @Delete('designs/:id')
  @HttpCode(204)
  @Doc('Tasarımı sil', { status: 204, errors: [401, 404] })
  async deleteDesign(@Auth() auth: AuthContext, @Param('id') id: string) {
    await this.designs.remove(id, auth.userId);
  }

  @Post('designs/:id/analysis')
  @Doc('Alışveriş listesi + TL bütçe + mağaza linkleri', { body: AnalysisSchema, status: 201, response: 'Analysis', errors: [401, 404, 429, 502] })
  async analysis(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const { imageId } = parse(AnalysisSchema, body ?? {});
    await this.limiter.hit(LIMITS.analysis, auth.userId);
    return this.designs.analysis(auth.userId, id, imageId, localeOf(req), req.id, () => this.features.assert('cost_analysis'));
  }

  /**
   * AI-01: the coach only advises; suggestions come back as data the user must tap to run.
   * API.md §7.54: a message with crisis signs gets verified help lines at once — no AI call, no allowance used. Otherwise
   * one message from the day's allowance (given back if no answer comes), and the reply carries a `speakToken` so the
   * client may ask for this exact text to be read aloud.
   */
  @Post('chat')
  @Doc('AI koç sohbeti (öneriler yalnız veri; istemci kullanıcı onayı olmadan üretim başlatmaz, AI-01)', {
    body: ChatSchema,
    status: 201,
    response: 'ChatReply',
    description: 'Kriz işareti taşıyan mesaja AI çağrılmadan ve hak düşmeden `crisis.lines` ile güvenli cevap döner. Günlük mesaj hakkı bitince 429 `coach_quota` (panel metni).',
    errors: [400, 401, 404, 429, 502, 503],
  })
  async chat(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(ChatSchema, body);
    this.features.assert('assistant_chat');
    await this.limiter.hit(LIMITS.chatUser, auth.userId);
    await this.limiter.hit(LIMITS.chatIp, req.clientIp);
    const locale = input.locale ?? localeOf(req);
    const last = input.messages[input.messages.length - 1]!;
    if (last.role === 'user') {
      const kind = detectCrisis(last.text);
      if (kind) {
        log.warn('coach_crisis', { kind, locale }); // no text, no user id: only that it happened
        const { reply, lines } = crisisReply(locale, this.coach.current);
        return { reply, suggestions: [], crisis: { lines } };
      }
    }
    const withImages = input.messages.filter((m) => m.imageId);
    if (withImages.length > 3) throw new AppError(400, 'validation_failed', 'En fazla 3 görsel eklenebilir');
    // Photos go to the AI provider: the same AI-processing consent as a generation (KVKK).
    if (withImages.length) await this.designs.assertAiConsent(auth.userId);
    await this.designs.assertBudgetFor(auth.userId);
    const user = await this.users.get(auth.userId);
    const release = await this.coach.reserve('messages', auth.userId, 1, this.users.isPro(user), locale);
    try {
      const messages = await Promise.all(
        input.messages.map(async (m) => ({
          role: m.role,
          text: m.text,
          image_b64:
            m.imageId && m.role === 'user'
              ? (await this.images.read((await this.images.owned(m.imageId, auth.userId)).id)).toString('base64')
              : undefined,
        })),
      );
      const cat = await this.catalog.catalog(locale);
      const out = await this.ai.chat(
        {
          locale,
          messages,
          catalog: {
            tools: cat.tools.map((t) => ({ id: t.id, name: t.name })),
            styles: cat.styles.map((s) => ({ id: s.id, name: s.name })),
            rooms: cat.rooms.map((r) => ({ id: r.id, name: r.name })),
          },
          // The panel's coach persona (API.md §7.26); the safety rules around it stay in the AI service's code.
          persona: this.prompts.forTool('coach').templates?.coach,
        },
        req.id,
      );
      await this.usage.record(out.usage, { userId: auth.userId });
      return {
        reply: out.reply,
        suggestions: out.suggestions.map((s) => ({
          label: s.label,
          tool: s.tool,
          ...(s.style_id ? { styleId: s.style_id } : {}),
          ...(s.room_id ? { roomId: s.room_id } : {}),
          ...(s.instructions ? { instructions: s.instructions } : {}),
        })),
        ...(this.coach.current.voice.enabled ? { speakToken: this.coach.signReply(auth.userId, locale, out.reply) } : {}),
      };
    } catch (e) {
      await release();
      throw e;
    }
  }

  /** Demo-only upgrade until store billing (RevenueCat / iyzico) is wired in. */
  @Post('billing/dev-upgrade')
  @Doc('Demo: 7 günlük PRO (üretimde 404)', { status: 201, response: 'User', errors: [401, 404] })
  async devUpgrade(@Auth() auth: AuthContext) {
    if (this.cfg.isProd) throw new AppError(404, 'not_found', 'Bulunamadı');
    const user = await this.prisma.user.update({
      where: { id: auth.userId },
      data: { plan: 'PRO', planExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
    });
    await this.prisma.creditLedger.create({ data: { userId: auth.userId, delta: 0, reason: 'dev_upgrade_pro_7d' } });
    return this.users.toDto(user);
  }
}

export { cursorArgs };

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
import { AppError, parse } from './common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from './common/http.js';
import { LIMITS, PrismaService, RateLimiter, RedisService } from './common/infra.js';
import { ConsentsService } from './kvkk/consents.service.js';
import { CONSENT_KINDS } from './kvkk/legal.js';
import { UsageService } from './usage/usage.service.js';
import { log } from './common/log.js';
import { CreateDesignSchema, DesignsService, SelectionSchema, cursorArgs } from './designs/designs.service.js';
import { ALLOWED_MIME, ImagesService, isUuid } from './images/images.service.js';
import { SAMPLE_IDS, loadSample } from './images/samples.js';
import { UsersService } from './users/users.service.js';
import { PUSH_TOKEN_RE, PushService, maskToken } from './push/push.service.js';
import { OAuthService } from './auth/oauth.service.js';
import { OAUTH_PROVIDERS } from './auth/oidc.js';
import { APP_PLATFORMS, SkipVersionGate } from './common/app-version.js';
import { clientVersion, compareVersions } from './common/semver.js';
import { SettingsService } from './settings/settings.service.js';
import { OrgsService } from './orgs/orgs.service.js';
import { publicLedgerEntry } from './users/ledger.js';

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

  @Get('inspiration')
  @Doc('İlham galerisi: öne çıkarılan tasarımlar + stil kartları')
  async inspiration(@Req() req: AppRequest) {
    const locale = localeOf(req);
    const featured = await this.prisma.design.findMany({
      where: { featured: true, status: 'SUCCEEDED' },
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
  .object({ favorite: z.boolean().optional(), /** API.md §7.23 step 4: move into a firm project, or out (null). */ projectId: z.uuid().nullable().optional() })
  .strict()
  .refine((v) => v.favorite !== undefined || v.projectId !== undefined, { message: 'nothing_to_change' });
const AnalysisSchema = z.object({ imageId: z.uuid().optional() }).strict();
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
  ) {}

  @Get('me')
  @Doc('Oturumdaki kullanıcı', { response: 'User', errors: [401] })
  async me(@Auth() auth: AuthContext) {
    return this.users.toDto(await this.users.get(auth.userId));
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
  @Doc('Hesabı ve tüm verileri sil (KVKK)', { status: 204, errors: [401] })
  async deleteMe(@Auth() auth: AuthContext) {
    // App Store 5.1.1(v): Apple tokens are revoked by a retrying job, so Apple being down never blocks the deletion.
    const appleRevokes = await this.oauth.scheduleAccountRevocations(auth.userId);
    const imgs = await this.prisma.image.findMany({ where: { ownerId: auth.userId }, select: { id: true } });
    await this.prisma.user.delete({ where: { id: auth.userId } });
    await this.images.remove(imgs.map((i) => i.id));
    log.info('account_deleted', { userId: auth.userId, images: imgs.length, appleRevokes });
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
  @Doc('Favori işaretle ya da firma projesine taşı', { body: FavoriteSchema, response: 'Design', description: '`projectId`: aynı firmanın açık projesi ya da null (yalnız tasarımı yapan).', errors: [400, 401, 404, 409] })
  async patchDesign(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(FavoriteSchema, body);
    let out = input.projectId !== undefined ? await this.designs.setProject(auth.userId, id, input.projectId, localeOf(req)) : null;
    if (input.favorite !== undefined) out = await this.designs.setFavorite(auth.userId, id, input.favorite, localeOf(req));
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
    return this.designs.analysis(auth.userId, id, imageId, localeOf(req), req.id);
  }

  /** AI-01: the assistant only advises; suggestions come back as data the user must tap to run. */
  @Post('chat')
  @Doc('AI tasarım sohbeti (öneriler yalnız veri; istemci kullanıcı onayı olmadan üretim başlatmaz, AI-01)', { body: ChatSchema, status: 201, response: 'ChatReply', errors: [400, 401, 404, 429, 502] })
  async chat(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(ChatSchema, body);
    await this.limiter.hit(LIMITS.chatUser, auth.userId);
    await this.limiter.hit(LIMITS.chatIp, req.clientIp);
    const locale = input.locale ?? localeOf(req);
    const withImages = input.messages.filter((m) => m.imageId);
    if (withImages.length > 3) throw new AppError(400, 'validation_failed', 'En fazla 3 görsel eklenebilir');
    // Photos go to the AI provider: the same AI-processing consent as a generation (KVKK).
    if (withImages.length) await this.designs.assertAiConsent(auth.userId);
    await this.designs.assertBudgetFor(auth.userId);
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
    };
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

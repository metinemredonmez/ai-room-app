import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CONFIG, type Config } from './config.js';
import { AiClient } from './ai/ai.client.js';
import { UserGuard } from './auth/tokens.service.js';
import { TokensService } from './auth/tokens.service.js';
import { CatalogService } from './catalog/catalog.service.js';
import { ROOMS, TOOLS, TOOL_IDS, type Locale } from './catalog/catalog.data.js';
import { AppError, parse } from './common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from './common/http.js';
import { LIMITS, PrismaService, RateLimiter, RedisService } from './common/infra.js';
import { log } from './common/log.js';
import { CreateDesignSchema, DesignsService, cursorArgs } from './designs/designs.service.js';
import { ALLOWED_MIME, ImagesService } from './images/images.service.js';
import { SAMPLE_IDS, loadSample } from './images/samples.js';
import { UsersService } from './users/users.service.js';

export function localeOf(req: AppRequest, fallback?: string): Locale {
  const q = typeof req.query.locale === 'string' ? req.query.locale : '';
  if (q === 'en' || q === 'tr') return q;
  const header = (req.headers['accept-language'] ?? '').toString().toLowerCase();
  if (header.startsWith('en')) return 'en';
  if (header.startsWith('tr')) return 'tr';
  return fallback === 'en' ? 'en' : 'tr';
}

const PageQuery = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  favorite: z.enum(['true', 'false']).optional(),
  locale: z.enum(['tr', 'en']).optional(),
});

@Controller('v1')
export class PublicController {
  constructor(
    private catalog: CatalogService,
    private images: ImagesService,
    private prisma: PrismaService,
    private redis: RedisService,
    private ai: AiClient,
  ) {}

  @Get('health')
  async health() {
    const [db, redis, ai] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const, () => 'down' as const),
      this.redis.client.ping().then(() => 'ok' as const, () => 'down' as const),
      this.ai.health().then((h) => h.status),
    ]);
    return { status: db === 'ok' && redis === 'ok' && ai === 'ok' ? 'ok' : 'degraded', db, redis, ai };
  }

  @Get('catalog')
  async getCatalog(@Req() req: AppRequest) {
    return this.catalog.catalog(localeOf(req));
  }

  @Get('styles/:id/preview.jpg')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'public, max-age=86400')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  async stylePreview(@Param('id') id: string, @Res() res: Response) {
    res.end(await this.catalog.preview(id));
  }

  /** FIL-04: signed, expiring URL; the signature is the bearer capability for this one image. */
  @Get('images/:id')
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
        const room = d.roomId ? ROOMS[d.roomId]?.name[locale] : undefined;
        return {
          id: d.id,
          title: [s ? this.catalog.styleName(s, locale) : TOOLS[d.tool as keyof typeof TOOLS]?.name[locale], room].filter(Boolean).join(' · '),
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
const PatchMeSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), locale: z.enum(['tr', 'en']).optional() }).strict();
const FavoriteSchema = z.object({ favorite: z.boolean() }).strict();
const AnalysisSchema = z.object({ imageId: z.uuid().optional() }).strict();
const ChatSchema = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(2000), imageId: z.uuid().optional() }).strict())
      .min(1)
      .max(20),
    locale: z.enum(['tr', 'en']).optional(),
  })
  .strict();

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
    @Inject(CONFIG) private cfg: Config,
  ) {}

  @Get('me')
  async me(@Auth() auth: AuthContext) {
    return this.users.toDto(await this.users.get(auth.userId));
  }

  @Patch('me')
  async patchMe(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(PatchMeSchema, body);
    return this.users.toDto(await this.prisma.user.update({ where: { id: auth.userId }, data: input }));
  }

  /** KVKK: erases the account, designs, analyses and every stored image file. */
  @Delete('me')
  @HttpCode(204)
  async deleteMe(@Auth() auth: AuthContext) {
    const imgs = await this.prisma.image.findMany({ where: { ownerId: auth.userId }, select: { id: true } });
    await this.prisma.user.delete({ where: { id: auth.userId } });
    await this.images.remove(imgs.map((i) => i.id));
    log.info('account_deleted', { userId: auth.userId, images: imgs.length });
  }

  @Post('uploads')
  async upload(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(UploadSchema, body);
    await this.limiter.hit(LIMITS.uploads, auth.userId);
    const raw = Buffer.from(input.data.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const { buffer } = await this.images.normalize(raw, input.mimeType);
    const img = await this.images.save(buffer, { ownerId: auth.userId, kind: 'UPLOAD' });
    return { image: this.images.ref(img) };
  }

  @Post('uploads/sample')
  async sample(@Auth() auth: AuthContext, @Body() body: unknown) {
    const { sample } = parse(SampleSchema, body);
    await this.limiter.hit(LIMITS.uploads, auth.userId);
    const img = await this.images.save(await loadSample(this.cfg.DATA_DIR, sample), { ownerId: auth.userId, kind: 'SAMPLE' });
    return { image: this.images.ref(img) };
  }

  @Post('designs')
  async createDesign(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(CreateDesignSchema, body);
    await this.limiter.hit(LIMITS.generateUser, auth.userId);
    await this.limiter.hit(LIMITS.generateIp, req.clientIp);
    return this.designs.create(auth.userId, input, req.id);
  }

  @Get('designs')
  async listDesigns(@Auth() auth: AuthContext, @Query() query: unknown, @Req() req: AppRequest) {
    const q = parse(PageQuery, query);
    return this.designs.list(auth.userId, { cursor: q.cursor, limit: q.limit, favorite: q.favorite === 'true' }, localeOf(req));
  }

  @Get('designs/:id')
  async getDesign(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    return this.designs.toDto(await this.designs.getOwned(auth.userId, id), localeOf(req));
  }

  @Patch('designs/:id')
  async patchDesign(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const { favorite } = parse(FavoriteSchema, body);
    return this.designs.setFavorite(auth.userId, id, favorite, localeOf(req));
  }

  @Delete('designs/:id')
  @HttpCode(204)
  async deleteDesign(@Auth() auth: AuthContext, @Param('id') id: string) {
    await this.designs.remove(id, auth.userId);
  }

  @Post('designs/:id/analysis')
  async analysis(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const { imageId } = parse(AnalysisSchema, body ?? {});
    await this.limiter.hit(LIMITS.analysis, auth.userId);
    return this.designs.analysis(auth.userId, id, imageId, localeOf(req), req.id);
  }

  /** AI-01: the assistant only advises; suggestions come back as data the user must tap to run. */
  @Post('chat')
  async chat(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(ChatSchema, body);
    await this.limiter.hit(LIMITS.chatUser, auth.userId);
    await this.limiter.hit(LIMITS.chatIp, req.clientIp);
    const locale = input.locale ?? localeOf(req);
    const withImages = input.messages.filter((m) => m.imageId);
    if (withImages.length > 3) throw new AppError(400, 'validation_failed', 'En fazla 3 görsel eklenebilir');
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
          tools: TOOL_IDS.map((id) => ({ id, name: TOOLS[id].name[locale] })),
          styles: cat.styles.map((s) => ({ id: s.id, name: s.name })),
          rooms: cat.rooms.map((r) => ({ id: r.id, name: r.name })),
        },
      },
      req.id,
    );
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

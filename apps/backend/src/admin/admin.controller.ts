import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Doc } from '../common/openapi.js';
import { SettingsSchema } from '../settings/settings.service.js';
import { z } from 'zod';
import { AiClient } from '../ai/ai.client.js';
import { AdminGuard, TokensService } from '../auth/tokens.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { TOOL_IDS } from '../catalog/catalog.data.js';
import { AppError, notFound, parse } from '../common/errors.js';
import { Auth, Req, todayInIstanbul, type AppRequest, type AuthContext } from '../common/http.js';
import { PrismaService, RedisService } from '../common/infra.js';
import { DesignsService, cursorArgs } from '../designs/designs.service.js';
import type { Prisma, User } from '../generated/prisma/client.js';
import { ImagesService, isUuid } from '../images/images.service.js';
import { UsersService } from '../users/users.service.js';
import { AuditService } from './audit.service.js';
import { BillingService } from '../billing/billing.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { UsageService } from '../usage/usage.service.js';

const Page = { cursor: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) };
const UsersQuery = z.object({ ...Page, q: z.string().trim().max(100).optional() });
const DesignsQuery = z.object({
  ...Page,
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']).optional(),
  tool: z.enum(TOOL_IDS).optional(),
  styleId: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  userId: z.uuid().optional(),
});
const PatchUser = z
  .object({ status: z.enum(['ACTIVE', 'BANNED']).optional(), plan: z.enum(['FREE', 'PRO']).optional(), planExpiresAt: z.iso.datetime().nullable().optional() })
  .strict();
const Credits = z.object({ delta: z.number().int().min(-1000).max(1000).refine((v) => v !== 0), reason: z.string().trim().min(3).max(200) }).strict();
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const StyleInput = z
  .object({
    id: z.string().regex(/^[a-z_]{2,40}$/),
    nameTr: z.string().trim().min(1).max(60),
    nameEn: z.string().trim().min(1).max(60),
    descriptionTr: z.string().trim().max(200),
    descriptionEn: z.string().trim().max(200),
    prompt: z.string().trim().min(10).max(600),
    palette: z.array(hex).min(1).max(6),
    isPro: z.boolean(),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .strict();

/** Every route here requires an MFA-complete admin token (AdminGuard), and every write is audited. */
@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private users: UsersService,
    private designs: DesignsService,
    private catalog: CatalogService,
    private tokens: TokensService,
    private audit: AuditService,
    private ai: AiClient,
    private settings: SettingsService,
    private usage: UsageService,
    private jobs: JobsService,
    private billing: BillingService,
    private images: ImagesService,
  ) {}

  private async adminUser(u: User) {
    const designsCount = await this.prisma.design.count({ where: { userId: u.id } });
    return { ...this.users.toDto(u), status: u.status, designsCount, lastSeenAt: u.lastSeenAt?.toISOString() ?? null };
  }

  @Get('stats')
  @Doc('KPI ve günlük seriler', { errors: [401, 403] })
  async stats(@Query('days') daysRaw?: string) {
    const days = Math.min(90, Math.max(7, Number(daysRaw) || 30));
    const since = new Date(Date.now() - days * 86400_000);
    const startOfToday = new Date(`${todayInIstanbul()}T00:00:00+03:00`);
    const [users, guests, pro, designs, designsToday, failedToday, analyses, spentToday] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isGuest: true } }),
      this.prisma.user.count({ where: { plan: 'PRO', OR: [{ planExpiresAt: null }, { planExpiresAt: { gt: new Date() } }] } }),
      this.prisma.design.count(),
      this.prisma.design.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.design.count({ where: { createdAt: { gte: startOfToday }, status: 'FAILED' } }),
      this.prisma.analysis.count(),
      this.prisma.creditLedger.aggregate({
        _sum: { delta: true },
        where: { createdAt: { gte: startOfToday }, reason: { in: ['daily_free', 'generation', 'refund'] } },
      }),
    ]);
    const daily = await this.prisma.$queryRaw<Array<{ date: string; designs: bigint; failed: bigint; new_users: bigint }>>`
      WITH d AS (
        SELECT to_char(gs, 'YYYY-MM-DD') AS date
        FROM generate_series((now() AT TIME ZONE 'Europe/Istanbul')::date - ${days - 1}::int,
                             (now() AT TIME ZONE 'Europe/Istanbul')::date, interval '1 day') gs
      )
      SELECT d.date,
        (SELECT count(*) FROM "Design" x WHERE to_char(x."createdAt" AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD') = d.date) AS designs,
        (SELECT count(*) FROM "Design" x WHERE x.status = 'FAILED' AND to_char(x."createdAt" AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD') = d.date) AS failed,
        (SELECT count(*) FROM "User" u WHERE to_char(u."createdAt" AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD') = d.date) AS new_users
      FROM d ORDER BY d.date`;
    const byTool = await this.prisma.design.groupBy({ by: ['tool'], _count: { _all: true }, where: { createdAt: { gte: since } } });
    const byStyle = await this.prisma.design.groupBy({
      by: ['styleId'], _count: { _all: true }, where: { createdAt: { gte: since }, styleId: { not: null } },
    });
    return {
      totals: {
        users, guests, registered: users - guests, pro, designs, designsToday, failedToday,
        creditsSpentToday: Math.max(0, -(spentToday._sum.delta ?? 0)), analyses,
      },
      daily: daily.map((r) => ({ date: r.date, designs: Number(r.designs), failed: Number(r.failed), newUsers: Number(r.new_users) })),
      byTool: byTool.map((t) => ({ tool: t.tool, count: t._count._all })).sort((a, b) => b.count - a.count),
      byStyle: byStyle.map((s) => ({ styleId: s.styleId!, count: s._count._all })).sort((a, b) => b.count - a.count),
    };
  }

  @Get('users')
  @Doc('Kullanıcılar (arama, sayfalı)', { errors: [401, 403] })
  async listUsers(@Query() query: unknown) {
    const q = parse(UsersQuery, query);
    const where: Prisma.UserWhereInput = q.q
      ? { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }, ...(isUuid(q.q) ? [{ id: q.q }] : [])] }
      : {};
    const rows = await this.prisma.user.findMany({
      where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1, ...cursorArgs(q.cursor),
    });
    const page = rows.slice(0, q.limit);
    return { items: await Promise.all(page.map((u) => this.adminUser(u))), nextCursor: rows.length > q.limit ? page[page.length - 1].id : null };
  }

  @Get('users/:id')
  @Doc('Kullanıcı detayı + son tasarımlar + kredi hareketleri', { errors: [401, 403, 404] })
  async getUser(@Param('id') id: string) {
    if (!isUuid(id)) throw notFound();
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound();
    const [recent, ledger, subscriptions] = await Promise.all([
      this.prisma.design.findMany({ where: { userId: id }, include: { inputImage: true, results: true }, orderBy: { createdAt: 'desc' }, take: 12 }),
      this.prisma.creditLedger.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.subscription.findMany({ where: { userId: id } }),
    ]);
    return {
      ...(await this.adminUser(user)),
      recentDesigns: await Promise.all(recent.map((d) => this.designs.toDto(d))),
      ledger: ledger.map((l) => ({ id: l.id, delta: l.delta, reason: l.reason, refId: l.refId, createdAt: l.createdAt.toISOString() })),
      subscriptions: subscriptions.map((sub) => ({
        entitlement: sub.entitlement, productId: sub.productId, store: sub.store, environment: sub.environment, status: sub.status,
        expiresAt: sub.expiresAt?.toISOString() ?? null, gracePeriodExpiresAt: sub.gracePeriodExpiresAt?.toISOString() ?? null, updatedAt: sub.updatedAt.toISOString(),
      })),
    };
  }

  @Patch('users/:id')
  @Doc('Durum / plan güncelle (ban → tüm oturumlar iptal)', { body: PatchUser, errors: [400, 401, 403, 404] })
  async patchUser(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(PatchUser, body);
    if (!isUuid(id)) throw notFound();
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw notFound();
    if (id === auth.userId && input.status === 'BANNED') throw new AppError(400, 'bad_request', 'Kendi hesabınızı askıya alamazsınız');
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.plan ? { plan: input.plan } : {}),
        ...(input.planExpiresAt !== undefined ? { planExpiresAt: input.planExpiresAt ? new Date(input.planExpiresAt) : null } : {}),
      },
    });
    if (input.status === 'BANNED' && before.status !== 'BANNED') await this.tokens.revokeAll(id); // SES-04
    await this.audit.record(auth.userId, 'user.update', 'user', id, { before: { status: before.status, plan: before.plan }, after: input }, req.clientIp);
    return this.adminUser(await this.users.get(user.id));
  }

  @Post('users/:id/credits')
  @Doc('Gerekçeli kredi ekle/çıkar', { body: Credits, status: 201, errors: [400, 401, 403, 404] })
  async credits(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(Credits, body);
    if (!isUuid(id)) throw notFound();
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id } });
      if (!u) throw notFound();
      if (u.credits + input.delta < 0) throw new AppError(400, 'bad_request', 'Kredi negatif olamaz');
      await tx.creditLedger.create({ data: { userId: id, delta: input.delta, reason: `admin: ${input.reason}`, refId: auth.userId } });
      return tx.user.update({ where: { id }, data: { credits: { increment: input.delta } } });
    });
    await this.audit.record(auth.userId, 'user.credits', 'user', id, { delta: input.delta, reason: input.reason }, req.clientIp);
    return this.adminUser(user);
  }

  @Get('designs')
  @Doc('Tasarım moderasyonu listesi', { errors: [401, 403] })
  async listDesigns(@Query() query: unknown) {
    const q = parse(DesignsQuery, query);
    const where: Prisma.DesignWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.tool ? { tool: q.tool } : {}),
      ...(q.styleId ? { styleId: q.styleId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
    };
    const rows = await this.prisma.design.findMany({
      where, include: { inputImage: true, results: true, user: { select: { email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1, ...cursorArgs(q.cursor),
    });
    const page = rows.slice(0, q.limit);
    return {
      items: await Promise.all(page.map(async (d) => ({ ...(await this.designs.toDto(d)), userId: d.userId, userEmail: d.user.email }))),
      nextCursor: rows.length > q.limit ? page[page.length - 1].id : null,
    };
  }

  @Patch('designs/:id')
  @Doc('Öne çıkar / kaldır', { errors: [400, 401, 403, 404] })
  async patchDesign(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const { featured } = parse(z.object({ featured: z.boolean() }).strict(), body);
    if (!isUuid(id)) throw notFound();
    const exists = await this.prisma.design.findUnique({ where: { id } });
    if (!exists) throw notFound();
    if (featured && exists.status !== 'SUCCEEDED') throw new AppError(400, 'bad_request', 'Yalnız başarılı tasarımlar öne çıkarılabilir');
    const d = await this.prisma.design.update({ where: { id }, data: { featured }, include: { inputImage: true, results: true } });
    await this.audit.record(auth.userId, featured ? 'design.feature' : 'design.unfeature', 'design', id, {}, req.clientIp);
    return this.designs.toDto(d);
  }

  @Delete('designs/:id')
  @HttpCode(204)
  @Doc('Tasarımı sil (denetlenir)', { status: 204, errors: [401, 403, 404] })
  async deleteDesign(@Param('id') id: string, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    if (!isUuid(id)) throw notFound();
    await this.designs.remove(id);
    await this.audit.record(auth.userId, 'design.delete', 'design', id, {}, req.clientIp);
  }

  private async styleDtos() {
    const [styles, usage] = await Promise.all([
      this.catalog.styles(true),
      this.prisma.design.groupBy({ by: ['styleId'], _count: { _all: true }, where: { styleId: { not: null } } }),
    ]);
    const counts = new Map(usage.map((u) => [u.styleId, u._count._all]));
    return styles.map((s) => ({
      id: s.id, nameTr: s.nameTr, nameEn: s.nameEn, descriptionTr: s.descriptionTr, descriptionEn: s.descriptionEn,
      prompt: s.prompt, palette: s.palette, isPro: s.isPro, isActive: s.isActive, sortOrder: s.sortOrder,
      usageCount: counts.get(s.id) ?? 0,
    }));
  }

  @Get('styles')
  @Doc('Stil kataloğu (kullanım sayısıyla)', { errors: [401, 403] })
  async styles() {
    return this.styleDtos();
  }

  @Post('styles')
  @Doc('Stil ekle', { body: StyleInput, status: 201, errors: [400, 401, 403, 409] })
  async createStyle(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(StyleInput, body);
    if (await this.prisma.style.findUnique({ where: { id: input.id } })) throw new AppError(409, 'conflict', 'Bu kimlikte stil var');
    await this.prisma.style.create({ data: input });
    this.catalog.invalidate();
    await this.audit.record(auth.userId, 'style.create', 'style', input.id, { nameTr: input.nameTr }, req.clientIp);
    return (await this.styleDtos()).find((s) => s.id === input.id);
  }

  @Patch('styles/:id')
  @Doc('Stil güncelle', { body: StyleInput.omit({ id: true }).partial(), errors: [400, 401, 403, 404] })
  async patchStyle(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(StyleInput.omit({ id: true }).partial().strict(), body);
    if (!/^[a-z_]{2,40}$/.test(id) || !(await this.prisma.style.findUnique({ where: { id } }))) throw notFound();
    await this.prisma.style.update({ where: { id }, data: input });
    this.catalog.invalidate();
    await this.audit.record(auth.userId, 'style.update', 'style', id, { fields: Object.keys(input) }, req.clientIp);
    return (await this.styleDtos()).find((s) => s.id === id);
  }

  @Get('audit')
  @Doc('Denetim kaydı', { errors: [401, 403] })
  async auditLog(@Query() query: unknown) {
    const q = parse(z.object(Page), query);
    const rows = await this.prisma.auditLog.findMany({
      include: { actor: { select: { email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1, ...cursorArgs(q.cursor),
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((a) => ({
        id: a.id, actorEmail: a.actor?.email ?? null, action: a.action, targetType: a.targetType,
        targetId: a.targetId, meta: a.meta, createdAt: a.createdAt.toISOString(),
      })),
      nextCursor: rows.length > q.limit ? page[page.length - 1].id : null,
    };
  }

  @Get('settings')
  @Doc('Çalışma zamanı ayarları (değerler + varsayılanlar)', { errors: [401, 403] })
  async getSettings() {
    return { values: this.settings.current, defaults: this.settings.defaults };
  }

  /** Every change needs a reason and lands in the audit log (palemi admin `reason` pattern). */
  @Patch('settings')
  @Doc('Ayarları değiştir (gerekçe zorunlu, denetlenir)', { body: z.object({ values: SettingsSchema.partial(), reason: z.string().min(3).max(200) }), errors: [400, 401, 403] })
  async patchSettings(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(z.object({ values: z.record(z.string(), z.unknown()), reason: z.string().trim().min(3).max(200) }).strict(), body);
    const before = this.settings.current;
    const { values, changed } = await this.settings.update(input.values, auth.userId);
    const diff = Object.fromEntries(changed.map((k) => [k, { from: before[k as keyof typeof before], to: values[k as keyof typeof values] }]));
    await this.audit.record(auth.userId, 'settings.update', 'settings', null, { reason: input.reason, diff }, req.clientIp);
    return { values };
  }

  @Get('ai/usage')
  @Doc('AI maliyet defteri ve bütçe durumu', { errors: [401, 403] })
  async aiUsage(@Query('days') daysRaw?: string) {
    return this.usage.stats(Math.min(90, Math.max(1, Number(daysRaw) || 30)));
  }

  @Get('reports')
  @Doc('İçerik bildirimleri', { errors: [401, 403] })
  async listReports(@Query() query: unknown) {
    const q = parse(z.object({ ...Page, status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']).optional() }), query);
    const rows = await this.prisma.contentReport.findMany({
      where: q.status ? { status: q.status } : {},
      include: { design: { include: { inputImage: true, results: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1, ...cursorArgs(q.cursor),
    });
    const page = rows.slice(0, q.limit);
    return {
      items: await Promise.all(
        page.map(async (r) => ({
          id: r.id, designId: r.designId, reason: r.reason, note: r.note, status: r.status, reporterId: r.reporterId,
          createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null, resolution: r.resolution,
          design: await this.designs.toDto(r.design),
        })),
      ),
      nextCursor: rows.length > q.limit ? page[page.length - 1].id : null,
    };
  }

  @Patch('reports/:id')
  @Doc('Bildirimi sonuçlandır (isteğe bağlı: öne çıkarmayı kaldır / tasarımı sil)', { errors: [400, 401, 403, 404] })
  async resolveReport(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(
      z.object({
        status: z.enum(['RESOLVED', 'DISMISSED']),
        resolution: z.string().trim().min(3).max(500),
        unfeature: z.boolean().optional(),
        deleteDesign: z.boolean().optional(),
      }).strict(),
      body,
    );
    if (!isUuid(id)) throw notFound();
    const report = await this.prisma.contentReport.findUnique({ where: { id } });
    if (!report) throw notFound();
    if (input.unfeature) await this.prisma.design.update({ where: { id: report.designId }, data: { featured: false } });
    const updated = await this.prisma.contentReport.update({
      where: { id },
      data: { status: input.status, resolution: input.resolution, resolvedBy: auth.userId, resolvedAt: new Date() },
    });
    await this.audit.record(auth.userId, 'report.resolve', 'report', id, { status: input.status, unfeature: input.unfeature ?? false, deleteDesign: input.deleteDesign ?? false }, req.clientIp);
    if (input.deleteDesign) {
      await this.designs.remove(report.designId); // cascades the report row too
      await this.audit.record(auth.userId, 'design.delete', 'design', report.designId, { via: 'report', reportId: id }, req.clientIp);
      return { ...updated, status: input.status, deleted: true };
    }
    return { id: updated.id, status: updated.status, resolution: updated.resolution, resolvedAt: updated.resolvedAt?.toISOString() ?? null };
  }

  @Doc('Ödeme olayları (RevenueCat webhook kutusu)', { errors: [401, 403] })
  @Get('billing/events')
  async billingEvents(@Query() query: unknown) {
    const q = parse(z.object({ ...Page, status: z.enum(['queued', 'processed', 'unmatched', 'ignored', 'failed']).optional() }), query);
    const rows = await this.prisma.webhookEvent.findMany({
      where: q.status ? { status: q.status } : {},
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((e) => {
        const p = e.payload as Record<string, unknown>;
        return {
          id: e.id, type: e.type, status: e.status, appUserId: e.appUserId, userId: e.userId, error: e.error,
          productId: p.product_id ?? null, store: p.store ?? null, environment: p.environment ?? null,
          receivedAt: e.receivedAt.toISOString(), processedAt: e.processedAt?.toISOString() ?? null,
        };
      }),
      nextCursor: rows.length > q.limit ? page[page.length - 1].id : null,
    };
  }

  @Doc('Ödeme olayını yeniden işle (eşleşmeyen / başarısız)', { status: 201, errors: [401, 403, 404] })
  @Post('billing/events/:id/retry')
  async retryBillingEvent(@Param('id') id: string, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const ev = await this.prisma.webhookEvent.findUnique({ where: { id } });
    if (!ev) throw notFound();
    await this.prisma.webhookEvent.update({ where: { id }, data: { status: 'queued', error: null } });
    await this.billing.process(id);
    await this.audit.record(auth.userId, 'billing.event_retry', 'webhook_event', id, {}, req.clientIp);
    const after = await this.prisma.webhookEvent.findUnique({ where: { id } });
    return { id, status: after?.status };
  }

  @Get('jobs')
  @Doc('Zamanlı işler ve kuyruk durumu', { errors: [401, 403] })
  async jobRuns(@Query('limit') limitRaw?: string) {
    return this.jobs.overview(Math.min(200, Math.max(1, Number(limitRaw) || 50)));
  }

  @Get('system')
  @Doc('Sistem durumu (AI, DB, Redis)', { errors: [401, 403] })
  async system() {
    const [ai, db, redis, storage] = await Promise.all([
      this.ai.health(),
      this.prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const, () => 'down' as const),
      this.redis.client.ping().then(() => 'ok' as const, () => 'down' as const),
      this.images.store.health(),
    ]);
    return { ai, db, redis, storage: { driver: this.images.store.driver, status: storage }, version: process.env.npm_package_version ?? '0.1.0' };
  }
}

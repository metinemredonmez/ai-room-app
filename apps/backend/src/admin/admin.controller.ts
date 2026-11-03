import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { isUuid } from '../images/images.service.js';
import { UsersService } from '../users/users.service.js';
import { AuditService } from './audit.service.js';

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
  ) {}

  private async adminUser(u: User) {
    const designsCount = await this.prisma.design.count({ where: { userId: u.id } });
    return { ...this.users.toDto(u), status: u.status, designsCount, lastSeenAt: u.lastSeenAt?.toISOString() ?? null };
  }

  @Get('stats')
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
  async getUser(@Param('id') id: string) {
    if (!isUuid(id)) throw notFound();
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound();
    const [recent, ledger] = await Promise.all([
      this.prisma.design.findMany({ where: { userId: id }, include: { inputImage: true, results: true }, orderBy: { createdAt: 'desc' }, take: 12 }),
      this.prisma.creditLedger.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return {
      ...(await this.adminUser(user)),
      recentDesigns: await Promise.all(recent.map((d) => this.designs.toDto(d))),
      ledger: ledger.map((l) => ({ id: l.id, delta: l.delta, reason: l.reason, refId: l.refId, createdAt: l.createdAt.toISOString() })),
    };
  }

  @Patch('users/:id')
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
  async styles() {
    return this.styleDtos();
  }

  @Post('styles')
  async createStyle(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(StyleInput, body);
    if (await this.prisma.style.findUnique({ where: { id: input.id } })) throw new AppError(409, 'conflict', 'Bu kimlikte stil var');
    await this.prisma.style.create({ data: input });
    this.catalog.invalidate();
    await this.audit.record(auth.userId, 'style.create', 'style', input.id, { nameTr: input.nameTr }, req.clientIp);
    return (await this.styleDtos()).find((s) => s.id === input.id);
  }

  @Patch('styles/:id')
  async patchStyle(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(StyleInput.omit({ id: true }).partial().strict(), body);
    if (!/^[a-z_]{2,40}$/.test(id) || !(await this.prisma.style.findUnique({ where: { id } }))) throw notFound();
    await this.prisma.style.update({ where: { id }, data: input });
    this.catalog.invalidate();
    await this.audit.record(auth.userId, 'style.update', 'style', id, { fields: Object.keys(input) }, req.clientIp);
    return (await this.styleDtos()).find((s) => s.id === id);
  }

  @Get('audit')
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

  @Get('system')
  async system() {
    const [ai, db, redis] = await Promise.all([
      this.ai.health(),
      this.prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const, () => 'down' as const),
      this.redis.client.ping().then(() => 'ok' as const, () => 'down' as const),
    ]);
    return { ai, db, redis, version: process.env.npm_package_version ?? '0.1.0' };
  }
}

import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { BILLING_ENVS } from '../admin/analytics.rules.js';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError, notFound, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, PrismaService, RateLimiter } from '../common/infra.js';
import { log } from '../common/log.js';
import { Doc } from '../common/openapi.js';
import { CONFIG, type Config } from '../config.js';
import { cursorArgs } from '../designs/designs.service.js';
import type { Prisma, Subscription } from '../generated/prisma/client.js';
import { BillingService } from './billing.service.js';
import { CatalogInputSchema, CatalogSaveSchema } from './plans.rules.js';
import { PlansService } from './plans.service.js';

// Plans, packs and subscribers in the admin (API.md §7.21). Reading is for SUPPORT and up (answering users);
// changing the catalog or syncing a subscriber is for ADMIN and up, with a reason, and audited (LOG-01).

const SaveBody = z.object({ catalog: z.unknown(), reason: z.string().trim().min(3).max(200), version: z.string().max(40).nullable() }).strict();
const ISSUE_TEXT: Record<string, string> = {
  duplicate_product: 'aynı ürün kimliği iki yerde kullanılamaz',
  active_needs_product: 'satıştaki dönem ya da paket en az bir ürün kimliği ister',
  active_needs_price: 'satıştaki dönemin web fiyatı olmalı',
  duplicate_cycle: 'her dönem bir kez eklenebilir',
  duplicate_key: 'paket anahtarları benzersiz olmalı',
  one_highlight: 'yalnız bir tanesi öne çıkarılabilir',
};
const SUB_STATUSES = ['active', 'trial', 'cancelled', 'grace', 'billing_issue', 'expired'] as const;
const SubsQuery = z.object({
  status: z.enum(SUB_STATUSES).optional(),
  env: z.enum(BILLING_ENVS).default('PRODUCTION'),
  q: z.string().trim().max(100).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const UserId = z.uuid();
const notTrial: Prisma.SubscriptionWhereInput = { OR: [{ periodType: null }, { periodType: { not: 'TRIAL' } }] };

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/billing')
@UseGuards(AdminGuard)
export class AdminPlansController {
  constructor(private plans: PlansService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get('catalog')
  @Doc('Plan ve paket kataloğu (düzenleme için)', { errors: [401, 403] })
  catalog() {
    return this.plans.forAdmin();
  }

  @MinRole('ADMIN')
  @Patch('catalog')
  @Doc('Kataloğu kaydet (gerekçe zorunlu, denetlenir)', {
    body: z.object({ catalog: CatalogInputSchema, reason: z.string().min(3).max(200), version: z.string().nullable() }),
    description: '`version`: okunan `version` (hiç kaydedilmediyse null); arada değiştiyse 409. Kaldırılan paketin ürünü kredi vermeye devam eder.',
    errors: [400, 401, 403, 409],
  })
  async save(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(SaveBody, body);
    const catalog = CatalogSaveSchema.safeParse(input.catalog);
    if (!catalog.success) {
      const issues = catalog.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'katalog'}: ${ISSUE_TEXT[i.message] ?? 'geçersiz değer'}`);
      throw new AppError(400, 'validation_failed', `Katalog kaydedilemedi — ${issues.join('; ')}`, {}, { fields: catalog.error.issues.map((i) => i.path.join('.')) });
    }
    const { changes } = await this.plans.save(catalog.data, input.version, auth.userId);
    await this.audit.record(auth.userId, 'billing.catalog_update', 'settings', 'billing.catalog', { reason: input.reason, changes }, req.clientIp);
    return this.plans.forAdmin();
  }
}

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/subscriptions')
@UseGuards(AdminGuard)
export class AdminSubscriptionsController {
  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
    private audit: AuditService,
    private limiter: RateLimiter,
    @Inject(CONFIG) private cfg: Config,
  ) {}

  private dto(s: Subscription & { user?: { email: string | null; isGuest: boolean } | null }) {
    const until = [s.expiresAt, s.gracePeriodExpiresAt].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      id: s.id,
      userId: s.userId,
      email: s.user?.email ?? null,
      isGuest: s.user?.isGuest ?? null,
      productId: s.productId,
      store: s.store,
      environment: s.environment,
      periodType: s.periodType,
      status: s.status,
      expiresAt: s.expiresAt?.toISOString() ?? null,
      gracePeriodExpiresAt: s.gracePeriodExpiresAt?.toISOString() ?? null,
      updatedAt: s.updatedAt.toISOString(),
      access: s.status !== 'expired' && until !== null && until > new Date(),
    };
  }

  @MinRole('SUPPORT')
  @Get()
  @Doc('Aboneler (durum, ortam, e-posta araması; sayfalı)', {
    description: '`status`: active | trial | cancelled | grace | billing_issue | expired (deneme ayrı sayılır). `env` PRODUCTION | SANDBOX. `counts` seçili ortamın durum sayıları.',
    errors: [400, 401, 403],
  })
  async list(@Query() query: unknown) {
    const q = parse(SubsQuery, query);
    const env: Prisma.SubscriptionWhereInput = q.env === 'PRODUCTION' ? { OR: [{ environment: 'PRODUCTION' }, { environment: null }] } : { environment: 'SANDBOX' };
    const status: Prisma.SubscriptionWhereInput = !q.status
      ? {}
      : q.status === 'trial'
        ? { periodType: 'TRIAL', status: { not: 'expired' } }
        : q.status === 'expired'
          ? { status: 'expired' }
          : { AND: [{ status: q.status }, notTrial] };
    const search: Prisma.SubscriptionWhereInput = !q.q
      ? {}
      : UserId.safeParse(q.q).success
        ? { userId: q.q }
        : { user: { email: { contains: q.q, mode: 'insensitive' } } };
    const rows = await this.prisma.subscription.findMany({
      where: { AND: [env, status, search] },
      include: { user: { select: { email: true, isGuest: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...cursorArgs(q.cursor),
    });
    const grouped = await this.prisma.subscription.groupBy({ by: ['status', 'periodType'], where: env, _count: { _all: true } });
    const counts: Record<(typeof SUB_STATUSES)[number], number> = { active: 0, trial: 0, cancelled: 0, grace: 0, billing_issue: 0, expired: 0 };
    for (const g of grouped) {
      const key = g.status !== 'expired' && g.periodType === 'TRIAL' ? 'trial' : (g.status as keyof typeof counts);
      if (key in counts) counts[key] += g._count._all;
    }
    const page = rows.slice(0, q.limit);
    return { items: page.map((s) => this.dto(s)), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null, counts };
  }

  /** Re-reads the subscriber from RevenueCat (the source of truth) when a user says "I paid but I'm not PRO". */
  @MinRole('ADMIN')
  @Post(':userId/sync')
  @HttpCode(200)
  @Doc('Aboneyi RevenueCat ile eşitle (denetlenir)', { description: 'RevenueCat REST anahtarı tanımlı değilse 409.', errors: [401, 403, 404, 409, 429, 502] })
  async sync(@Param('userId') userId: string, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const id = parse(UserId, userId);
    if (!this.cfg.REVENUECAT_API_KEY) throw new AppError(409, 'revenuecat_rest_disabled', 'RevenueCat REST anahtarı tanımlı değil; eşitleme yapılamıyor.');
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw notFound();
    await this.limiter.hit(LIMITS.billingSync, `admin:${auth.userId}`);
    try {
      await this.billing.syncFromRest(id);
    } catch (e) {
      log.warn('admin_billing_sync_failed', { userId: id, error: (e as Error).message });
      throw new AppError(502, 'revenuecat_unavailable', 'RevenueCat şu an yanıt vermiyor; birazdan yeniden dene.');
    }
    await this.audit.record(auth.userId, 'billing.sync', 'user', id, {}, req.clientIp);
    const sub = await this.prisma.subscription.findFirst({
      where: { userId: id, entitlement: this.cfg.REVENUECAT_ENTITLEMENT },
      include: { user: { select: { email: true, isGuest: true } } },
    });
    return { subscription: sub ? this.dto(sub) : null };
  }
}

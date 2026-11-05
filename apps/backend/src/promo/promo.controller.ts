import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard, UserGuard } from '../auth/tokens.service.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { BatchSchema, CreateCodeSchema, RedeemSchema, UpdateCodeSchema } from './promo.rules.js';
import { PromoService } from './promo.service.js';

// API.md §7.29. Users redeem with a per-account and per-IP budget (RES-01: guessing codes is slow and visible);
// staff create shared codes and gift batches (ADMIN), everyone on staff can look (SUPPORT), all of it audited (LOG-01).

const issueText = (e: z.ZodError) =>
  e.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'kod'}: ${i.message.length < 60 ? i.message : 'geçersiz değer'}`).join('; ');

@ApiTags('user')
@ApiBearerAuth('user')
@Controller('v1/me/promo')
@UseGuards(UserGuard)
export class PromoController {
  constructor(private promo: PromoService, private limiter: RateLimiter) {}

  @Post()
  @HttpCode(200)
  @Doc('Promosyon / hediye kodu kullan', {
    body: RedeemSchema,
    description: 'Kayıtlı ve e-postası doğrulanmış hesap gerekir. Büyük-küçük harf, boşluk ve tire fark etmez. Geçersiz, süresi dolmuş ya da tükenmiş kod için tek yanıt: 404 `invalid_code`. Aynı kişi aynı kodu bir kez kullanır (409 `already_redeemed`). Saatte 10 deneme.',
    errors: [400, 401, 403, 404, 409, 429],
  })
  async redeem(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const { code } = parse(RedeemSchema, body);
    await this.limiter.hit(LIMITS.promoUser, auth.userId);
    await this.limiter.hit(LIMITS.promoIp, req.clientIp);
    return this.promo.redeem(auth.userId, code);
  }
}

const ListQuery = z.object({
  campaign: z.string().trim().max(80).optional(),
  q: z.string().trim().max(80).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/promo')
@UseGuards(AdminGuard)
export class AdminPromoController {
  constructor(private promo: PromoService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Promosyon kodları ve kampanya özetleri', { description: '`?q=` kampanya adında ya da tam kodla arar.', errors: [401, 403] })
  list(@Query() query: unknown) {
    const q = parse(ListQuery, query);
    return this.promo.list({ campaign: q.campaign, search: q.q, cursor: q.cursor, limit: q.limit });
  }

  @MinRole('ADMIN')
  @Post()
  @Doc('Paylaşılan kampanya kodu oluştur', { body: CreateCodeSchema, status: 201, errors: [400, 401, 403, 409] })
  async create(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const r = CreateCodeSchema.safeParse(body);
    if (!r.success) throw new AppError(400, 'validation_failed', `Kod oluşturulamadı — ${issueText(r.error)}`);
    const created = await this.promo.create(r.data, auth.userId);
    await this.audit.record(auth.userId, 'promo.create', 'promo', created.id, { reason: r.data.reason, code: created.display, campaign: created.campaign, kind: created.kind, amount: created.amount }, req.clientIp);
    return created;
  }

  @MinRole('ADMIN')
  @Post('batch')
  @Doc('Tek kullanımlık hediye kodları üret (kodlar yalnız bu yanıtta görünür)', { body: BatchSchema, status: 201, errors: [400, 401, 403] })
  async batch(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const r = BatchSchema.safeParse(body);
    if (!r.success) throw new AppError(400, 'validation_failed', `Kodlar üretilemedi — ${issueText(r.error)}`);
    const out = await this.promo.batch(r.data, auth.userId);
    await this.audit.record(auth.userId, 'promo.batch', 'promo', r.data.campaign, { reason: r.data.reason, count: out.codes.length, kind: out.kind, amount: out.amount }, req.clientIp);
    return out;
  }

  @MinRole('ADMIN')
  @Patch(':id')
  @Doc('Kodu durdur / sürdür, bitişini ya da sınırını değiştir', { body: UpdateCodeSchema, errors: [400, 401, 403, 404] })
  async update(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const r = UpdateCodeSchema.safeParse(body);
    if (!r.success) throw new AppError(400, 'validation_failed', 'Değiştirilecek bir alan ve gerekçe gerekli.');
    const { before, after } = await this.promo.update(id, r.data);
    await this.audit.record(auth.userId, 'promo.update', 'promo', id, { reason: r.data.reason, before: { active: before.active, endsAt: before.endsAt, maxRedemptions: before.maxRedemptions }, after: { active: after.active, endsAt: after.endsAt, maxRedemptions: after.maxRedemptions } }, req.clientIp);
    return after;
  }

  @MinRole('SUPPORT')
  @Get(':id/redemptions')
  @Doc('Kodu kimler, ne zaman kullandı (en çok 200)', { errors: [401, 403, 404] })
  redemptions(@Param('id') id: string) {
    return this.promo.redemptions(id);
  }
}

import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard, UserGuard } from '../auth/tokens.service.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { CreatePartnerSchema, PartnersService, UpdatePartnerSchema } from './partners.service.js';

// API.md §7.33. Public visit counter (rate-limited per IP and link, RES-01), the user's one-time attribution, and the
// admin report (SUPPORT reads, ADMIN creates and edits, audited LOG-01).

const Via = z.object({ via: z.string().max(60) }).strict();

@ApiTags('public')
@Controller('v1/partners')
export class PartnersPublicController {
  constructor(private partners: PartnersService, private limiter: RateLimiter) {}

  @Post(':slug/visit')
  @HttpCode(200)
  @Doc('Ortak bağlantısı ziyareti say', { description: 'Bilinmeyen ya da durdurulmuş bağlantıda `counted: false`. IP ve bağlantı başına saatte 20.', errors: [429] })
  async visit(@Param('slug') slug: string, @Req() req: AppRequest) {
    await this.limiter.hit(LIMITS.partnerVisit, `${req.clientIp}:${slug.slice(0, 40).toLowerCase()}`);
    return this.partners.visit(slug);
  }
}

@ApiTags('user')
@ApiBearerAuth('user')
@Controller('v1/me/attribution')
@UseGuards(UserGuard)
export class AttributionController {
  constructor(private partners: PartnersService, private limiter: RateLimiter) {}

  @Post()
  @HttpCode(200)
  @Doc('Bu yeni hesabı geldiği ortak bağlantısına yaz (bir kez)', { body: Via, description: 'Hesap 24 saatten eskiyse, ortak durdurulmuşsa ya da zaten yazılmışsa `attributed: false`.', errors: [400, 401, 429] })
  async attribute(@Auth() auth: AuthContext, @Body() body: unknown) {
    const { via } = parse(Via, body);
    await this.limiter.hit(LIMITS.promoUser, auth.userId);
    return this.partners.attribute(auth.userId, via);
  }
}

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/partners')
@UseGuards(AdminGuard)
export class AdminPartnersController {
  constructor(private partners: PartnersService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Ortaklar ve sonuçları (ziyaret, kayıt, doğrulanan, tasarım yapan, ödeyen, net gelir, tahmini komisyon)', { errors: [401, 403] })
  list() {
    return this.partners.list();
  }

  @MinRole('ADMIN')
  @Post()
  @Doc('Ortak bağlantısı oluştur', { body: CreatePartnerSchema, status: 201, errors: [400, 401, 403, 409] })
  async create(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const r = CreatePartnerSchema.safeParse(body);
    if (!r.success) throw new AppError(400, 'validation_failed', 'Ortak: ad 2–80, bağlantı adı 3–40 küçük harf/rakam/tire, komisyon %0–50, gerekçe 3–200.');
    const p = await this.partners.create(r.data, auth.userId);
    await this.audit.record(auth.userId, 'partner.create', 'partner', p.id, { reason: r.data.reason, slug: p.slug, name: p.name, commissionPct: p.commissionPct }, req.clientIp);
    return { id: p.id, slug: p.slug, link: this.partners.link(p.slug) };
  }

  @MinRole('ADMIN')
  @Patch(':id')
  @Doc('Ortağı düzenle, durdur ya da sürdür', { body: UpdatePartnerSchema, errors: [400, 401, 403, 404] })
  async update(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const r = UpdatePartnerSchema.safeParse(body);
    if (!r.success) throw new AppError(400, 'validation_failed', 'Değiştirilecek bir alan ve gerekçe gerekli.');
    const { before, after } = await this.partners.update(id, r.data);
    await this.audit.record(auth.userId, 'partner.update', 'partner', id, {
      reason: r.data.reason,
      before: { name: before.name, commissionPct: before.commissionPct, active: before.active },
      after: { name: after.name, commissionPct: after.commissionPct, active: after.active },
    }, req.clientIp);
    return { id: after.id };
  }
}

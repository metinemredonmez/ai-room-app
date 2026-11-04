import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { isLocale } from '../catalog/catalog.data.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { AsoListingSchema, AsoRunSchema } from './marketing.rules.js';
import { MarketingService } from './marketing.service.js';

const Id = z.uuid();
const UpdateBody = z.object({ output: AsoListingSchema }).strict();

/**
 * Pazarlama (API.md §7.18). EDITOR writes and edits drafts, ADMIN approves them. AI-02: the agents only produce
 * text; nothing is published or sent from here. Every write is audited.
 */
@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/marketing')
@UseGuards(AdminGuard)
export class AdminMarketingController {
  constructor(private marketing: MarketingService, private audit: AuditService, private limiter: RateLimiter) {}

  @Get('facts')
  @MinRole('EDITOR')
  @Doc('Ajanlara verilen bilgi sayfası', { description: 'Katalogdan ve ayarlardan üretilir; ajan yalnız bunları kullanabilir. `?locale=` ile o dildeki uygulama adları.', errors: [401, 403] })
  async facts(@Query('locale') locale?: string) {
    return { facts: await this.marketing.facts(isLocale(locale) ? locale : 'tr') };
  }

  @Get('aso')
  @MinRole('EDITOR')
  @Doc('Mağaza metni taslakları', { description: 'Arşivlenmemiş taslaklar, yeniden eskiye (en çok 200).', errors: [401, 403] })
  list() {
    return this.marketing.listAso();
  }

  @Post('aso')
  @HttpCode(202)
  @MinRole('EDITOR')
  @Doc('Mağaza metni yaz', {
    body: AsoRunSchema,
    status: 202,
    description: 'Her dil için bir taslak açar ve arka planda yazdırır (dil başına ≈1 dk). Saatte en çok 10 çalıştırma.',
    errors: [400, 401, 403, 409, 429, 503],
  })
  async run(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(AsoRunSchema, body);
    await this.limiter.hit(LIMITS.marketing, auth.userId);
    const out = await this.marketing.runAso(input, auth.userId);
    await this.audit.record(auth.userId, 'marketing.aso_run', 'marketing', null, { locales: input.locales, brief: input.brief ?? null }, req.clientIp);
    return out;
  }

  @Get('aso/export')
  @MinRole('EDITOR')
  @Doc('Onaylı mağaza metinleri', { description: '`appStore`: EAS Metadata `store.config.json`; `googlePlay`: Play Console için dil başına metinler.', errors: [401, 403] })
  export() {
    return this.marketing.exportAso();
  }

  @Patch('drafts/:id')
  @MinRole('EDITOR')
  @Doc('Taslağı düzenle', { body: UpdateBody, description: 'Mağaza sınırları denetlenir. Onaylı taslak düzenlenince yeniden onay ister.', errors: [400, 401, 403, 404, 409] })
  async update(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const draftId = parse(Id, id);
    const { output } = parse(UpdateBody, body);
    const out = await this.marketing.update(draftId, output);
    await this.audit.record(auth.userId, 'marketing.edit', 'marketing', draftId, { locale: out.locale }, req.clientIp);
    return out;
  }

  @Post('drafts/:id/approve')
  @HttpCode(200)
  @MinRole('ADMIN')
  @Doc('Taslağı onayla', { description: 'Dilin güncel metni olur; önceki onaylı metin arşivlenir.', errors: [401, 403, 404, 409, 422] })
  async approve(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    const draftId = parse(Id, id);
    const out = await this.marketing.approve(draftId, auth.userId);
    await this.audit.record(auth.userId, 'marketing.approve', 'marketing', draftId, { locale: out.locale }, req.clientIp);
    return out;
  }

  @Post('drafts/:id/archive')
  @HttpCode(200)
  @MinRole('EDITOR')
  @Doc('Taslağı arşivle', { errors: [401, 403, 404, 409] })
  async archive(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    const draftId = parse(Id, id);
    const out = await this.marketing.archive(draftId);
    await this.audit.record(auth.userId, 'marketing.archive', 'marketing', draftId, { locale: out.locale }, req.clientIp);
    return out;
  }
}

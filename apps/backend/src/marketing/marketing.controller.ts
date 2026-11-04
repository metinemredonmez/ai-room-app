import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { isLocale } from '../catalog/catalog.data.js';
import { parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { SOCIAL_FORMATS, isSocialFormat } from './marketing.images.js';
import { AsoRunSchema, CampaignRunSchema, SocialRunSchema } from './marketing.rules.js';
import { DRAFT_KINDS, MarketingService } from './marketing.service.js';

const Id = z.uuid();
const Kind = z.enum(DRAFT_KINDS);
const UpdateBody = z.object({ output: z.record(z.string(), z.unknown()) }).strict();
const ReportBody = z.object({ send: z.boolean().default(false) }).strict();

/**
 * Pazarlama (API.md §7.18). EDITOR writes and edits drafts, ADMIN approves them and turns a campaign into a
 * Toplu Gönderim draft. AI-02: the agents only produce text and images; nothing is published or sent to users
 * from here. Every write is audited.
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

  @Get('drafts')
  @MinRole('EDITOR')
  @Doc('Taslaklar', { description: '`?kind=aso|social|campaign|report`; arşivlenmemişler, yeniden eskiye (en çok 200).', errors: [400, 401, 403] })
  list(@Query('kind') kind: unknown) {
    return this.marketing.list(parse(Kind, kind));
  }

  @Post('aso')
  @HttpCode(202)
  @MinRole('EDITOR')
  @Doc('Mağaza metni yaz', { body: AsoRunSchema, status: 202, description: 'Dil başına bir taslak (≈1 dk, ≈0,1 $).', errors: [400, 401, 403, 409, 429, 503] })
  async runAso(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(AsoRunSchema, body);
    await this.limiter.hit(LIMITS.marketing, auth.userId);
    const out = await this.marketing.runAso(input, auth.userId);
    await this.audit.record(auth.userId, 'marketing.aso_run', 'marketing', null, { locales: input.locales, brief: input.brief ?? null }, req.clientIp);
    return out;
  }

  @Post('social')
  @HttpCode(202)
  @MinRole('EDITOR')
  @Doc('Sosyal medya gönderisi yaz', { body: SocialRunSchema, status: 202, description: 'Stil × platform × dil başına bir taslak (en çok 30). Görsel: kendi örnek odamız ve stil fotoğrafı.', errors: [400, 401, 403, 429, 503] })
  async runSocial(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(SocialRunSchema, body);
    await this.limiter.hit(LIMITS.marketing, auth.userId);
    const out = await this.marketing.runSocial(input, auth.userId);
    await this.audit.record(auth.userId, 'marketing.social_run', 'marketing', null, { styles: input.styleIds, platforms: input.platforms, locales: input.locales }, req.clientIp);
    return out;
  }

  @Get('social/styles')
  @MinRole('EDITOR')
  @Doc('Gönderide kullanılabilecek stiller', { description: 'Örnek odadan üretilmiş fotoğrafı olan stiller.', errors: [401, 403] })
  socialStyles() {
    return this.marketing.socialStyles();
  }

  @Get('drafts/:id/image')
  @MinRole('EDITOR')
  @Doc('Gönderi görseli', { description: `\`?format=${Object.keys(SOCIAL_FORMATS).join('|')}\` → \`{ dataUrl, width, height }\` (JPEG).`, errors: [400, 401, 403, 404] })
  async image(@Param('id') id: string, @Query('format') format: unknown) {
    const draftId = parse(Id, id);
    const f = isSocialFormat(format) ? format : 'square';
    const buf = await this.marketing.image(draftId, f);
    return { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`, width: SOCIAL_FORMATS[f].width, height: SOCIAL_FORMATS[f].height };
  }

  @Post('campaign')
  @HttpCode(202)
  @MinRole('EDITOR')
  @Doc('Toplu gönderim metni yaz', { body: CampaignRunSchema, status: 202, description: 'Dil başına bir taslak; ticari ifade kontrolü taslakta da yapılır.', errors: [400, 401, 403, 429, 503] })
  async runCampaign(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(CampaignRunSchema, body);
    await this.limiter.hit(LIMITS.marketing, auth.userId);
    const out = await this.marketing.runCampaign(input, auth.userId);
    await this.audit.record(auth.userId, 'marketing.campaign_run', 'marketing', null, { locales: input.locales, kind: input.kind, channel: input.channel, goal: input.goal }, req.clientIp);
    return out;
  }

  @Post('drafts/:id/broadcast')
  @HttpCode(201)
  @MinRole('ADMIN')
  @Doc('Kampanya metninden toplu gönderim taslağı aç', { description: 'Onaylı metin, o dildeki kullanıcılara giden bir Toplu Gönderim TASLAĞI olur; gönderim kendi ekranından yapılır.', status: 201, errors: [401, 403, 404, 409, 422] })
  async toBroadcast(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    const draftId = parse(Id, id);
    const out = await this.marketing.toBroadcast(draftId, auth.userId);
    await this.audit.record(auth.userId, 'marketing.to_broadcast', 'marketing', draftId, { broadcastId: out.broadcastId }, req.clientIp);
    return out;
  }

  @Post('report')
  @HttpCode(202)
  @MinRole('ADMIN')
  @Doc('Haftalık raporu şimdi oluştur', { body: ReportBody, status: 202, description: '`send: true` raporu SUPER_ADMIN adreslerine de gönderir. Her pazartesi 09:00 kendiliğinden gönderilir.', errors: [400, 401, 403, 429] })
  async runReport(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const { send } = parse(ReportBody, body ?? {});
    await this.limiter.hit(LIMITS.marketing, auth.userId);
    const out = await this.marketing.runReport(send, auth.userId);
    await this.audit.record(auth.userId, 'marketing.report_run', 'marketing', null, { send }, req.clientIp);
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
  @Doc('Taslağı düzenle', { body: UpdateBody, description: 'Türün sınırları denetlenir. Onaylı taslak düzenlenince yeniden onay ister.', errors: [400, 401, 403, 404, 409] })
  async update(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const draftId = parse(Id, id);
    const { output } = parse(UpdateBody, body);
    const out = await this.marketing.update(draftId, output);
    await this.audit.record(auth.userId, 'marketing.edit', 'marketing', draftId, { kind: out.kind, locale: out.locale }, req.clientIp);
    return out;
  }

  @Post('drafts/:id/approve')
  @HttpCode(200)
  @MinRole('ADMIN')
  @Doc('Taslağı onayla', { description: 'Mağaza metninde dilin güncel metni olur; önceki onaylı metin arşivlenir.', errors: [401, 403, 404, 409, 422] })
  async approve(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    const draftId = parse(Id, id);
    const out = await this.marketing.approve(draftId, auth.userId);
    await this.audit.record(auth.userId, 'marketing.approve', 'marketing', draftId, { kind: out.kind, locale: out.locale }, req.clientIp);
    return out;
  }

  @Post('drafts/:id/archive')
  @HttpCode(200)
  @MinRole('EDITOR')
  @Doc('Taslağı arşivle', { errors: [401, 403, 404, 409] })
  async archive(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    const draftId = parse(Id, id);
    const out = await this.marketing.archive(draftId);
    await this.audit.record(auth.userId, 'marketing.archive', 'marketing', draftId, { kind: out.kind, locale: out.locale }, req.clientIp);
    return out;
  }
}

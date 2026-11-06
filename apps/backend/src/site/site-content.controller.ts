import { Body, Controller, Get, Header, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { isLocale } from '../catalog/catalog.data.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { ANNOUNCEMENT_MAX, FAQ_LIMITS, SiteContentSchema } from './site-content.rules.js';
import { SiteContentService } from './site-content.service.js';

// API.md §7.46. Public: what the home page shows in one language (sections, a live announcement, overridden texts).
// Admin: SUPPORT reads, EDITOR saves the whole set with a reason under a version, audited (LOG-01).

@ApiTags('public')
@Controller('v1/site')
export class SiteContentController {
  constructor(private site: SiteContentService) {}

  @Get('content')
  @Header('Cache-Control', 'public, max-age=60')
  @Doc('Ana sayfa içeriği', { description: '`?locale=` (11 dil, yoksa tr) → `{ sections, announcement, texts }`. `texts` yalnız panelde değiştirilen metinlerdir; olmayan metin için istemci kendi çevirisini kullanır.' })
  get(@Query('locale') locale?: string) {
    return this.site.forLocale(isLocale(locale) ? locale : 'tr');
  }
}

const SaveBody = z.object({ content: z.unknown(), reason: z.string().trim().min(3).max(200), version: z.string().max(40).nullable() }).strict();

const ERRORS: Record<string, string> = {
  control_char: 'Metinlerde görünmeyen denetim karakteri olamaz (cevaplarda yalnız satır sonu olabilir).',
  duplicate_question: 'Aynı soru iki kez yazılmış.',
  announcement_empty: 'Açık duyurunun en az bir dilde metni olmalı.',
  announcement_window: 'Duyurunun bitişi başlangıcından sonra olmalı.',
};

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/site-content')
@UseGuards(AdminGuard)
export class AdminSiteContentController {
  constructor(private site: SiteContentService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Ana sayfa ve SSS: kayıtlı içerik ve sitenin 11 dildeki kendi metinleri', { errors: [401, 403] })
  get() {
    return this.site.forAdmin();
  }

  @MinRole('EDITOR')
  @Patch()
  @Doc('Ana sayfa ve SSS kaydet (hepsi birlikte; gerekçe zorunlu, denetlenir)', { body: z.object({ content: SiteContentSchema, reason: z.string().min(3).max(200), version: z.string().nullable() }), errors: [400, 401, 403, 409] })
  async save(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(SaveBody, body);
    const r = SiteContentSchema.safeParse(input.content);
    if (!r.success) {
      const issue = r.error.issues[0];
      const where = issue?.path.join('.') ?? '';
      const custom = r.error.issues.map((i) => ERRORS[i.message]).find(Boolean);
      throw new AppError(
        400,
        'validation_failed',
        custom ?? `İçerik geçersiz${where ? ` (${where})` : ''}: metinler boş olamaz ve sınırı aşamaz (soru ${FAQ_LIMITS.q}, cevap ${FAQ_LIMITS.a}, duyuru ${ANNOUNCEMENT_MAX} karakter; en çok ${FAQ_LIMITS.items} soru); bağlantı /studio, /fiyatlar, /sohbet ya da /blog… olabilir.`,
      );
    }
    const { changes } = await this.site.save(r.data, input.version, auth.userId);
    if (changes.length) await this.audit.record(auth.userId, 'site_content.update', 'settings', 'site.content', { reason: input.reason, changes }, req.clientIp);
    return { ...(await this.site.forAdmin()), changes };
  }
}

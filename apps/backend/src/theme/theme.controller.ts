import { Body, Controller, Get, Header, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { contrastReport, deriveTokens, ThemeSchema, TonesSchema } from './theme.rules.js';
import { ThemeService } from './theme.service.js';

// API.md §7.34. Public: the colour themes the web and the app offer (enabled ones, default first). Admin: SUPPORT
// reads, ADMIN edits the whole set with a reason under a version, audited (LOG-01).

@ApiTags('public')
@Controller('v1')
export class ThemeController {
  constructor(private theme: ThemeService) {}

  @Get('theme')
  @Header('Cache-Control', 'public, max-age=60')
  @Doc('Renk temaları (açık olanlar, varsayılan önce; her biri 6 ton ve 11 renk değişkeni)')
  get() {
    return this.theme.public;
  }
}

const SaveBody = z.object({ theme: z.unknown(), reason: z.string().trim().min(3).max(200), version: z.string().max(40).nullable() }).strict();
const DeriveBody = z.object({ tones: z.unknown() }).strict();

const THEME_ERRORS: Record<string, string> = {
  duplicate_id: 'Aynı kısa ad iki palette kullanılmış.',
  default_missing: 'Varsayılan tema listede yok.',
  default_disabled: 'Varsayılan tema kapalı olamaz.',
};

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/theme')
@UseGuards(AdminGuard)
export class AdminThemeController {
  constructor(private theme: ThemeService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Renk temaları, okunurluk raporuyla', { errors: [401, 403] })
  get() {
    return this.theme.forAdmin();
  }

  @MinRole('ADMIN')
  @Patch()
  @Doc('Temaları kaydet (hepsi birlikte; gerekçe zorunlu, denetlenir)', { body: z.object({ theme: ThemeSchema, reason: z.string().min(3).max(200), version: z.string().nullable() }), errors: [400, 401, 403, 409] })
  async save(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(SaveBody, body);
    const r = ThemeSchema.safeParse(input.theme);
    if (!r.success) {
      const custom = r.error.issues.map((i) => THEME_ERRORS[i.message]).find(Boolean);
      throw new AppError(400, 'validation_failed', custom ?? 'Tema geçersiz: renkler #rrggbb, kısa ad küçük harf/rakam/tire (2–24), adlar 1–30 karakter, en çok 24 palet.');
    }
    const { changes } = await this.theme.save(r.data, input.version, auth.userId);
    await this.audit.record(auth.userId, 'theme.update', 'settings', 'ui.theme', { reason: input.reason, changes }, req.clientIp);
    return this.theme.forAdmin();
  }

  @MinRole('SUPPORT')
  @Post('derive')
  @HttpCode(200)
  @Doc('6 tondan renk değişkenleri ve okunurluk raporu (önizleme; kaydetmez)', { body: z.object({ tones: TonesSchema }), errors: [400, 401, 403] })
  derive(@Body() body: unknown) {
    const tones = TonesSchema.safeParse(parse(DeriveBody, body).tones);
    if (!tones.success) throw new AppError(400, 'validation_failed', 'Koyudan açığa 6 renk gerekli, her biri #rrggbb.');
    const tokens = deriveTokens(tones.data);
    return { tones: tones.data, tokens, contrast: contrastReport(tokens) };
  }
}

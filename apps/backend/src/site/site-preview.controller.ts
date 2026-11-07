import { Body, Controller, Get, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { SitePreviewService } from './site-preview.service.js';

// API.md §7.52. Public: whether the web site is closed for maintenance, and the staff preview check the web's
// proxy makes. Admin: SUPPORT sees whether a link exists; ADMIN makes a new one or cancels it, with a reason (LOG-01).

const PreviewBody = z.object({ token: z.string().min(1).max(100) }).strict();
const ReasonBody = z.object({ reason: z.string().trim().min(3).max(200) }).strict();

@ApiTags('public')
@Controller('v1/site')
export class SiteStatusController {
  constructor(private preview: SitePreviewService, private limiter: RateLimiter) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  @Doc('Web sitesi bakımda mı', { description: '`{ maintenance, messageTr, messageEn }`; bakım kapalıyken mesajlar boştur. Ayar: Ayarlar → Bakım modu → web sitesi.' })
  status() {
    return this.preview.status;
  }

  @Post('preview')
  @HttpCode(204)
  @Doc('Personel önizleme anahtarını doğrula', { body: PreviewBody, description: 'Web sunucusu çağırır: geçerliyse 204, değilse 403 `preview_invalid`.', errors: [400, 403, 429] })
  async check(@Body() body: unknown, @Req() req: AppRequest) {
    const { token } = parse(PreviewBody, body);
    await this.limiter.hit(LIMITS.sitePreview, req.clientIp);
    if (!(await this.preview.verify(token))) throw new AppError(403, 'preview_invalid', 'Önizleme bağlantısı geçersiz ya da yenilenmiş.');
  }
}

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/site-preview')
@UseGuards(AdminGuard)
export class AdminSitePreviewController {
  constructor(private preview: SitePreviewService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Önizleme bağlantısı var mı, kim ne zaman oluşturdu', { errors: [401, 403] })
  info() {
    return this.preview.info();
  }

  @MinRole('ADMIN')
  @Post()
  @HttpCode(200)
  @Doc('Yeni önizleme bağlantısı (eskisi hemen geçersiz olur; bağlantı yalnız bu yanıtta görünür)', { body: ReasonBody, errors: [400, 401, 403] })
  async rotate(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const { reason } = parse(ReasonBody, body);
    const out = await this.preview.rotate(auth.userId);
    await this.audit.record(auth.userId, 'site_preview.rotate', 'settings', 'site.preview', { reason }, req.clientIp);
    return out;
  }

  @MinRole('ADMIN')
  @Post('revoke')
  @HttpCode(200)
  @Doc('Önizleme bağlantısını iptal et', { body: ReasonBody, errors: [400, 401, 403, 404] })
  async revoke(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const { reason } = parse(ReasonBody, body);
    if (!(await this.preview.revoke())) throw new AppError(404, 'not_found', 'İptal edilecek bağlantı yok.');
    await this.audit.record(auth.userId, 'site_preview.revoke', 'settings', 'site.preview', { reason }, req.clientIp);
    return this.preview.info();
  }
}

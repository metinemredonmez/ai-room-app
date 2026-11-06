import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError, notFound, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { isUuid } from '../images/images.service.js';
import { AlertSettingsSchema } from './alerts.rules.js';
import { AlertsService } from './alerts.service.js';

// API.md §7.41: founder alerts and our own error list. SUPPORT reads; ADMIN changes the settings, sends a test mail and
// marks errors resolved — all audited (LOG-01).

const SaveBody = z.object({ settings: z.unknown(), reason: z.string().trim().min(3).max(200), version: z.string().max(40).nullable() }).strict();

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/alerts')
@UseGuards(AdminGuard)
export class AdminAlertsController {
  constructor(private alerts: AlertsService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Uyarı ayarları, alıcılar, hata grupları ve son gönderilen uyarılar', { errors: [401, 403] })
  get() {
    return this.alerts.forAdmin();
  }

  @MinRole('ADMIN')
  @Patch()
  @Doc('Uyarı ayarlarını kaydet (gerekçe zorunlu, denetlenir)', { body: z.object({ settings: AlertSettingsSchema, reason: z.string().min(3).max(200), version: z.string().nullable() }), errors: [400, 401, 403, 409] })
  async save(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(SaveBody, body);
    const r = AlertSettingsSchema.safeParse(input.settings);
    if (!r.success) throw new AppError(400, 'validation_failed', 'Ayarlar geçersiz: en çok 5 ek e-posta, tekrar aralığı 15–1440 dk, disk eşiği %50–99.');
    const { changes } = await this.alerts.save(r.data, input.version, auth.userId);
    await this.audit.record(auth.userId, 'alerts.update', 'settings', 'alerts', { reason: input.reason, changes }, req.clientIp);
    return this.alerts.forAdmin();
  }

  @MinRole('ADMIN')
  @Post('test')
  @HttpCode(200)
  @Doc('Deneme uyarısı gönder (alıcılara)', { errors: [401, 403] })
  async test(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    const out = await this.alerts.send('test', `test:${Date.now()}`, 0, {
      subject: 'Deneme uyarısı',
      heading: 'Uyarılar çalışıyor',
      lines: ['Bu bir deneme. Hata, satın alma, disk ve bütçe uyarıları bu adrese gelecek.'],
      path: '/alerts',
    });
    await this.audit.record(auth.userId, 'alerts.test', 'settings', 'alerts', { sent: out.sent }, req.clientIp);
    return out;
  }

  @MinRole('ADMIN')
  @Post('errors/:id/resolve')
  @HttpCode(200)
  @Doc('Hatayı çözüldü say (yeniden görülürse yine uyarı gelir)', { errors: [401, 403, 404] })
  async resolve(@Param('id') id: string, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    if (!isUuid(id)) throw notFound();
    await this.alerts.resolve(id);
    await this.audit.record(auth.userId, 'alerts.error_resolved', 'error_group', id, {}, req.clientIp);
    return { ok: true };
  }
}

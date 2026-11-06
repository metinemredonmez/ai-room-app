import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { LoyaltySettingsSchema } from './loyalty.rules.js';
import { LoyaltyService } from './loyalty.service.js';

// API.md §7.35. SUPPORT reads the rules and their results; ADMIN changes them and can run the daily gifts now. Every
// change and run is audited (LOG-01).

const SaveBody = z.object({ settings: z.unknown(), reason: z.string().trim().min(3).max(200), version: z.string().max(40).nullable() }).strict();
const RunBody = z.object({ reason: z.string().trim().min(3).max(200) }).strict();

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/loyalty')
@UseGuards(AdminGuard)
export class AdminLoyaltyController {
  constructor(private loyalty: LoyaltyService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Sadakat kuralları, son 30 gün sonuçları ve bugün kimin alacağı', { errors: [401, 403] })
  get() {
    return this.loyalty.forAdmin();
  }

  @MinRole('ADMIN')
  @Patch()
  @Doc('Sadakat kurallarını kaydet (hepsi birlikte; gerekçe zorunlu, denetlenir)', { body: z.object({ settings: LoyaltySettingsSchema, reason: z.string().min(3).max(200), version: z.string().nullable() }), errors: [400, 401, 403, 409] })
  async save(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(SaveBody, body);
    const r = LoyaltySettingsSchema.safeParse(input.settings);
    if (!r.success) {
      throw new AppError(400, 'validation_failed', 'Kurallar geçersiz: seri 3–60 gün / 1–20 kredi; yıldönümü 1–50 kredi; geri dönüş 7–365 gün, 1–20 kredi, bekleme 30–365 gün, günde en çok 1–2000 kişi; mesaj en çok 140 karakter.');
    }
    const { changes } = await this.loyalty.save(r.data, input.version, auth.userId);
    await this.audit.record(auth.userId, 'loyalty.update', 'settings', 'loyalty.rules', { reason: input.reason, changes }, req.clientIp);
    return this.loyalty.forAdmin();
  }

  @MinRole('ADMIN')
  @Post('run')
  @HttpCode(200)
  @Doc('Yıldönümü ve geri dönüş hediyelerini şimdi ver (günlük işle aynı; kimse iki kez almaz)', { body: RunBody, errors: [400, 401, 403] })
  async run(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const { reason } = parse(RunBody, body);
    const out = await this.loyalty.runDaily();
    await this.audit.record(auth.userId, 'loyalty.run', 'settings', 'loyalty.rules', { reason, ...out }, req.clientIp);
    return out;
  }
}

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
import { ReferralSettingsSchema } from './referral.rules.js';
import { ReferralService } from './referral.service.js';

// API.md §7.30. Users see their code and enter a friend's (budgeted per account and IP, RES-01); staff tune the
// programme (ADMIN) and stop a suspicious reward (ADMIN), everyone on staff can look (SUPPORT); all audited (LOG-01).

const ClaimBody = z.object({ code: z.string().max(40) }).strict();

@ApiTags('user')
@ApiBearerAuth('user')
@Controller('v1/me/referral')
@UseGuards(UserGuard)
export class ReferralController {
  constructor(private referral: ReferralService, private limiter: RateLimiter) {}

  @Get()
  @Doc('Davet kodum, bağlantım, ödüller ve durumum', { description: 'Program kapalıysa `enabled: false`, kod ve bağlantı null. Kod, doğrulanmış hesaba ilk istekte üretilir.', errors: [401] })
  mine(@Auth() auth: AuthContext) {
    return this.referral.mine(auth.userId);
  }

  @Post('claim')
  @HttpCode(200)
  @Doc('Arkadaşımın davet kodunu gir', {
    body: ClaimBody,
    description: 'Doğrulanmış, kayıttan sonraki `claimDays` gün içindeki hesap; kişi başı bir kez (e-posta kimliğiyle). Davet edilen hemen kredi alır, davet eden arkadaşın ilk tasarımında.',
    errors: [400, 401, 403, 404, 409, 429],
  })
  async claim(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const { code } = parse(ClaimBody, body);
    await this.limiter.hit(LIMITS.promoUser, auth.userId);
    await this.limiter.hit(LIMITS.promoIp, req.clientIp);
    return this.referral.claim(auth.userId, code);
  }
}

const SaveBody = z.object({ settings: z.unknown(), reason: z.string().trim().min(3).max(200), version: z.string().max(40).nullable() }).strict();
const RejectBody = z.object({ reason: z.string().trim().min(3).max(200) }).strict();
const ListQuery = z.object({ status: z.enum(['PENDING', 'REWARDED', 'REJECTED']).optional() });

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/referrals')
@UseGuards(AdminGuard)
export class AdminReferralController {
  constructor(private referral: ReferralService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Davet programı: ayarlar, son 30 gün, en çok davet edenler, son 100 davet', { errors: [401, 403] })
  get(@Query() query: unknown) {
    return this.referral.forAdmin(parse(ListQuery, query).status);
  }

  @MinRole('ADMIN')
  @Patch('settings')
  @Doc('Programı aç/kapat, ödülleri ve sınırları değiştir (gerekçe zorunlu)', {
    body: z.object({ settings: ReferralSettingsSchema, reason: z.string().min(3).max(200), version: z.string().nullable() }),
    errors: [400, 401, 403, 409],
  })
  async save(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(SaveBody, body);
    const s = ReferralSettingsSchema.safeParse(input.settings);
    if (!s.success) throw new AppError(400, 'validation_failed', 'Ayarlar geçersiz: ödüller 0–50, aylık sınır 1–100, süre 1–60 gün.');
    const { previous } = await this.referral.saveSettings(s.data, input.version, auth.userId);
    await this.audit.record(auth.userId, 'referral.settings', 'settings', 'referral', { reason: input.reason, previous, next: s.data }, req.clientIp);
    return this.referral.forAdmin();
  }

  @MinRole('ADMIN')
  @Post(':id/reject')
  @HttpCode(200)
  @Doc('Bekleyen daveti reddet: davet eden ödül almaz (davet edilenin kredisi kalır)', { body: RejectBody, errors: [400, 401, 403, 404, 409] })
  async reject(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const { reason } = parse(RejectBody, body);
    await this.referral.reject(id, reason);
    await this.audit.record(auth.userId, 'referral.reject', 'referral', id, { reason }, req.clientIp);
    return this.referral.forAdmin();
  }
}

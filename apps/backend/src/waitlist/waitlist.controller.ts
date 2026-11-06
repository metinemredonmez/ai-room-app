import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { atLeast, MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { SignupSchema, WaitlistSettingsSchema } from './waitlist.rules.js';
import { WaitlistService } from './waitlist.service.js';

// API.md §7.47. Public: the form's status, signup (double opt-in), confirmation and the signed leave link.
// Admin: SUPPORT sees the list with masked addresses, ADMIN sees addresses, switches the form and removes entries.

const ConfirmBody = z.object({ token: z.string().min(20).max(100) }).strict();
const LeaveBody = z.object({ i: z.string().max(64), t: z.string().max(64) }).strict();

@ApiTags('public')
@Controller('v1/waitlist')
export class WaitlistController {
  constructor(private waitlist: WaitlistService, private limiter: RateLimiter) {}

  @Get('status')
  @Header('Cache-Control', 'public, max-age=60')
  @Doc('Bekleme listesi formu açık mı; mağaza bağlantıları (uygulamalar çıkınca)', { description: '`{ enabled, stores: { ios, android } }`; mağaza bağlantısı yoksa null.' })
  status() {
    return this.waitlist.status;
  }

  @Post()
  @HttpCode(202)
  @Doc('Bekleme listesine ve bültene katıl (çift onay)', {
    body: SignupSchema,
    description: 'Yanıt adresin durumundan bağımsız hep aynıdır; onay e-postası yalnız onaylanmamış adrese gider. `consent: true` zorunlu (ticari ileti onayı).',
    errors: [400, 403, 429],
  })
  signup(@Body() body: unknown, @Req() req: AppRequest) {
    return this.waitlist.signup(parse(SignupSchema, body), req.clientIp);
  }

  @Post('confirm')
  @HttpCode(200)
  @Doc('E-postadaki bağlantıyla kaydı onayla', { body: ConfirmBody, description: 'Bağlantı 7 gün geçerli, tek kullanımlık. Yanıtta listeden çıkış bağlantısının değerleri (`leave`) vardır.', errors: [400, 429] })
  async confirm(@Body() body: unknown, @Req() req: AppRequest) {
    const { token } = parse(ConfirmBody, body);
    await this.limiter.hit(LIMITS.tokenIp, req.clientIp);
    return this.waitlist.confirm(token);
  }

  @Post('leave')
  @HttpCode(200)
  @Doc('Listeden çık (imzalı bağlantı)', { body: LeaveBody, errors: [400, 429] })
  async leave(@Body() body: unknown, @Req() req: AppRequest) {
    const { i, t } = parse(LeaveBody, body);
    await this.limiter.hit(LIMITS.unsubscribe, req.clientIp);
    return this.waitlist.leave(i, t);
  }

  @Post('leave/one-click')
  @HttpCode(200)
  @Doc('Tek tıkla listeden çık (RFC 8058)', { description: 'E-posta sağlayıcısı List-Unsubscribe-Post ile çağırır; `i` ve `t` sorgu parametresidir.', errors: [400, 429] })
  async leaveOneClick(@Query() query: unknown, @Req() req: AppRequest) {
    const { i, t } = parse(LeaveBody, query);
    await this.limiter.hit(LIMITS.unsubscribe, req.clientIp);
    return this.waitlist.leave(i, t);
  }
}

const ListQuery = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['PENDING', 'CONFIRMED', 'UNSUBSCRIBED']).optional(),
  q: z.string().trim().max(100).optional(),
});
const SettingsBody = z.object({ settings: WaitlistSettingsSchema, reason: z.string().trim().min(3).max(200), version: z.string().max(40).nullable() }).strict();
const ReasonBody = z.object({ reason: z.string().trim().min(3).max(200) }).strict();

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/waitlist')
@UseGuards(AdminGuard)
export class AdminWaitlistController {
  constructor(private waitlist: WaitlistService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Bekleme listesi (sayfalı; adresler ADMIN altında maskeli)', { errors: [401, 403] })
  list(@Query() query: unknown, @Auth() auth: AuthContext) {
    return this.waitlist.list(parse(ListQuery, query), atLeast(auth.role, 'ADMIN'));
  }

  @MinRole('SUPPORT')
  @Get('overview')
  @Doc('Bekleme listesi özeti: durumlar, dil ve platform dağılımı, son 30 gün, ayar', { errors: [401, 403] })
  overview() {
    return this.waitlist.overview();
  }

  @MinRole('ADMIN')
  @Patch('settings')
  @Doc('Kayıt formunu aç / kapat (gerekçe zorunlu, denetlenir)', { body: SettingsBody, errors: [400, 401, 403, 409] })
  async settings(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(SettingsBody, body);
    const changes = await this.waitlist.saveSettings(input.settings, input.version, auth.userId);
    if (changes.length) await this.audit.record(auth.userId, 'waitlist.settings', 'settings', 'waitlist', { reason: input.reason, changes }, req.clientIp);
    return this.waitlist.overview();
  }

  @MinRole('ADMIN')
  @Post(':id/delete')
  @HttpCode(200)
  @Doc('Adresi listeden kalıcı sil (ör. KVKK başvurusu; gerekçe zorunlu)', { body: ReasonBody, errors: [400, 401, 403, 404] })
  async remove(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const { reason } = parse(ReasonBody, body);
    const masked = await this.waitlist.remove(id);
    if (!masked) throw new AppError(404, 'not_found', 'Kayıt bulunamadı.');
    await this.audit.record(auth.userId, 'waitlist.delete', 'waitlist', id, { reason, email: masked }, req.clientIp);
    return { ok: true };
  }
}

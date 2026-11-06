import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { LIFECYCLE_RULES, LifecycleSettingsSchema } from './lifecycle.rules.js';
import { LifecycleService } from './lifecycle.service.js';

// API.md §7.48. SUPPORT sees the steps, last 30 days and who is waiting; ADMIN edits them (reason, version, audited)
// and sends a step to their own address to check it.

const SaveBody = z.object({ settings: z.unknown(), reason: z.string().trim().min(3).max(200), version: z.string().max(40).nullable() }).strict();
const TestBody = z.object({ rule: z.enum(LIFECYCLE_RULES), locale: z.enum(['tr', 'en']), settings: z.unknown() }).strict();
const INVALID = 'Ayar geçersiz: konu 1–80, metin 1–2000 karakter (Türkçe ve İngilizce), bağlantı uygulama içi; gün sınırlarına dikkat.';

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/lifecycle')
@UseGuards(AdminGuard)
export class AdminLifecycleController {
  constructor(private lifecycle: LifecycleService, private audit: AuditService, private limiter: RateLimiter) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Yaşam döngüsü e-postaları: adımlar, son 30 gün, şu an bekleyen kişi, günlük e-posta sınırı', { errors: [401, 403] })
  get() {
    return this.lifecycle.overview();
  }

  @MinRole('ADMIN')
  @Patch()
  @Doc('Adımları kaydet (hepsi birlikte; gerekçe zorunlu, denetlenir)', { body: z.object({ settings: LifecycleSettingsSchema, reason: z.string().min(3).max(200), version: z.string().nullable() }), errors: [400, 401, 403, 409] })
  async save(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(SaveBody, body);
    const r = LifecycleSettingsSchema.safeParse(input.settings);
    if (!r.success) throw new AppError(400, 'validation_failed', INVALID);
    const changes = await this.lifecycle.save(r.data, input.version, auth.userId);
    if (changes.length) await this.audit.record(auth.userId, 'lifecycle.update', 'settings', 'lifecycle.emails', { reason: input.reason, changes }, req.clientIp);
    return { ...(await this.lifecycle.overview()), changes };
  }

  @MinRole('ADMIN')
  @Post('test')
  @HttpCode(200)
  @Doc('Bir adımın e-postasını (kaydedilmemiş hâliyle) kendi adresine gönder', { body: TestBody, errors: [400, 401, 403, 429] })
  async test(@Body() body: unknown, @Auth() auth: AuthContext) {
    const input = parse(TestBody, body);
    const r = LifecycleSettingsSchema.safeParse(input.settings);
    if (!r.success) throw new AppError(400, 'validation_failed', INVALID);
    await this.limiter.hit(LIMITS.broadcastTest, auth.userId);
    return this.lifecycle.test(input.rule, r.data, input.locale, auth.userId);
  }
}

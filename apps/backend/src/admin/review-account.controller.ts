import { Body, Controller, Get, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { AuditService } from './audit.service.js';
import { IssueSchema, ReviewAccountService } from './review-account.service.js';
import { MinRole } from './roles.js';

// API.md §7.40: the store review account. ADMIN issues and closes it; the password is in the response once and never
// stored in the clear, logged or audited (LOG-01 records who, why and for how long).

const Reason = z.object({ reason: z.string().trim().min(3).max(200) }).strict();

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/review-account')
@UseGuards(AdminGuard)
@MinRole('ADMIN')
export class AdminReviewAccountController {
  constructor(private review: ReviewAccountService, private audit: AuditService) {}

  @Get()
  @Doc('Mağaza inceleme hesabının durumu (süre, son giriş, açık oturum)', { errors: [401, 403] })
  status() {
    return this.review.status();
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @Doc('İnceleme hesabını oluştur ya da yeni dönem başlat: yeni parola (yanıtta bir kez), PRO ve kredi, süre 1–30 gün', { body: IssueSchema, status: 201, errors: [400, 401, 403, 409] })
  async issue(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const r = IssueSchema.safeParse(body);
    if (!r.success) throw new AppError(400, 'validation_failed', 'Süre 1–30 gün, kredi 0–200, gerekçe 3–200 karakter.');
    const out = await this.review.issue(r.data).catch((e: Error) => {
      throw e.message.includes('staff') ? new AppError(409, 'conflict', 'Bu adres bir yönetici hesabına ait; inceleme hesabı yapılamaz.') : e;
    });
    await this.audit.record(auth.userId, 'review_account.issue', 'user', out.userId, { reason: r.data.reason, days: r.data.days, credits: r.data.credits, until: out.reviewUntil }, req.clientIp);
    return { email: out.email, password: out.password, reviewUntil: out.reviewUntil };
  }

  @Post('close')
  @HttpCode(200)
  @Doc('İnceleme dönemini şimdi bitir (giriş reddedilir, oturumlar kapanır)', { body: Reason, errors: [400, 401, 403] })
  async close(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const { reason } = parse(Reason, body);
    const out = await this.review.close();
    if (out.closed) await this.audit.record(auth.userId, 'review_account.close', 'user', out.userId ?? null, { reason }, req.clientIp);
    return { closed: out.closed };
  }
}

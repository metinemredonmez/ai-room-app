import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { GiftCampaignService, PreviewSchema, SendSchema } from './campaign.service.js';

// API.md §7.32: group gifts. Previewing and the history are for SUPPORT and up; sending is for ADMIN and up, with a
// reason, and audited (LOG-01).

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/gifts')
@UseGuards(AdminGuard)
export class AdminGiftCampaignController {
  constructor(private campaigns: GiftCampaignService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Toplu hediye geçmişi (son 50)', { errors: [401, 403] })
  history() {
    return this.campaigns.history();
  }

  @MinRole('SUPPORT')
  @Post('preview')
  @HttpCode(200)
  @Doc('Grupta kaç kişi var, kaçında uygulama bildirimi açık', { body: PreviewSchema, errors: [400, 401, 403] })
  preview(@Body() body: unknown) {
    const r = PreviewSchema.safeParse(body);
    if (!r.success) throw new AppError(400, 'validation_failed', 'Grup ve gerekiyorsa gün sayısı (1–365) gerekli.');
    return this.campaigns.preview(r.data.segment, r.data.days);
  }

  @MinRole('ADMIN')
  @Post()
  @Doc('Gruba hediye kredi gönder (push ile)', {
    body: SendSchema,
    status: 201,
    description: 'En çok 20.000 kişi. `expected`: önizlemedeki sayı; grup bundan çok büyüdüyse 409 `count_changed`. Aynı hediye 10 dakika içinde ikinci kez 409 `duplicate_send`.',
    errors: [400, 401, 403, 409],
  })
  async send(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const r = SendSchema.safeParse(body);
    if (!r.success) throw new AppError(400, 'validation_failed', 'Toplu hediye: 1–100 kredi, mesaj en çok 140, gerekçe 3–200 karakter, gün 1–365.');
    const out = await this.campaigns.send(r.data, auth.userId);
    await this.audit.record(auth.userId, 'gift.campaign', 'gift', out.id, { reason: r.data.reason, segment: r.data.segment, days: r.data.days, credits: r.data.credits, recipients: out.recipients }, req.clientIp);
    return out;
  }
}

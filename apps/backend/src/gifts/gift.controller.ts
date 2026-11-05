import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../admin/audit.service.js';
import { MinRole, type AdminRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { GiftSchema, GiftService } from './gift.service.js';

// API.md §7.31: gift credits with a notification. ADMIN and up (it gives value away), with a reason, audited (LOG-01).

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/users')
@UseGuards(AdminGuard)
export class AdminGiftController {
  constructor(private gifts: GiftService, private audit: AuditService) {}

  @MinRole('ADMIN')
  @Post(':id/gift')
  @Doc('Hediye kredi gönder (push bildirimi, isteğe bağlı e-posta)', {
    body: GiftSchema,
    status: 201,
    description: '`message` kullanıcıya gösterilir (en çok 140); `reason` yalnız denetim kaydına yazılır. Kredi hareketlerinde "Hediye" (`kind: gift`).',
    errors: [400, 401, 403, 404, 409],
  })
  async gift(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const r = GiftSchema.safeParse(body);
    if (!r.success) throw new AppError(400, 'validation_failed', 'Hediye: 1–500 kredi, mesaj en çok 140 karakter, gerekçe 3–200 karakter.');
    const out = await this.gifts.give(id, r.data, { id: auth.userId, role: auth.role as AdminRole });
    await this.audit.record(auth.userId, 'user.gift', 'user', id, { credits: r.data.credits, message: r.data.message, email: r.data.email, reason: r.data.reason, pushed: out.pushed, emailed: out.emailed }, req.clientIp);
    return out;
  }
}

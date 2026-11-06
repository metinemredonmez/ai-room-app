import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { CreateScheduleSchema } from './price-schedule.rules.js';
import { PriceScheduleService } from './price-schedule.service.js';

// API.md §7.36. SUPPORT sees what is planned; ADMIN plans and cancels. Every step is audited (LOG-01).

const CancelBody = z.object({ reason: z.string().trim().min(3).max(200) }).strict();

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/price-schedules')
@UseGuards(AdminGuard)
export class AdminPriceScheduleController {
  constructor(private schedules: PriceScheduleService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Planlı fiyat değişiklikleri ve planlanabilecek araç/paketler (bugünkü değerleriyle)', { errors: [401, 403] })
  list() {
    return this.schedules.list();
  }

  @MinRole('ADMIN')
  @Post()
  @Doc('Fiyat değişikliği planla (araç kredisi ya da paket kredisi; başlangıç, isteğe bağlı bitiş)', { body: CreateScheduleSchema, status: 201, errors: [400, 401, 403, 409] })
  async create(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const r = CreateScheduleSchema.safeParse(body);
    if (!r.success) throw new AppError(400, 'validation_failed', 'Plan geçersiz: araç ya da paket, yeni değer (1 ve üstü), başlangıç tarihi ve 3–200 karakter gerekçe gerekli.');
    const s = await this.schedules.create(r.data, auth.userId);
    await this.audit.record(auth.userId, 'price_schedule.create', 'price_schedule', s.id, {
      reason: r.data.reason, kind: s.kind, key: s.targetKey, value: s.value, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt?.toISOString() ?? null,
    }, req.clientIp);
    return { id: s.id };
  }

  @MinRole('ADMIN')
  @Post(':id/cancel')
  @HttpCode(200)
  @Doc('Başlamamışsa iptal et, sürüyorsa şimdi bitir (eski değer, elle değişmediyse geri gelir)', { body: CancelBody, errors: [400, 401, 403, 404, 409] })
  async cancel(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const { reason } = parse(CancelBody, body);
    const out = await this.schedules.cancel(id);
    await this.audit.record(auth.userId, 'price_schedule.cancel', 'price_schedule', id, { reason, result: out.result }, req.clientIp);
    return out;
  }
}

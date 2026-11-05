import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { EngineInputSchema, EngineService } from './engine.service.js';

// Image provider chain and models in the admin (API.md §7.27). ADMIN and up: the choice decides cost and quality
// of every design (AZ-01). Saving needs a reason, uses an optimistic version (BUS-02) and is audited (LOG-01).

const SaveBody = z.object({ engine: z.unknown(), reason: z.string().trim().min(3).max(200), version: z.string().max(40).nullable() }).strict();

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/ai-engine')
@UseGuards(AdminGuard)
@MinRole('ADMIN')
export class AdminEngineController {
  constructor(private engine: EngineService, private audit: AuditService) {}

  @Get()
  @Doc('Görsel üretim zinciri: seçim, sunucunun sağlayıcıları ve izinli modeller, devre kesici durumu', { errors: [401, 403, 502] })
  get() {
    return this.engine.forAdmin();
  }

  @Patch()
  @Doc('Zinciri kaydet (`engine: null` sunucu varsayılanına döner; gerekçe zorunlu, denetlenir)', {
    body: z.object({ engine: EngineInputSchema.nullable(), reason: z.string().min(3).max(200), version: z.string().nullable() }),
    errors: [400, 401, 403, 409, 502],
  })
  async save(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(SaveBody, body);
    let engine = null;
    if (input.engine !== null) {
      const r = EngineInputSchema.safeParse(input.engine);
      if (!r.success) throw new AppError(400, 'validation_failed', 'Zincir geçersiz: 1–4 sağlayıcı ve her biri için en çok bir model.');
      engine = r.data;
    }
    const { previous } = await this.engine.save(engine, input.version, auth.userId);
    await this.audit.record(auth.userId, 'ai.engine_update', 'settings', 'ai.engine', { reason: input.reason, previous, next: engine }, req.clientIp);
    return this.engine.forAdmin();
  }
}

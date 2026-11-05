import { Body, Controller, Get, Header, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { FlagsInputSchema, FeaturesService } from './features.service.js';

// API.md §7.28. Public: the flags clients use to show or hide features. Admin: reading for SUPPORT and up (to answer
// "why can't I…?"), switching for ADMIN and up, with a reason, under a version, audited (LOG-01).

@ApiTags('public')
@Controller('v1')
export class FeaturesController {
  constructor(private features: FeaturesService) {}

  @Get('features')
  @Header('Cache-Control', 'public, max-age=30')
  @Doc('Özellik bayrakları (web ve uygulama gösterip gizler; okunamazsa kapalı say)', { response: 'Features' })
  get() {
    return { features: this.features.current };
  }
}

const SaveBody = z.object({ features: z.unknown(), reason: z.string().trim().min(3).max(200), version: z.string().max(40).nullable() }).strict();

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/features')
@UseGuards(AdminGuard)
export class AdminFeaturesController {
  constructor(private features: FeaturesService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Özellik bayrakları, açıklamalarıyla', { errors: [401, 403] })
  get() {
    return this.features.forAdmin();
  }

  @MinRole('ADMIN')
  @Patch()
  @Doc('Bayrakları kaydet (hepsi birlikte; gerekçe zorunlu, denetlenir)', {
    body: z.object({ features: FlagsInputSchema, reason: z.string().min(3).max(200), version: z.string().nullable() }),
    errors: [400, 401, 403, 409],
  })
  async save(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(SaveBody, body);
    const flags = FlagsInputSchema.safeParse(input.features);
    if (!flags.success) throw new AppError(400, 'validation_failed', 'Bayraklar geçersiz: listedeki her bayrak için açık/kapalı gönderilmeli.');
    const { changes } = await this.features.save(flags.data, input.version, auth.userId);
    await this.audit.record(auth.userId, 'features.update', 'settings', 'features', { reason: input.reason, changes }, req.clientIp);
    return this.features.forAdmin();
  }
}

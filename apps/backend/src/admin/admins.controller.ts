import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AdminGuard, TokensService } from '../auth/tokens.service.js';
import { AppError, notFound, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, PrismaService, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import type { User } from '../generated/prisma/client.js';
import { isUuid } from '../images/images.service.js';
import { UsersService } from '../users/users.service.js';
import { AdminSecurityService } from './admin-security.service.js';
import { AuditService } from './audit.service.js';
import { ADMIN_ROLES, MinRole } from './roles.js';

const StepUp = z.object({ otp: z.string().regex(/^\d{6}$/) }).strict();
const RoleChange = z.object({ role: z.enum(['USER', ...ADMIN_ROLES]), reason: z.string().trim().min(5).max(300) }).strict();
const Reason = z.object({ reason: z.string().trim().min(5).max(300) }).strict();

/** The signed-in admin's own account and second factors (every admin role). */
@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/me')
@UseGuards(AdminGuard)
@MinRole('SUPPORT')
export class AdminSelfController {
  constructor(
    private prisma: PrismaService,
    private users: UsersService,
    private security: AdminSecurityService,
    private audit: AuditService,
    private tokens: TokensService,
    private limiter: RateLimiter,
  ) {}

  @Get()
  @Doc('Oturumdaki yönetici: rol ve MFA durumu (`required: false` yalnız geliştirmede, ADMIN_DEV_SKIP_MFA)', { errors: [401, 403] })
  async me(@Auth() auth: AuthContext) {
    const user = await this.users.get(auth.userId);
    return { ...this.users.toDto(user), mfa: { required: !this.tokens.devSkipMfa, enrolled: !!user.totpSecret, backupCodesRemaining: await this.security.remainingBackupCodes(user.id) } };
  }

  /** AUT-04: adding or replacing a factor needs a fresh TOTP code, not just a live session. */
  @Post('backup-codes')
  @Doc('Yedek kodları yenile (güncel TOTP kodu ister; eski kodlar geçersiz olur)', { body: StepUp, status: 201, response: { type: 'object', properties: { backupCodes: { type: 'array', items: { type: 'string' } } } }, errors: [400, 401, 403, 429] })
  async regenerate(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(StepUp, body);
    // A live session may guess codes here, so attempts are capped per admin (AUT-03).
    await this.limiter.hit(LIMITS.adminStepUp, auth.userId);
    const user = await this.users.get(auth.userId);
    // 403, not 401: a wrong code is a failed step-up, not a dead session — the panel must not sign the admin out.
    if (!(await this.security.claimTotp(user, input.otp))) throw new AppError(403, 'step_up_failed', 'Kod hatalı ya da zaten kullanıldı');
    const backupCodes = await this.security.regenerateBackupCodes(user.id);
    await this.audit.record(user.id, 'admin.backup_codes_regenerated', 'user', user.id, {}, req.clientIp);
    this.security.notify(user, 'Yedek kodların yenilendi', ['AI Room yönetim hesabının yedek kodları yenilendi; eski kodlar artık geçersiz.']);
    return { backupCodes };
  }
}

/** AZ-05: the admin team itself — SUPER_ADMIN only, no self-change, last SUPER_ADMIN protected. */
@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/admins')
@UseGuards(AdminGuard)
@MinRole('SUPER_ADMIN')
export class AdminsController {
  constructor(
    private prisma: PrismaService,
    private users: UsersService,
    private security: AdminSecurityService,
  ) {}

  private async dto(u: User) {
    return {
      ...this.users.toDto(u),
      status: u.status,
      mfa: {
        enrolled: !!u.totpSecret,
        enrollBefore: u.mfaEnrollBefore?.toISOString() ?? null,
        backupCodesRemaining: await this.security.remainingBackupCodes(u.id),
      },
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
    };
  }

  @Get()
  @Doc('Yönetici ekibi: rol, MFA durumu, son görülme', { errors: [401, 403] })
  async list() {
    const rows = await this.prisma.user.findMany({ where: { role: { in: [...ADMIN_ROLES] } }, orderBy: { createdAt: 'asc' } });
    return { items: await Promise.all(rows.map((u) => this.dto(u))) };
  }

  @Patch(':id')
  @Doc('Rol ver / değiştir / kaldır (USER). Gerekçe zorunlu; oturumlar kapanır, kişiye e-posta gider', { body: RoleChange, errors: [400, 401, 403, 404, 409] })
  async setRole(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(RoleChange, body);
    if (!isUuid(id)) throw notFound();
    return this.dto(await this.security.changeRole(auth.userId, id, input.role, input.reason, req.clientIp));
  }

  @Post(':id/mfa-reset')
  @Doc('MFA sıfırla: TOTP + yedek kodlar silinir, 72 saatlik yeniden kayıt penceresi açılır', { body: Reason, status: 201, errors: [400, 401, 403, 404, 409] })
  async resetMfa(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(Reason, body);
    if (!isUuid(id)) throw notFound();
    return this.dto(await this.security.resetMfa(auth.userId, id, input.reason, req.clientIp));
  }
}

import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../admin/audit.service.js';
import { UserGuard } from '../auth/tokens.service.js';
import { parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { InviteTokenSchema, OrgsService } from './orgs.service.js';

/** Firms seen by their members (API.md §7.23 step 2): my firms, and the invitation link. */
@ApiTags('user')
@Controller('v1')
export class OrgsController {
  constructor(private orgs: OrgsService, private limiter: RateLimiter, private audit: AuditService) {}

  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @Get('me/orgs')
  @Doc('Üyesi olduğum firmalar', { description: 'Rol, bu ayki sınır ve kullanım; havuz kredisi yalnız OWNER/ADMIN için.', errors: [401] })
  mine(@Auth() auth: AuthContext) {
    return this.orgs.myOrgs(auth.userId);
  }

  /** Whoever holds the link sees which firm invited which (masked) address; nothing else. */
  @Post('orgs/invites/lookup')
  @HttpCode(200)
  @Doc('Davet bağlantısının bilgisi (firma, rol, maskeli e-posta, durum)', { body: InviteTokenSchema, errors: [400, 404, 429] })
  async lookup(@Body() body: unknown, @Req() req: AppRequest) {
    const { token } = parse(InviteTokenSchema, body);
    await this.limiter.hit(LIMITS.orgInviteLookup, req.clientIp);
    return this.orgs.lookupInvite(token);
  }

  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @Post('orgs/invites/accept')
  @HttpCode(200)
  @Doc('Daveti kabul et', {
    body: InviteTokenSchema,
    description: 'Yalnız davetin gönderildiği, doğrulanmış adresle. Tek kullanımlık; süresi 7 gün.',
    errors: [400, 401, 403, 404, 409, 410, 422, 429],
  })
  async accept(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const { token } = parse(InviteTokenSchema, body);
    await this.limiter.hit(LIMITS.orgInviteAccept, auth.userId);
    const result = await this.orgs.acceptInvite(auth.userId, token);
    if (!result.already) await this.audit.record(auth.userId, 'org.invite_accept', 'organization', result.orgId, { role: result.role }, req.clientIp);
    return result;
  }
}

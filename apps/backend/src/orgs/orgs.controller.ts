import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../admin/audit.service.js';
import { UserGuard } from '../auth/tokens.service.js';
import { parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { InviteTokenSchema, OrgsService, TeamInviteSchema, TeamMemberSchema } from './orgs.service.js';

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

  // ---- step 3: the firm runs its own team (OWNER/ADMIN); every change is audited with the member as actor

  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @Get('orgs/:orgId')
  @Doc('Ekip sayfası', { description: 'OWNER/ADMIN: e-postalar, aylık kullanım, bekleyen davetler, havuz. MEMBER: ekip adları ve kendi hakkı. Üye değilse 404.', errors: [401, 404] })
  team(@Param('orgId') orgId: string, @Auth() auth: AuthContext) {
    return this.orgs.team(orgId, auth.userId);
  }

  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @Post('orgs/:orgId/invites')
  @Doc('Ekibe davet gönder (OWNER: yönetici ya da üye; ADMIN: yalnız üye)', { body: TeamInviteSchema, status: 201, errors: [400, 401, 403, 404, 409, 429] })
  async invite(@Param('orgId') orgId: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(TeamInviteSchema, body);
    await this.limiter.hit(LIMITS.orgInviteSend, auth.userId);
    const invite = await this.orgs.teamInvite(orgId, auth.userId, input);
    await this.audit.record(auth.userId, 'org.team_invite', 'organization', orgId, { inviteId: invite.id, role: input.role }, req.clientIp);
    return this.orgs.team(orgId, auth.userId);
  }

  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @Post('orgs/:orgId/invites/:inviteId/revoke')
  @Doc('Bekleyen daveti geri al (OWNER/ADMIN)', { status: 201, errors: [401, 403, 404] })
  async revoke(@Param('orgId') orgId: string, @Param('inviteId') inviteId: string, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    await this.orgs.teamRevokeInvite(orgId, auth.userId, inviteId);
    await this.audit.record(auth.userId, 'org.team_invite_revoke', 'organization', orgId, { inviteId }, req.clientIp);
    return this.orgs.team(orgId, auth.userId);
  }

  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @Patch('orgs/:orgId/members/:userId')
  @Doc('Üyenin rolü ya da aylık sınırı (OWNER: herkes, sahiplik devri dahil; ADMIN: yalnız üyelerin sınırı)', { body: TeamMemberSchema, errors: [400, 401, 403, 404, 409] })
  async updateMember(@Param('orgId') orgId: string, @Param('userId') userId: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(TeamMemberSchema, body);
    const change = await this.orgs.teamUpdateMember(orgId, auth.userId, userId, input);
    await this.audit.record(auth.userId, change.to.role === 'OWNER' ? 'org.team_owner_transfer' : 'org.team_member_update', 'organization', orgId, { userId, ...change }, req.clientIp);
    return this.orgs.team(orgId, auth.userId);
  }

  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @Post('orgs/:orgId/members/:userId/remove')
  @Doc('Üyeyi çıkar (OWNER: yönetici ya da üye; ADMIN: yalnız üye)', { status: 201, errors: [401, 403, 404, 409] })
  async remove(@Param('orgId') orgId: string, @Param('userId') userId: string, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    await this.orgs.teamRemoveMember(orgId, auth.userId, userId);
    await this.audit.record(auth.userId, 'org.team_member_remove', 'organization', orgId, { userId }, req.clientIp);
    return this.orgs.team(orgId, auth.userId);
  }

  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @Post('orgs/:orgId/leave')
  @HttpCode(204)
  @Doc('Firmadan ayrıl (sahip ayrılamaz, önce devreder)', { status: 204, errors: [401, 404, 409] })
  async leave(@Param('orgId') orgId: string, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    await this.orgs.leave(orgId, auth.userId);
    await this.audit.record(auth.userId, 'org.leave', 'organization', orgId, {}, req.clientIp);
  }
}

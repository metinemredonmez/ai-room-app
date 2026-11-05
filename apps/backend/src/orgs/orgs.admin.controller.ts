import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { AddMemberSchema, AdminInviteSchema, CreateOrgSchema, OrgCreditsSchema, OrgListQuery, OrgsService, ReasonSchema, UpdateMemberSchema, UpdateOrgSchema } from './orgs.service.js';

/** Firms in the admin panel (API.md §7.23). SUPPORT reads; ADMIN changes, always with a reason, always audited. */
@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/orgs')
@UseGuards(AdminGuard)
export class AdminOrgsController {
  constructor(private orgs: OrgsService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Firmalar (ad, sahip e-postası ya da kimlikle arama; sayfalı)', { errors: [400, 401, 403] })
  list(@Query() query: unknown) {
    return this.orgs.list(parse(OrgListQuery, query));
  }

  @MinRole('SUPPORT')
  @Get(':id')
  @Doc('Firma ayrıntısı: üyeler, bu ayki kullanım, kredi hareketleri', { errors: [401, 403, 404] })
  detail(@Param('id') id: string) {
    return this.orgs.detail(id);
  }

  @MinRole('ADMIN')
  @Post()
  @Doc('Firma oluştur (sahip: kayıtlı, doğrulanmış kullanıcı)', { body: CreateOrgSchema, status: 201, errors: [400, 401, 403, 404, 409, 422] })
  async create(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(CreateOrgSchema, body);
    const org = await this.orgs.create(input, auth.userId);
    await this.audit.record(auth.userId, 'org.create', 'organization', org.id, { reason: input.reason, ownerId: org.owner?.userId, credits: input.credits }, req.clientIp);
    return org;
  }

  @MinRole('ADMIN')
  @Patch(':id')
  @Doc('Firma bilgisi, durum (askıya alma) ve üye başı aylık sınır', { body: UpdateOrgSchema, errors: [400, 401, 403, 404] })
  async update(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(UpdateOrgSchema, body);
    const { detail, diff } = await this.orgs.update(id, input);
    await this.audit.record(auth.userId, 'org.update', 'organization', id, { reason: input.reason, diff }, req.clientIp);
    return detail;
  }

  @MinRole('ADMIN')
  @Post(':id/credits')
  @Doc('Firma kredi havuzuna ekle / düş (eksiye inemez)', { body: OrgCreditsSchema, status: 201, errors: [400, 401, 403, 404, 409] })
  async credits(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(OrgCreditsSchema, body);
    const detail = await this.orgs.adjustCredits(id, input.delta, input.reason, auth.userId);
    await this.audit.record(auth.userId, 'org.credits', 'organization', id, { reason: input.reason, delta: input.delta }, req.clientIp);
    return detail;
  }

  @MinRole('ADMIN')
  @Post(':id/members')
  @Doc('Kayıtlı kullanıcıyı firmaya ekle (ADMIN ya da MEMBER rolüyle)', { body: AddMemberSchema, status: 201, errors: [400, 401, 403, 404, 409, 422] })
  async addMember(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(AddMemberSchema, body);
    const { detail, userId } = await this.orgs.addMember(id, input);
    await this.audit.record(auth.userId, 'org.member_add', 'organization', id, { reason: input.reason, userId, role: input.role, monthlyCap: input.monthlyCap }, req.clientIp);
    return detail;
  }

  @MinRole('ADMIN')
  @Patch(':id/members/:userId')
  @Doc('Üyenin rolü ya da aylık sınırı; OWNER vermek sahipliği devreder', { body: UpdateMemberSchema, errors: [400, 401, 403, 404, 409] })
  async updateMember(@Param('id') id: string, @Param('userId') userId: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(UpdateMemberSchema, body);
    const { detail, change } = await this.orgs.updateMember(id, userId, input);
    await this.audit.record(auth.userId, change.to.role === 'OWNER' ? 'org.owner_transfer' : 'org.member_update', 'organization', id, { reason: input.reason, userId, ...change }, req.clientIp);
    return detail;
  }

  @MinRole('ADMIN')
  @Post(':id/members/:userId/remove')
  @Doc('Üyeyi firmadan çıkar (sahip çıkarılamaz)', { body: ReasonSchema, status: 201, errors: [400, 401, 403, 404, 409] })
  async removeMember(@Param('id') id: string, @Param('userId') userId: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(ReasonSchema, body);
    const detail = await this.orgs.removeMember(id, userId);
    await this.audit.record(auth.userId, 'org.member_remove', 'organization', id, { reason: input.reason, userId }, req.clientIp);
    return detail;
  }

  @MinRole('ADMIN')
  @Post(':id/invites')
  @Doc('E-postayla davet gönder (7 gün, tek kullanımlık)', { body: AdminInviteSchema, status: 201, errors: [400, 401, 403, 404, 409] })
  async invite(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(AdminInviteSchema, body);
    const invite = await this.orgs.invite(id, input, auth.userId);
    await this.audit.record(auth.userId, 'org.invite', 'organization', id, { reason: input.reason, inviteId: invite.id, role: input.role }, req.clientIp);
    return this.orgs.detail(id);
  }

  @MinRole('ADMIN')
  @Post(':id/invites/:inviteId/revoke')
  @Doc('Bekleyen daveti geri al', { body: ReasonSchema, status: 201, errors: [400, 401, 403, 404] })
  async revokeInvite(@Param('id') id: string, @Param('inviteId') inviteId: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(ReasonSchema, body);
    await this.orgs.revokeInvite(id, inviteId);
    await this.audit.record(auth.userId, 'org.invite_revoke', 'organization', id, { reason: input.reason, inviteId }, req.clientIp);
    return this.orgs.detail(id);
  }
}

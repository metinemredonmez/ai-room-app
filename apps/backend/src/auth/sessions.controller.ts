import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { notFound, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, PrismaService, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { isUuid } from '../images/images.service.js';
import { SessionsService } from './sessions.service.js';
import { AdminGuard, TokensService, UserGuard } from './tokens.service.js';

// API.md §7.37: the signed-in devices and recent sign-ins — for the person themselves and for support. Closing a
// session ends it at once (SES-04): its refresh family is revoked and its access token is refused on the next request.

@ApiTags('user')
@ApiBearerAuth('user')
@Controller('v1/me')
@UseGuards(UserGuard)
export class SessionsController {
  constructor(private sessions: SessionsService, private tokens: TokensService, private limiter: RateLimiter) {}

  @Get('sessions')
  @Doc('Açık oturumlarım (cihaz, kısaltılmış IP, son etkinlik; `current`: bu cihaz)', { errors: [401] })
  async list(@Auth() auth: AuthContext) {
    return { items: await this.sessions.active(auth.userId, auth.sessionId ?? null) };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @Doc('Bir oturumu kapat (bu cihazınki de olabilir: çıkış gibi)', { status: 204, errors: [401, 404, 429] })
  async revoke(@Auth() auth: AuthContext, @Param('id') id: string) {
    await this.limiter.hit(LIMITS.ip, auth.userId);
    if (!isUuid(id) || !(await this.tokens.revokeSession(auth.userId, id))) throw notFound();
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  @Doc('Bu cihaz dışındaki bütün oturumları kapat', { errors: [400, 401, 429] })
  async revokeOthers(@Auth() auth: AuthContext) {
    await this.limiter.hit(LIMITS.ip, auth.userId);
    // An older token without a session id cannot tell which session is "this one": close everything else is refused.
    if (!auth.sessionId) return { revoked: 0, needsSignIn: true };
    return { revoked: await this.tokens.revokeOthers(auth.userId, auth.sessionId) };
  }

  @Get('logins')
  @Doc('Son 20 giriş denemem (başarılı ve başarısız; bilinmeyen e-postalar tutulmaz)', { errors: [401] })
  async logins(@Auth() auth: AuthContext) {
    return { items: await this.sessions.logins(auth.userId) };
  }
}

const Reason = z.object({ reason: z.string().trim().min(3).max(200) }).strict();

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/users/:id/sessions')
@UseGuards(AdminGuard)
export class AdminSessionsController {
  constructor(private sessions: SessionsService, private tokens: TokensService, private audit: AuditService, private prisma: PrismaService) {}

  private async user(id: string) {
    if (!isUuid(id)) throw notFound();
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!u) throw notFound();
  }

  @MinRole('SUPPORT')
  @Get()
  @Doc('Kullanıcının açık oturumları ve son 50 giriş denemesi', { errors: [401, 403, 404] })
  async list(@Param('id') id: string) {
    await this.user(id);
    const [sessions, logins] = await Promise.all([this.sessions.active(id, null), this.sessions.logins(id, 50)]);
    return { sessions, logins };
  }

  @MinRole('ADMIN')
  @Post(':sid/revoke')
  @HttpCode(200)
  @Doc('Bir oturumu kapat (gerekçe zorunlu, denetlenir)', { body: Reason, errors: [400, 401, 403, 404] })
  async revoke(@Param('id') id: string, @Param('sid') sid: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const { reason } = parse(Reason, body);
    await this.user(id);
    if (!isUuid(sid) || !(await this.tokens.revokeSession(id, sid))) throw notFound();
    await this.audit.record(auth.userId, 'user.session_revoke', 'user', id, { reason, sessionId: sid }, req.clientIp);
    return { ok: true };
  }

  @MinRole('ADMIN')
  @Post('revoke-all')
  @HttpCode(200)
  @Doc('Bütün oturumları kapat (erişim token\'ları da hemen geçersiz; gerekçe zorunlu, denetlenir)', { body: Reason, errors: [400, 401, 403, 404] })
  async revokeAll(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const { reason } = parse(Reason, body);
    await this.user(id);
    await this.tokens.revokeAll(id);
    await this.audit.record(auth.userId, 'user.sessions_revoke_all', 'user', id, { reason }, req.clientIp);
    return { ok: true };
  }
}

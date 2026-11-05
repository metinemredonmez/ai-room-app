import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard, UserGuard } from '../auth/tokens.service.js';
import { parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { FeaturesService } from '../features/features.service.js';
import { CreateTicketSchema, MessageSchema, SupportService } from './support.service.js';

const Id = z.uuid();
const ListQuery = z.object({
  status: z.enum(['OPEN', 'ANSWERED', 'CLOSED']).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Support (API.md §7.19): the signed-in user's own tickets only (AZ-01). */
@ApiTags('user')
@ApiBearerAuth('user')
@Controller('v1/me/support')
@UseGuards(UserGuard)
export class SupportController {
  constructor(private support: SupportService, private limiter: RateLimiter, private features: FeaturesService) {}

  @Get()
  @Doc('Destek taleplerim', { description: 'Son mesaja göre yeniden eskiye, en çok 50. `userUnread`: okunmamış ekip yanıtı.', errors: [401] })
  list(@Auth() auth: AuthContext) {
    return this.support.listMine(auth.userId);
  }

  @Post()
  @Doc('Destek talebi aç', { body: CreateTicketSchema, status: 201, description: 'Hata ekranından açılırken `requestId` gönderilir. Aynı anda en çok 5 açık talep; saatte 5.', errors: [400, 401, 404, 409, 429] })
  async create(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(CreateTicketSchema, body);
    // API.md §7.28: new tickets can be switched off; existing ones stay readable and answerable.
    this.features.assert('support_tickets');
    await this.limiter.hit(LIMITS.supportCreate, auth.userId);
    return this.support.create(auth.userId, input);
  }

  @Get(':id')
  @Doc('Destek talebi ve mesajları', { description: 'Açınca ekip yanıtı okunmuş sayılır.', errors: [400, 401, 404] })
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.support.getMine(auth.userId, parse(Id, id));
  }

  @Post(':id/messages')
  @Doc('Talebe cevap yaz', { body: MessageSchema, status: 201, description: 'Yanıtlanmış ya da kapanmış talep yeniden açılır.', errors: [400, 401, 404, 429] })
  async reply(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown) {
    const ticketId = parse(Id, id);
    const { body: text } = parse(MessageSchema, body);
    await this.limiter.hit(LIMITS.supportMessage, auth.userId);
    return this.support.replyMine(auth.userId, ticketId, text);
  }
}

/** Support inbox for the team: SUPPORT and above read, answer and close. Answers and closes are audited. */
@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/support')
@UseGuards(AdminGuard)
export class AdminSupportController {
  constructor(private support: SupportService, private audit: AuditService) {}

  @Get()
  @MinRole('SUPPORT')
  @Doc('Destek talepleri', { description: '`?status=OPEN|ANSWERED|CLOSED`, `cursor`; `counts` duruma göre toplamlar.', errors: [400, 401, 403] })
  list(@Query() query: unknown) {
    return this.support.adminList(parse(ListQuery, query));
  }

  @Get(':id')
  @MinRole('SUPPORT')
  @Doc('Destek talebi, mesajlar ve kullanıcı özeti', { errors: [400, 401, 403, 404] })
  get(@Param('id') id: string) {
    return this.support.adminGet(parse(Id, id));
  }

  @Post(':id/reply')
  @HttpCode(200)
  @MinRole('SUPPORT')
  @Doc('Yanıtla', { body: MessageSchema, description: 'Talep "yanıtlandı" olur; kullanıcıya e-posta (doğrulanmış adres) ve bildirim gider.', errors: [400, 401, 403, 404] })
  async reply(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const ticketId = parse(Id, id);
    const { body: text } = parse(MessageSchema, body);
    const out = await this.support.adminReply(ticketId, auth.userId, text);
    await this.audit.record(auth.userId, 'support.reply', 'support', ticketId, { reference: out.reference }, req.clientIp);
    return out;
  }

  @Post(':id/close')
  @HttpCode(200)
  @MinRole('SUPPORT')
  @Doc('Kapat', { errors: [400, 401, 403, 404] })
  async close(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    const ticketId = parse(Id, id);
    const out = await this.support.adminClose(ticketId);
    await this.audit.record(auth.userId, 'support.close', 'support', ticketId, { reference: out.reference }, req.clientIp);
    return out;
  }
}

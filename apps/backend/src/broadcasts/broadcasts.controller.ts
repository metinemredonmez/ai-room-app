import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard, UserGuard } from '../auth/tokens.service.js';
import { parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { AudienceSchema, BroadcastInputSchema, ContentSchema, LINKS } from './broadcast.rules.js';
import { BroadcastsService } from './broadcasts.service.js';

const ListQuery = z.object({ cursor: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) });
const EstimateBody = z.object({ audience: AudienceSchema, kind: z.enum(['SERVICE', 'MARKETING']) }).strict();
const ScheduleBody = z.object({ at: z.iso.datetime({ offset: true }) }).strict();
const TestBody = ContentSchema.extend({ email: z.email().max(254) }).strict();

/**
 * Toplu Gönderim (API.md §7.16). Reading needs EDITOR, anything that writes or sends needs ADMIN; every write
 * is audited with the text, kind and audience so a sent message can always be traced back.
 */
@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/broadcasts')
@UseGuards(AdminGuard)
export class AdminBroadcastsController {
  constructor(private broadcasts: BroadcastsService, private audit: AuditService, private limiter: RateLimiter) {}

  @Get()
  @MinRole('EDITOR')
  @Doc('Toplu gönderimler', { description: 'Yeniden eskiye; `cursor` ile sayfalama.', errors: [401, 403] })
  list(@Query() query: unknown) {
    return this.broadcasts.list(parse(ListQuery, query));
  }

  @Get('links')
  @MinRole('EDITOR')
  @Doc('Bildirimde kullanılabilecek uygulama içi bağlantılar', { errors: [401, 403] })
  links() {
    return { items: LINKS };
  }

  @Post('estimate')
  @HttpCode(200)
  @MinRole('EDITOR')
  @Doc('Kitle tahmini', { body: EstimateBody, description: '`withDevice`: cihazı kayıtlı eşleşen kullanıcı; `eligible`: kampanyada pazarlama izni de olanlar.', errors: [400, 401, 403] })
  estimate(@Body() body: unknown) {
    const input = parse(EstimateBody, body);
    return this.broadcasts.estimate(input.audience, input.kind);
  }

  @Post('precheck')
  @HttpCode(200)
  @MinRole('EDITOR')
  @Doc('Metin ön kontrolü (ticari ileti işaretleri)', { body: ContentSchema, description: '`blocked`: "Bilgilendirme" türünde ticari ifade var; tür "Kampanya" olmalı.', errors: [400, 401, 403] })
  precheck(@Body() body: unknown) {
    return this.broadcasts.precheck(parse(ContentSchema, body));
  }

  @Post()
  @MinRole('ADMIN')
  @Doc('Taslak oluştur', { body: BroadcastInputSchema, status: 201, errors: [400, 401, 403, 422] })
  async create(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(BroadcastInputSchema, body);
    const b = await this.broadcasts.create(input, auth.userId);
    await this.audit.record(auth.userId, 'broadcast.create', 'broadcast', b.id, { kind: input.kind, title: input.title, audience: input.audience }, req.clientIp);
    return b;
  }

  @Post('test')
  @HttpCode(200)
  @MinRole('ADMIN')
  @Doc('Kendine test gönder', { body: TestBody, description: 'Metni yalnız verilen e-postadaki uygulama hesabının cihazlarına "[Test]" önekiyle gönderir; rapora yazılmaz.', errors: [400, 401, 403, 404, 422, 429] })
  async test(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: AppRequest) {
    const { email, ...content } = parse(TestBody, body);
    await this.limiter.hit(LIMITS.broadcastTest, auth.userId);
    const out = await this.broadcasts.test(content, email);
    await this.audit.record(auth.userId, 'broadcast.test', 'user', out.userId, { kind: content.kind, title: content.title }, req.clientIp);
    return out;
  }

  @Get(':id')
  @MinRole('EDITOR')
  @Doc('Gönderim raporu', { description: 'Sayaçlar, durum/neden dağılımı ve son 50 alıcı.', errors: [401, 403, 404] })
  detail(@Param('id') id: string) {
    return this.broadcasts.detail(id);
  }

  @Patch(':id')
  @MinRole('ADMIN')
  @Doc('Taslağı / zamanlanmışı düzenle', { body: BroadcastInputSchema, errors: [400, 401, 403, 404, 409, 422] })
  async update(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const input = parse(BroadcastInputSchema, body);
    const b = await this.broadcasts.update(id, input);
    await this.audit.record(auth.userId, 'broadcast.update', 'broadcast', b.id, { kind: input.kind, title: input.title, audience: input.audience }, req.clientIp);
    return b;
  }

  @Post(':id/send')
  @HttpCode(200)
  @MinRole('ADMIN')
  @Doc('Şimdi gönder', { description: 'Kampanya sessiz saatlerdeyse gönderim saatin bitimine zamanlanır.', errors: [401, 403, 404, 409, 422] })
  async send(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    const b = await this.broadcasts.start(id);
    await this.audit.record(auth.userId, 'broadcast.send', 'broadcast', b.id, { kind: b.kind, status: b.status, targets: b.counts.target }, req.clientIp);
    return b;
  }

  @Post(':id/schedule')
  @HttpCode(200)
  @MinRole('ADMIN')
  @Doc('Zamanla', { body: ScheduleBody, errors: [400, 401, 403, 404, 409, 422] })
  async schedule(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: AppRequest) {
    const { at } = parse(ScheduleBody, body);
    const b = await this.broadcasts.schedule(id, new Date(at));
    await this.audit.record(auth.userId, 'broadcast.schedule', 'broadcast', b.id, { at: b.scheduledAt }, req.clientIp);
    return b;
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @MinRole('ADMIN')
  @Doc('İptal et', { description: 'Sürmekte olan gönderim bir sonraki turda durur; gidenler geri alınamaz.', errors: [401, 403, 404, 409] })
  async cancel(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    const b = await this.broadcasts.cancel(id);
    await this.audit.record(auth.userId, 'broadcast.cancel', 'broadcast', b.id, { counts: b.counts }, req.clientIp);
    return b;
  }

  @Delete(':id')
  @HttpCode(204)
  @MinRole('ADMIN')
  @Doc('Sil', { status: 204, description: 'Gönderim sürerken silinemez. Metin ve sayaçlar denetim kaydında kalır.', errors: [401, 403, 404, 409] })
  async remove(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: AppRequest) {
    const b = await this.broadcasts.remove(id);
    await this.audit.record(auth.userId, 'broadcast.delete', 'broadcast', b.id, {
      kind: b.kind, title: b.title, body: b.body, status: b.status,
      counts: { target: b.targetCount, sent: b.sentCount, skipped: b.skippedCount, failed: b.failedCount, opened: b.openedCount },
    }, req.clientIp);
  }
}

@ApiTags('user')
@ApiBearerAuth()
@Controller('v1/broadcasts')
@UseGuards(UserGuard)
export class BroadcastsController {
  constructor(private broadcasts: BroadcastsService, private limiter: RateLimiter) {}

  /** The app calls this when the user taps a broadcast notification (data.type === 'broadcast'). */
  @Post(':id/opened')
  @HttpCode(204)
  @Doc('Toplu bildirim açıldı', { status: 204, description: 'Kullanıcı başına bir kez sayılır; bilinmeyen kimlik sessizce yok sayılır.', errors: [401, 429] })
  async opened(@Auth() auth: AuthContext, @Param('id') id: string) {
    await this.limiter.hit(LIMITS.broadcastOpened, auth.userId);
    await this.broadcasts.opened(id, auth.userId);
  }
}

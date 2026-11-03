import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard, UserGuard } from '../auth/tokens.service.js';
import { notFound, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { isUuid } from '../images/images.service.js';
import { UsersService } from '../users/users.service.js';
import { DATA_REQUEST_CHANNELS, DATA_REQUEST_TYPES, DataRequestsService } from './data-requests.service.js';
import { LEGAL_KINDS, LEGAL_LOCALES, LEGAL_VERSION_RE } from './legal.js';
import { LegalService } from './legal.service.js';

const Kind = z.enum(LEGAL_KINDS);
const Locale = z.enum(LEGAL_LOCALES);
const Version = z.string().regex(LEGAL_VERSION_RE, 'YYYY-MM-DD ya da YYYY-MM-DD.n');
const LegalQuery = z.object({ locale: Locale.default('tr'), version: Version.optional() }).strict();
const Details = z.string().trim().min(10).max(2000);

const CreateRequest = z.object({ type: z.enum(DATA_REQUEST_TYPES), details: Details }).strict();
const ManualRequest = z
  .object({
    type: z.enum(DATA_REQUEST_TYPES),
    channel: z.enum(DATA_REQUEST_CHANNELS).exclude(['app']),
    contactEmail: z.email().max(254).nullable().default(null),
    details: Details,
    receivedAt: z.iso.datetime().transform((v) => new Date(v)),
    userId: z.uuid().nullable().default(null),
  })
  .strict();
const UpdateRequest = z
  .object({ status: z.enum(['IN_PROGRESS', 'COMPLETED', 'REJECTED']), response: z.string().trim().min(10).max(5000).optional() })
  .strict();
const RequestsQuery = z.object({
  status: z.enum(['RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED']).optional(),
  overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const Draft = z
  .object({ kind: Kind, version: Version, locale: Locale, title: z.string().trim().min(3).max(200), body: z.string().trim().min(50).max(100_000), requiresConsent: z.boolean() })
  .strict();
const DraftPatch = z
  .object({ title: z.string().trim().min(3).max(200).optional(), body: z.string().trim().min(50).max(100_000).optional(), requiresConsent: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'en az bir alan');
const Publish = z.object({ kind: Kind, version: Version, reason: z.string().trim().min(5).max(300) }).strict();

/** Public legal texts: the web site and the app render these (Markdown, no HTML). */
@ApiTags('public')
@Controller('v1/legal')
export class LegalController {
  constructor(private legal: LegalService) {}

  @Get()
  @Doc('Yasal metinler: tür başına güncel sürüm ve onay gerektiren son sürüm', { description: '`?locale=tr|en`' })
  index(@Query('locale') locale?: string) {
    return { items: this.legal.index(locale === 'en' ? 'en' : 'tr') };
  }

  @Get(':kind')
  @Doc('Yasal metin (Markdown). Eski bir sürüm `?version=` ile okunabilir; çevirisi yoksa Türkçe döner', { description: '`?locale=tr|en&version=YYYY-MM-DD`', errors: [400, 404] })
  async document(@Param('kind') kind: string, @Query() query: unknown) {
    const k = Kind.safeParse(kind);
    if (!k.success) throw notFound();
    const q = parse(LegalQuery, query);
    return this.legal.document(k.data, q.locale, q.version);
  }
}

/** KVKK m.11 applications from the signed-in user (the session is the identity check). */
@ApiTags('user')
@ApiBearerAuth('user')
@Controller('v1/me/data-requests')
@UseGuards(UserGuard)
export class DataRequestsController {
  constructor(private requests: DataRequestsService, private users: UsersService, private limiter: RateLimiter) {}

  @Get()
  @Doc('KVKK başvurularım: durum, son yanıt tarihi, yanıt', { errors: [401] })
  list(@Auth() auth: AuthContext) {
    return this.requests.listMine(auth.userId);
  }

  @Post()
  @Doc('KVKK m.11 başvurusu yap. En geç 30 gün içinde yanıtlanır; aynı anda en çok 3 açık başvuru', { body: CreateRequest, status: 201, errors: [400, 401, 409, 429] })
  async create(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(CreateRequest, body);
    await this.limiter.hit(LIMITS.dataRequests, auth.userId);
    return this.requests.create(await this.users.get(auth.userId), input.type, input.details);
  }
}

/** Legal text management: drafts by ADMIN; publishing is audited and needs a reason. */
@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/legal')
@UseGuards(AdminGuard)
export class AdminLegalController {
  constructor(private legal: LegalService, private audit: AuditService) {}

  @Get()
  @MinRole('SUPPORT')
  @Doc('Bütün yasal metin sürümleri (taslak + yayında)', { description: '`?kind=`', errors: [401, 403] })
  async list(@Query('kind') kind?: string) {
    const k = kind ? Kind.parse(kind) : undefined;
    const rows = await this.legal.list(k);
    return {
      current: this.legal.index('tr'),
      items: rows.map((r) => ({
        id: r.id, kind: r.kind, version: r.version, locale: r.locale, title: r.title, requiresConsent: r.requiresConsent,
        status: r.publishedAt ? 'published' : 'draft', publishedAt: r.publishedAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  @Get(':id')
  @MinRole('SUPPORT')
  @Doc('Yasal metin (ham, yer tutucular doldurulmadan)', { errors: [401, 403, 404] })
  async get(@Param('id') id: string) {
    if (!isUuid(id)) throw notFound();
    return this.legal.get(id);
  }

  @Post()
  @MinRole('ADMIN')
  @Doc('Yeni sürüm taslağı (dil başına bir satır). Sürüm yayındakinden büyük olmalı', { body: Draft, status: 201, errors: [400, 401, 403, 409] })
  async create(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(Draft, body);
    const row = await this.legal.createDraft(input, auth.userId);
    await this.audit.record(auth.userId, 'legal.draft_create', 'legal', row.id, { kind: row.kind, version: row.version, locale: row.locale }, req.clientIp);
    return row;
  }

  @Patch(':id')
  @MinRole('ADMIN')
  @Doc('Taslağı düzenle (yayınlanmış metin değiştirilemez)', { body: DraftPatch, errors: [400, 401, 403, 404, 409] })
  async update(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(DraftPatch, body);
    if (!isUuid(id)) throw notFound();
    const row = await this.legal.updateDraft(id, input);
    await this.audit.record(auth.userId, 'legal.draft_update', 'legal', id, { fields: Object.keys(input) }, req.clientIp);
    return row;
  }

  @Delete(':id')
  @MinRole('ADMIN')
  @HttpCode(204)
  @Doc('Taslağı sil', { status: 204, errors: [401, 403, 404, 409] })
  async remove(@Param('id') id: string, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    if (!isUuid(id)) throw notFound();
    await this.legal.deleteDraft(id);
    await this.audit.record(auth.userId, 'legal.draft_delete', 'legal', id, {}, req.clientIp);
  }

  @Post('publish')
  @MinRole('ADMIN')
  @Doc('Sürümü yayınla (bütün diller birlikte; Türkçe zorunlu). `requiresConsent` ise kullanıcılardan yeniden onay istenir', { body: Publish, status: 201, errors: [400, 401, 403, 409] })
  async publish(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(Publish, body);
    const rows = await this.legal.publish(input.kind, input.version, auth.userId);
    await this.audit.record(auth.userId, 'legal.publish', 'legal', null, {
      kind: input.kind, version: input.version, locales: rows.map((r) => r.locale), requiresConsent: rows[0]?.requiresConsent ?? null, reason: input.reason,
    }, req.clientIp);
    return { current: this.legal.versionOf(input.kind), items: rows.map((r) => ({ id: r.id, locale: r.locale, publishedAt: r.publishedAt?.toISOString() ?? null })) };
  }
}

/** KVKK m.11 application desk with the 30-day deadline (m.13). */
@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/data-requests')
@UseGuards(AdminGuard)
export class AdminDataRequestsController {
  constructor(private requests: DataRequestsService, private audit: AuditService) {}

  @Get()
  @MinRole('SUPPORT')
  @Doc('KVKK başvuruları (son tarihe göre), açık / 7 gün içinde dolacak / gecikmiş sayıları', { errors: [401, 403] })
  list(@Query() query: unknown) {
    return this.requests.adminList(parse(RequestsQuery, query));
  }

  @Get(':id')
  @MinRole('SUPPORT')
  @Doc('KVKK başvurusu ayrıntısı', { errors: [401, 403, 404] })
  get(@Param('id') id: string) {
    if (!isUuid(id)) throw notFound();
    return this.requests.adminGet(id);
  }

  @Post()
  @MinRole('ADMIN')
  @Doc('E-posta / KEP / yazılı gelen başvuruyu kaydet (süre geldiği günden işler)', { body: ManualRequest, status: 201, errors: [400, 401, 403, 404] })
  async create(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(ManualRequest, body);
    const row = await this.requests.createManual(input);
    await this.audit.record(auth.userId, 'kvkk.request_create', 'data_request', row.id, { reference: row.reference, type: row.type, channel: row.channel }, req.clientIp);
    return row;
  }

  @Patch(':id')
  @MinRole('ADMIN')
  @Doc('Durum değiştir; COMPLETED/REJECTED için yanıt zorunlu (başvuru sahibine e-postayla gider)', { body: UpdateRequest, errors: [400, 401, 403, 404, 409] })
  async update(@Param('id') id: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(UpdateRequest, body);
    if (!isUuid(id)) throw notFound();
    const row = await this.requests.update(id, auth.userId, input);
    await this.audit.record(auth.userId, 'kvkk.request_update', 'data_request', id, { reference: row.reference, status: row.status }, req.clientIp);
    return row;
  }
}

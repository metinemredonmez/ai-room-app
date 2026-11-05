import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { PromptTemplatesService } from './prompts.service.js';

// Image prompt templates in the admin (API.md §7.26). ADMIN and up only: support staff neither read nor change
// prompts (AZ-01). Publishing and rolling back need a note / reason and are audited (LOG-01).

const PreviewBody = z.object({ key: z.string().max(40), text: z.string().max(1500) }).strict();
const PublishBody = z
  .object({ text: z.string().max(1500), note: z.string().trim().min(3).max(200), expected: z.uuid().nullable() })
  .strict();
const ActivateBody = z
  .object({ versionId: z.uuid().nullable(), reason: z.string().trim().min(3).max(200), expected: z.uuid().nullable() })
  .strict();

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/prompts')
@UseGuards(AdminGuard)
@MinRole('ADMIN')
export class AdminPromptsController {
  constructor(private prompts: PromptTemplatesService, private audit: AuditService) {}

  @Get()
  @Doc('İstem şablonları: varsayılan, yayındaki metin ve sürüm geçmişi', { errors: [401, 403, 502] })
  list() {
    return this.prompts.forAdmin();
  }

  @Post('preview')
  @HttpCode(200)
  @Doc('Taslağı doğrula ve örnek değerlerle göster (görsel üretmez, ücret yok)', { body: PreviewBody, errors: [400, 401, 403, 502] })
  preview(@Body() body: unknown) {
    const b = parse(PreviewBody, body);
    return this.prompts.preview(b.key, b.text);
  }

  @Post(':key/publish')
  @HttpCode(200)
  @Doc('Yeni sürümü yayınla (not zorunlu, denetlenir)', {
    body: PublishBody,
    description: '`expected`: ekranda görülen yayındaki sürüm (varsayılansa null); arada değiştiyse 409. Yanıt yayın sonrası liste.',
    errors: [400, 401, 403, 404, 409, 502],
  })
  async publish(@Param('key') key: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const b = parse(PublishBody, body);
    const r = await this.prompts.publish(key, b.text, b.note, b.expected, auth.userId);
    await this.audit.record(auth.userId, 'prompt.publish', 'settings', `ai.prompts.${key}`, { reason: b.note, versionId: r.versionId, previous: r.previous }, req.clientIp);
    return this.prompts.forAdmin();
  }

  @Post(':key/activate')
  @HttpCode(200)
  @Doc('Önceki bir sürüme ya da varsayılana dön (gerekçe zorunlu, denetlenir)', {
    body: ActivateBody,
    description: '`versionId: null` servisteki varsayılana döner.',
    errors: [400, 401, 403, 404, 409, 502],
  })
  async activate(@Param('key') key: string, @Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const b = parse(ActivateBody, body);
    const r = await this.prompts.activate(key, b.versionId, b.expected, auth.userId);
    await this.audit.record(auth.userId, 'prompt.activate', 'settings', `ai.prompts.${key}`, { reason: b.reason, versionId: r.versionId, previous: r.previous }, req.clientIp);
    return this.prompts.forAdmin();
  }
}

import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../admin/audit.service.js';
import { MinRole } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError, parse } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { Doc } from '../common/openapi.js';
import { ProductInputSchema } from './product.rules.js';
import { ProductCatalogService } from './product.service.js';

// Product catalog in the admin (API.md §7.25): tools, rooms, floors and colours. Reading is for SUPPORT and up
// (answering users); saving is for ADMIN and up, with a reason, under an optimistic version, and audited (LOG-01).

const SaveBody = z.object({ catalog: z.unknown(), reason: z.string().trim().min(3).max(200), version: z.string().max(40).nullable() }).strict();
const ISSUE_TEXT: Record<string, string> = {
  duplicate_id: 'aynı kimlik iki kez kullanılamaz',
  one_tool_enabled: 'en az bir araç açık olmalı',
  one_room_enabled: 'oda isteyen araç açıkken en az bir oda açık olmalı',
  one_floor_enabled: 'Yeni Zemin aracı açıkken en az bir zemin açık olmalı',
  prompt_charset: 'istem yalnız İngilizce harf, rakam ve , \' ( ) / & . - içerebilir',
};

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/product')
@UseGuards(AdminGuard)
export class AdminProductController {
  constructor(private product: ProductCatalogService, private audit: AuditService) {}

  @MinRole('SUPPORT')
  @Get()
  @Doc('Ürün kataloğu: araçlar, odalar, zeminler, renkler (düzenleme için)', { errors: [401, 403] })
  get() {
    return this.product.forAdmin();
  }

  @MinRole('ADMIN')
  @Patch()
  @Doc('Ürün kataloğunu kaydet (gerekçe zorunlu, denetlenir)', {
    body: z.object({ catalog: ProductInputSchema, reason: z.string().min(3).max(200), version: z.string().nullable() }),
    description: '`version`: okunan `version` (hiç kaydedilmediyse null); arada değiştiyse 409. Listeden çıkan oda ve zemin eski tasarımlarda adıyla görünmeye devam eder.',
    errors: [400, 401, 403, 409],
  })
  async save(@Body() body: unknown, @Auth() auth: AuthContext, @Req() req: AppRequest) {
    const input = parse(SaveBody, body);
    const catalog = ProductInputSchema.safeParse(input.catalog);
    if (!catalog.success) {
      const issues = catalog.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'katalog'}: ${ISSUE_TEXT[i.message] ?? 'geçersiz değer'}`);
      throw new AppError(400, 'validation_failed', `Katalog kaydedilemedi — ${issues.join('; ')}`, {}, { fields: catalog.error.issues.map((i) => i.path.join('.')) });
    }
    const { changes } = await this.product.save(catalog.data, input.version, auth.userId);
    await this.audit.record(auth.userId, 'product.catalog_update', 'settings', 'product.catalog', { reason: input.reason, changes }, req.clientIp);
    return this.product.forAdmin();
  }
}

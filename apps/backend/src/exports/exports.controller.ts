import { Controller, Get, Header, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuditService } from '../admin/audit.service.js';
import { MinRole, atLeast } from '../admin/roles.js';
import { AdminGuard } from '../auth/tokens.service.js';
import { AppError, notFound } from '../common/errors.js';
import { Auth, Req, type AppRequest, type AuthContext } from '../common/http.js';
import { LIMITS, RateLimiter } from '../common/infra.js';
import { Doc } from '../common/openapi.js';
import { ExportsService, exportRange, isExportKind, SUPER_ADMIN_EXPORTS } from './exports.service.js';

// API.md §7.44: CSV exports for the admin. ADMIN for the business tables; the audit log only for SUPER_ADMIN (AZ-01).
// Every export is audited with its kind, range and row count (LOG-01); never cached.

@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/exports')
@UseGuards(AdminGuard)
export class AdminExportsController {
  constructor(private exports: ExportsService, private audit: AuditService, private limiter: RateLimiter) {}

  @MinRole('ADMIN')
  @Get(':kind')
  @Header('Cache-Control', 'no-store')
  @Doc('CSV dışa aktar: billing-events | subscriptions | ai-costs | partners | audit, waitlist (SUPER_ADMIN). `?from=YYYY-AA-GG&to=YYYY-AA-GG`, en çok 366 gün, 50 000 satır', { produces: 'text/csv', errors: [400, 401, 403, 404, 429] })
  async export(@Param('kind') kind: string, @Query('from') from: string | undefined, @Query('to') to: string | undefined, @Auth() auth: AuthContext, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    if (!isExportKind(kind)) throw notFound();
    if (SUPER_ADMIN_EXPORTS.includes(kind) && !atLeast(auth.role, 'SUPER_ADMIN')) throw new AppError(403, 'forbidden', 'Denetim kaydını ve bekleme listesini yalnız SUPER_ADMIN dışa aktarabilir.');
    await this.limiter.hit(LIMITS.exports, auth.userId);
    const range = exportRange(from, to);
    const out = await this.exports.build(kind, range);
    await this.audit.record(auth.userId, 'export.csv', 'export', kind, { from: range.gte.toISOString(), to: range.lt.toISOString(), rows: out.rows, truncated: out.truncated }, req.clientIp);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="casalume-${kind}.csv"`);
    if (out.truncated) res.setHeader('X-Export-Truncated', 'true');
    return out.csv;
  }
}

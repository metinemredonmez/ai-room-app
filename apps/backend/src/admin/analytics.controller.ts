import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AdminGuard } from '../auth/tokens.service.js';
import { parse } from '../common/errors.js';
import { Doc } from '../common/openapi.js';
import { BILLING_ENVS } from './analytics.rules.js';
import { AnalyticsService } from './analytics.service.js';
import { MinRole } from './roles.js';

const RevenueQuery = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
  env: z.enum(BILLING_ENVS).default('PRODUCTION'),
});
const EngagementQuery = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) });
const CohortQuery = z.object({
  weeks: z.coerce.number().int().min(4).max(12).default(8),
  segment: z.enum(['all', 'registered']).default('all'),
});

/** Analytics (API.md §7.20): read-only counts. Revenue is for ADMIN and up; usage numbers for SUPPORT and up. */
@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('v1/admin/analytics')
@UseGuards(AdminGuard)
export class AdminAnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @MinRole('ADMIN')
  @Get('revenue')
  @Doc('Gelir: brüt, iade, net, MRR, ürün ve mağazaya göre', {
    description: '`days` 7–365 (30), `env` PRODUCTION | SANDBOX. Tutarlar USD (RevenueCat `price`); günler İstanbul saatine göre.',
    errors: [400, 401, 403],
  })
  revenue(@Query() query: unknown) {
    const q = parse(RevenueQuery, query);
    return this.analytics.revenue(q.days, q.env);
  }

  @MinRole('SUPPORT')
  @Get('engagement')
  @Doc('Etkileşim: aktif kullanıcı, huni, özellik erişimi', {
    description: '`days` 7–90 (30). Aktif: o gün tasarım üreten ya da AI özelliği (sohbet, analiz, seçim, referans) kullanan kullanıcı.',
    errors: [400, 401, 403],
  })
  engagement(@Query() query: unknown) {
    return this.analytics.engagement(parse(EngagementQuery, query).days);
  }

  @MinRole('SUPPORT')
  @Get('cohorts')
  @Doc('Haftalık kohort tutma tablosu', {
    description: '`weeks` 4–12 (8), `segment` all | registered. Hafta pazartesi başlar (İstanbul).',
    errors: [400, 401, 403],
  })
  cohorts(@Query() query: unknown) {
    const q = parse(CohortQuery, query);
    return this.analytics.cohorts(q.weeks, q.segment);
  }
}

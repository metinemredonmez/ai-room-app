import { Injectable } from '@nestjs/common';
import { todayInIstanbul } from '../common/http.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { Prisma } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';

/** Shape the AI service reports with every call (docs/API.md §7.2). */
export interface AiUsageReport {
  provider: string;
  model: string;
  kind: 'generate' | 'analyze' | 'chat' | 'describe' | 'segment' | 'marketing';
  images?: number;
  input_tokens?: number;
  output_tokens?: number;
  latency_ms?: number;
  cost_usd?: number;
  fallback_used?: boolean;
}

export type BudgetState = 'normal' | 'warning' | 'exceeded';

const SPEND_CACHE_MS = 15_000;
const istanbulMidnight = () => new Date(`${todayInIstanbul()}T00:00:00+03:00`);

/** Cost ledger + daily budget brake (patterns from fal-app ai-cost-logger/butce-freni and yoga usageLog). */
@Injectable()
export class UsageService {
  private spend: { at: number; day: string; usd: number } | null = null;

  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  async record(usage: AiUsageReport | undefined | null, ctx: { userId?: string; designId?: string } = {}) {
    if (!usage) return;
    const cost = Math.max(0, Number(usage.cost_usd ?? 0)) || 0;
    try {
      await this.prisma.aiUsage.create({
        data: {
          kind: usage.kind,
          provider: String(usage.provider).slice(0, 40),
          model: String(usage.model).slice(0, 80),
          images: Math.max(0, Math.trunc(usage.images ?? 0)),
          inputTokens: Math.max(0, Math.trunc(usage.input_tokens ?? 0)),
          outputTokens: Math.max(0, Math.trunc(usage.output_tokens ?? 0)),
          latencyMs: Math.max(0, Math.trunc(usage.latency_ms ?? 0)),
          costUsd: new Prisma.Decimal(cost.toFixed(6)),
          fallbackUsed: Boolean(usage.fallback_used),
          userId: ctx.userId ?? null,
          designId: ctx.designId ?? null,
        },
      });
      if (this.spend && this.spend.day === todayInIstanbul()) this.spend.usd += cost;
    } catch (e) {
      log.warn('usage_record_failed', { error: (e as Error).name });
    }
  }

  async spentTodayUsd(): Promise<number> {
    const day = todayInIstanbul();
    if (this.spend && this.spend.day === day && Date.now() - this.spend.at < SPEND_CACHE_MS) return this.spend.usd;
    const agg = await this.prisma.aiUsage.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: istanbulMidnight() } } });
    const usd = Number(agg._sum.costUsd ?? 0);
    this.spend = { at: Date.now(), day, usd };
    return usd;
  }

  async budget() {
    const { dailyBudgetUsd, budgetBrakeMode } = this.settings.current;
    const spentTodayUsd = await this.spentTodayUsd();
    let state: BudgetState = 'normal';
    if (dailyBudgetUsd > 0) {
      const ratio = spentTodayUsd / dailyBudgetUsd;
      state = ratio >= 1 ? 'exceeded' : ratio >= 0.8 ? 'warning' : 'normal';
    }
    return { dailyBudgetUsd, spentTodayUsd: Number(spentTodayUsd.toFixed(4)), state, brakeMode: budgetBrakeMode };
  }

  async stats(days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const midnight = istanbulMidnight();
    const [today, daily, byProvider, byKind, budget] = await Promise.all([
      this.prisma.aiUsage.aggregate({ _sum: { costUsd: true, images: true }, _count: { _all: true }, where: { createdAt: { gte: midnight } } }),
      this.prisma.$queryRaw<Array<{ date: string; cost: Prisma.Decimal | null; calls: bigint }>>`
        SELECT to_char(gs, 'YYYY-MM-DD') AS date,
          (SELECT sum(u."costUsd") FROM "AiUsage" u WHERE to_char((u."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD') = to_char(gs, 'YYYY-MM-DD')) AS cost,
          (SELECT count(*) FROM "AiUsage" u WHERE to_char((u."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD') = to_char(gs, 'YYYY-MM-DD')) AS calls
        FROM generate_series((now() AT TIME ZONE 'Europe/Istanbul')::date - ${days - 1}::int,
                             (now() AT TIME ZONE 'Europe/Istanbul')::date, interval '1 day') gs
        ORDER BY 1`,
      this.prisma.aiUsage.groupBy({ by: ['provider', 'model'], _count: { _all: true }, _sum: { costUsd: true }, where: { createdAt: { gte: since } } }),
      this.prisma.aiUsage.groupBy({ by: ['kind'], _count: { _all: true }, _sum: { costUsd: true }, where: { createdAt: { gte: since } } }),
      this.budget(),
    ]);
    const usd = (d: Prisma.Decimal | null | undefined) => Number(Number(d ?? 0).toFixed(4));
    return {
      today: { costUsd: usd(today._sum.costUsd), calls: today._count._all, images: today._sum.images ?? 0 },
      budget,
      daily: daily.map((d) => ({ date: d.date, costUsd: usd(d.cost), calls: Number(d.calls) })),
      byProvider: byProvider
        .map((p) => ({ provider: p.provider, model: p.model, calls: p._count._all, costUsd: usd(p._sum.costUsd) }))
        .sort((a, b) => b.costUsd - a.costUsd),
      byKind: byKind.map((k) => ({ kind: k.kind, calls: k._count._all, costUsd: usd(k._sum.costUsd) })),
    };
  }
}

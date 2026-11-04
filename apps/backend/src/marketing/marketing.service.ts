import { Injectable } from '@nestjs/common';
import { AiClient, AiError } from '../ai/ai.client.js';
import { LOCALES, isLocale, type Locale } from '../catalog/catalog.data.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { AppError, parse } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { Prisma, type MarketingDraft } from '../generated/prisma/client.js';
import { QueuesService } from '../jobs/queues.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { UsageService } from '../usage/usage.service.js';
import { AsoListingSchema, buildFacts, playListings, storeConfig, violationsOf, type AsoListing, type AsoRun } from './marketing.rules.js';

const notFound = () => new AppError(404, 'not_found', 'Taslak bulunamadı');

/**
 * Admin "Pazarlama" (API.md §7.18). AI writes drafts in the background (one job per language); the owner edits and
 * approves them. Nothing is published from here (AI-02): the export is a file the owner uploads to the stores.
 */
@Injectable()
export class MarketingService {
  constructor(
    private prisma: PrismaService,
    private queues: QueuesService,
    private ai: AiClient,
    private usage: UsageService,
    private catalog: CatalogService,
    private settings: SettingsService,
  ) {}

  async facts(locale: Locale = 'en') {
    const styles = await this.catalog.styles();
    const s = this.settings.current;
    return buildFacts({ locale, styles, freeDaily: s.freeDailyGenerations, maxVariantsFree: s.maxVariantsFree });
  }

  /** Queues one listing per language. A language already being written can't be started twice. */
  async runAso(input: AsoRun, userId: string) {
    const budget = await this.usage.budget();
    if (budget.state === 'exceeded') {
      throw new AppError(503, 'budget_exceeded', 'Günlük yapay zekâ bütçesi doldu; yarın ya da bütçeyi artırınca tekrar dene');
    }
    const busy = await this.prisma.marketingDraft.findMany({
      where: { kind: 'aso', status: 'PENDING', locale: { in: input.locales } },
      select: { locale: true },
    });
    if (busy.length) {
      throw new AppError(409, 'conflict', `Bu diller zaten yazılıyor: ${[...new Set(busy.map((b) => b.locale))].join(', ')}`);
    }
    const payload = { brief: input.brief || null, whatsNew: input.whatsNew || null };
    const drafts = await this.prisma.$transaction(
      input.locales.map((locale) =>
        this.prisma.marketingDraft.create({ data: { kind: 'aso', locale, input: payload, createdById: userId } }),
      ),
    );
    for (const d of drafts) await this.queues.marketing.add('aso', { draftId: d.id }, { jobId: d.id });
    return { items: drafts.map((d) => this.dto(d)) };
  }

  /** Worker: writes one draft. Retryable AI errors go back to the queue; anything else marks the draft FAILED. */
  async process(draftId: string, finalAttempt: boolean) {
    const draft = await this.prisma.marketingDraft.findUnique({ where: { id: draftId } });
    if (!draft || draft.status !== 'PENDING' || !isLocale(draft.locale)) return { skipped: true };
    const input = draft.input as { brief?: string | null; whatsNew?: string | null };
    try {
      const out = await this.ai.marketingAso({
        locale: draft.locale,
        facts: await this.facts(draft.locale),
        ...(input.brief ? { brief: input.brief } : {}),
        ...(input.whatsNew ? { whats_new: input.whatsNew } : {}),
      });
      await this.usage.record(out.usage);
      await this.prisma.marketingDraft.update({
        where: { id: draftId },
        data: {
          status: 'READY',
          output: out.listing as unknown as Prisma.InputJsonValue,
          violations: violationsOf(out.listing as unknown as Record<string, unknown>),
          costUsd: new Prisma.Decimal(Math.max(0, Number(out.usage?.cost_usd ?? 0)).toFixed(6)),
          error: null,
        },
      });
      return { ok: true };
    } catch (e) {
      const retry = e instanceof AiError && e.retryable && !finalAttempt;
      if (retry) throw e;
      log.warn('marketing_draft_failed', { draftId, error: e instanceof AppError ? e.code : (e as Error).name });
      await this.prisma.marketingDraft.update({
        where: { id: draftId },
        data: { status: 'FAILED', error: e instanceof AppError ? e.code : 'internal' },
      });
      return { failed: true };
    }
  }

  async listAso() {
    const items = await this.prisma.marketingDraft.findMany({
      where: { kind: 'aso', status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { items: items.map((d) => this.dto(d)), locales: LOCALES };
  }

  /** Owner's edit. An approved text that changes needs approving again. */
  async update(id: string, output: unknown) {
    const draft = await this.prisma.marketingDraft.findUnique({ where: { id } });
    if (!draft || draft.kind !== 'aso') throw notFound();
    if (draft.status !== 'READY' && draft.status !== 'APPROVED') {
      throw new AppError(409, 'conflict', 'Yalnız hazır ya da onaylı taslak düzenlenebilir');
    }
    const listing = parse(AsoListingSchema, output);
    const saved = await this.prisma.marketingDraft.update({
      where: { id },
      data: { output: listing, violations: [], status: 'READY', approvedAt: null, approvedById: null },
    });
    return this.dto(saved);
  }

  /** The approved draft becomes the current listing of its language; the previous one is archived. */
  async approve(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.marketingDraft.findUnique({ where: { id } });
      if (!draft) throw notFound();
      if (draft.status !== 'READY') throw new AppError(409, 'conflict', 'Yalnız hazır taslak onaylanabilir');
      if (draft.violations.length) {
        throw new AppError(422, 'over_limit', `Mağaza sınırını aşan alanlar var: ${draft.violations.join(', ')}`);
      }
      await tx.marketingDraft.updateMany({
        where: { kind: draft.kind, locale: draft.locale, status: 'APPROVED' },
        data: { status: 'ARCHIVED' },
      });
      const saved = await tx.marketingDraft.update({
        where: { id },
        data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
      });
      return this.dto(saved);
    });
  }

  async archive(id: string) {
    const draft = await this.prisma.marketingDraft.findUnique({ where: { id } });
    if (!draft) throw notFound();
    if (draft.status === 'PENDING') throw new AppError(409, 'conflict', 'Yazılmakta olan taslak arşivlenemez');
    const saved = await this.prisma.marketingDraft.update({ where: { id }, data: { status: 'ARCHIVED' } });
    return this.dto(saved);
  }

  /** Files for the stores, from the approved listings only. */
  async exportAso() {
    const approved = await this.prisma.marketingDraft.findMany({ where: { kind: 'aso', status: 'APPROVED' } });
    const listings: Partial<Record<Locale, AsoListing>> = {};
    for (const d of approved) {
      const parsed = AsoListingSchema.safeParse(d.output);
      if (isLocale(d.locale) && parsed.success) listings[d.locale] = parsed.data;
    }
    return {
      locales: Object.keys(listings),
      appStore: storeConfig(listings),
      googlePlay: playListings(listings),
    };
  }

  /** Stuck PENDING drafts (the job was lost, e.g. Redis flushed) are failed after an hour; a full run takes ~10 min. */
  async reconcile() {
    const { count } = await this.prisma.marketingDraft.updateMany({
      where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 60 * 60_000) } },
      data: { status: 'FAILED', error: 'timeout' },
    });
    return count;
  }

  private dto(d: MarketingDraft) {
    return {
      id: d.id,
      kind: d.kind,
      locale: d.locale,
      status: d.status,
      input: d.input,
      output: d.output,
      violations: d.violations,
      error: d.error,
      costUsd: Number(d.costUsd),
      createdById: d.createdById,
      approvedById: d.approvedById,
      approvedAt: d.approvedAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  }
}

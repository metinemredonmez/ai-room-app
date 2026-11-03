import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type Config } from '../config.js';
import { AiClient, AiError } from '../ai/ai.client.js';
import { ConsentsService } from '../kvkk/consents.service.js';
import { QueuesService } from '../jobs/queues.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { UsageService } from '../usage/usage.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { FLOORS, ROOMS, TOOLS, TOOL_IDS, type Locale, type ToolId } from '../catalog/catalog.data.js';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService, Semaphore } from '../common/infra.js';
import { log } from '../common/log.js';
import type { Design, Image, Prisma } from '../generated/prisma/client.js';
import { ImagesService, isUuid } from '../images/images.service.js';
import { UsersService, type Charge } from '../users/users.service.js';

const text = (max: number) => z.string().trim().min(1).max(max);

export const CreateDesignSchema = z
  .object({
    tool: z.enum(TOOL_IDS),
    inputImageId: z.uuid(),
    variants: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(2),
    styleId: z.string().regex(/^[a-z_]{2,40}$/).optional(),
    roomId: z.string().refine((v) => v in ROOMS).optional(),
    floorId: z.string().refine((v) => v in FLOORS).optional(),
    colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    colorName: text(40).optional(),
    target: text(120).optional(),
    replacement: text(120).optional(),
    instructions: text(300).optional(),
    removeAll: z.boolean().optional(),
    referenceImageId: z.uuid().optional(),
  })
  .strict();
export type CreateDesign = z.infer<typeof CreateDesignSchema>;

type DesignWithImages = Design & { inputImage: Image; results: Image[] };

const STORES: Array<{ store: string; url: (q: string) => string }> = [
  { store: 'Trendyol', url: (q) => `https://www.trendyol.com/sr?q=${encodeURIComponent(q)}` },
  { store: 'Hepsiburada', url: (q) => `https://www.hepsiburada.com/ara?q=${encodeURIComponent(q)}` },
  { store: 'IKEA', url: (q) => `https://www.ikea.com.tr/arama?k=${encodeURIComponent(q)}` },
];

const round = (n: number) => Math.round(n / 10) * 10;

@Injectable()
export class DesignsService {
  private slots: Semaphore;

  constructor(
    private prisma: PrismaService,
    private images: ImagesService,
    private users: UsersService,
    private catalog: CatalogService,
    private ai: AiClient,
    private settings: SettingsService,
    private usage: UsageService,
    private queues: QueuesService,
    private consents: ConsentsService,
    @Inject(CONFIG) cfg: Config,
  ) {
    this.slots = new Semaphore(cfg.MAX_CONCURRENT_GENERATIONS);
  }

  async toDto(d: DesignWithImages, locale: Locale = 'tr') {
    const styles = await this.catalog.styles(true);
    const style = d.styleId ? styles.find((s) => s.id === d.styleId) : undefined;
    const tool = TOOLS[d.tool as ToolId];
    const room = d.roomId ? ROOMS[d.roomId]?.name[locale] : undefined;
    const head = style ? this.catalog.styleName(style, locale) : (tool?.name[locale] ?? d.tool);
    return {
      id: d.id,
      title: room ? `${head} · ${room}` : head,
      tool: d.tool,
      styleId: d.styleId,
      roomId: d.roomId,
      params: d.params,
      status: d.status,
      error: d.error,
      input: this.images.ref(d.inputImage),
      results: [...d.results].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((r) => this.images.ref(r)),
      favorite: d.favorite,
      featured: d.featured,
      chargeState: d.chargeState,
      region: ((d.params ?? {}) as { region?: unknown }).region ?? null,
      queuedAt: d.queuedAt?.toISOString() ?? null,
      startedAt: d.startedAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    };
  }

  private include = { inputImage: true, results: true } as const;

  /** Validates the request, holds credits and either runs inline (sync) or enqueues (async, 202). */
  async create(userId: string, body: CreateDesign, requestId: string, mode: 'sync' | 'async' = 'sync') {
    const settings = this.settings.current;
    if (settings.maintenance.enabled) throw new AppError(503, 'busy', settings.maintenance.messageTr);
    const user = await this.users.get(userId);
    const pro = this.users.isPro(user);
    const locale: Locale = user.locale === 'en' ? 'en' : 'tr';
    const tool = TOOLS[body.tool];
    if (tool.isPro && !pro) throw new AppError(402, 'pro_required', 'Bu araç PRO üyelere özel');
    if (settings.requireAiConsent && !(await this.consents.hasCurrent(userId, 'ai_processing'))) {
      throw new AppError(403, 'consent_required', 'Yapay zekâ işleme onayı gerekli');
    }

    // Budget brake (fal-app butce-freni / yoga brakeFreeUsers): only FREE users are affected.
    let variants: number = Math.min(body.variants, pro ? settings.maxVariantsPro : settings.maxVariantsFree);
    if (!pro) {
      const budget = await this.usage.budget();
      if (budget.state === 'exceeded' && budget.brakeMode === 'free_paused') {
        throw new AppError(503, 'generation_paused', 'Yoğunluk nedeniyle ücretsiz üretim kısa süreliğine durduruldu');
      }
      if (budget.state === 'exceeded' && budget.brakeMode === 'free_single_variant') variants = 1;
    }

    const style = tool.needs.style || body.styleId ? await this.catalog.style(body.styleId ?? 'modern') : undefined;
    if (style?.isPro && !pro) throw new AppError(402, 'pro_required', 'Bu stil PRO üyelere özel');
    if (body.tool === 'reference' && !body.referenceImageId) {
      throw new AppError(400, 'validation_failed', 'Referans görsel gerekli');
    }
    const input = await this.images.owned(body.inputImageId, userId);
    if (body.referenceImageId) await this.images.owned(body.referenceImageId, userId);

    const params: Record<string, unknown> = {};
    for (const k of ['floorId', 'colorHex', 'colorName', 'target', 'replacement', 'instructions', 'removeAll', 'referenceImageId'] as const) {
      if (body[k] !== undefined) params[k] = body[k];
    }
    params.variants = variants;

    const design = await this.prisma.design.create({
      data: {
        userId, tool: body.tool, styleId: style?.id ?? null, roomId: body.roomId ?? null,
        params: params as Prisma.InputJsonValue, inputImageId: input.id, queuedAt: new Date(),
      },
    });

    let charge: Charge;
    try {
      charge = await this.users.charge(userId, variants, design.id);
    } catch (e) {
      await this.prisma.design.delete({ where: { id: design.id } });
      throw e;
    }
    await this.prisma.design.update({
      where: { id: design.id },
      data: { chargeState: 'HELD', chargeDay: charge.day, freeUsed: charge.fromFree, creditsUsed: charge.fromCredits },
    });

    if (mode === 'async') {
      await this.queues.designs.add('generate', { designId: design.id, requestId }, { jobId: design.id });
      log.info('design_queued', { designId: design.id, userId, tool: body.tool, variants });
      return this.toDto(await this.getOwned(userId, design.id), locale);
    }
    await this.slots.run(() => this.process(design.id, { finalAttempt: true, requestId }));
    return this.toDto(await this.getOwned(userId, design.id), locale);
  }

  /**
   * Runs one generation. Idempotent: anything not PENDING is skipped. A retryable AI failure on a
   * non-final attempt is re-thrown with the design left PENDING so the queue can try again.
   */
  async process(designId: string, opts: { finalAttempt: boolean; requestId?: string }): Promise<void> {
    const d = await this.prisma.design.findUnique({ where: { id: designId }, include: { user: true } });
    if (!d || d.status !== 'PENDING') return;
    await this.prisma.design.update({ where: { id: designId }, data: { startedAt: new Date() } });
    const params = (d.params ?? {}) as Record<string, string | number | boolean | undefined>;
    const style = d.styleId ? (await this.catalog.styles(true)).find((s) => s.id === d.styleId) : undefined;
    const pro = this.users.isPro(d.user);
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    try {
      const out = await this.ai.generate(
        {
          tool: d.tool,
          image_b64: (await this.images.read(d.inputImageId)).toString('base64'),
          variants: Number(params.variants ?? 1),
          style_prompt: style?.prompt,
          room: d.roomId ? ROOMS[d.roomId]?.prompt : undefined,
          floor: str(params.floorId) ? FLOORS[str(params.floorId)!]?.prompt : undefined,
          color_hex: str(params.colorHex),
          color_name: str(params.colorName),
          target: str(params.target),
          replacement: str(params.replacement),
          instructions: str(params.instructions),
          remove_all: params.removeAll === true,
          reference_image_b64: str(params.referenceImageId)
            ? (await this.images.read(str(params.referenceImageId)!)).toString('base64')
            : undefined,
        },
        opts.requestId,
      );
      await this.usage.record(out.usage, { userId: d.userId, designId });
      // Provider output is untrusted too: decode/re-encode every variant before anything is stored.
      const buffers: Buffer[] = [];
      for (const b64 of out.images_b64) {
        let buf: Buffer = (await this.images.normalize(Buffer.from(b64, 'base64'), 'image/jpeg', 2048)).buffer;
        if (!pro) buf = await this.images.watermark(buf);
        buffers.push(buf);
      }
      if (!buffers.length) throw new AiError(422, 'no_change', 'Yapay zekâ görselde değişiklik üretemedi; hakkın iade edildi', false);
      for (const buf of buffers) await this.images.save(buf, { ownerId: d.userId, kind: 'RESULT', designId });
      // Partial result (some variants dropped as no_change/failed): refund the missing units, paid credits first.
      const missing = Math.max(0, Number(params.variants ?? 1) - buffers.length);
      const refundCredits = Math.min(missing, d.creditsUsed);
      const refundFree = Math.min(missing - refundCredits, d.freeUsed);
      if (refundCredits + refundFree > 0 && d.chargeDay && d.chargeState === 'HELD') {
        await this.users.refund(d.userId, { day: d.chargeDay, fromFree: refundFree, fromCredits: refundCredits }, designId);
      }
      await this.prisma.design.update({
        where: { id: designId },
        data: {
          status: 'SUCCEEDED', prompt: out.prompt, provider: out.provider, finishedAt: new Date(),
          ...(out.region ? { params: { ...(d.params as Prisma.JsonObject), region: out.region } } : {}),
          creditsUsed: d.creditsUsed - refundCredits, freeUsed: d.freeUsed - refundFree,
        },
      });
      await this.prisma.design.updateMany({ where: { id: designId, chargeState: 'HELD' }, data: { chargeState: 'CAPTURED' } });
      log.info('design_succeeded', {
        designId, userId: d.userId, tool: d.tool, provider: out.provider, variants: buffers.length, regionLock: out.region?.applied ?? null,
      });
    } catch (e) {
      if (e instanceof AiError && e.usage) await this.usage.record(e.usage, { userId: d.userId, designId });
      const retryable = e instanceof AiError ? e.retryable : false;
      if (retryable && !opts.finalAttempt) {
        log.warn('design_retry', { designId, code: (e as AppError).code });
        throw e;
      }
      await this.fail(designId, e instanceof AppError ? e.code : 'internal');
      throw e;
    }
  }

  /** Marks a design FAILED and releases its held credits exactly once. */
  async fail(designId: string, code: string) {
    await this.prisma.design.updateMany({
      where: { id: designId, status: 'PENDING' },
      data: { status: 'FAILED', error: code, finishedAt: new Date() },
    });
    const d = await this.prisma.design.findUnique({ where: { id: designId } });
    if (!d) return;
    const claimed = await this.prisma.design.updateMany({ where: { id: designId, chargeState: 'HELD' }, data: { chargeState: 'RELEASED' } });
    if (claimed.count === 1 && d.chargeDay) {
      await this.users
        .refund(d.userId, { day: d.chargeDay, fromFree: d.freeUsed, fromCredits: d.creditsUsed }, designId)
        .catch((err: Error) => log.error('refund_failed', { designId, error: err.name }));
    }
    log.warn('design_failed', { designId, userId: d.userId, tool: d.tool, code });
  }

  /** Reconciler: anything PENDING for more than 10 minutes is failed and refunded. */
  async reconcile(): Promise<number> {
    const stale = await this.prisma.design.findMany({
      where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      select: { id: true },
      take: 200,
    });
    for (const s of stale) await this.fail(s.id, 'timeout');
    return stale.length;
  }

  async list(userId: string, opts: { cursor?: string; limit: number; favorite?: boolean }, locale: Locale) {
    const where: Prisma.DesignWhereInput = { userId, ...(opts.favorite ? { favorite: true } : {}) };
    const rows = await this.prisma.design.findMany({
      where,
      include: this.include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      ...cursorArgs(opts.cursor),
    });
    const page = rows.slice(0, opts.limit);
    return {
      items: await Promise.all(page.map((d) => this.toDto(d, locale))),
      nextCursor: rows.length > opts.limit ? page[page.length - 1].id : null,
    };
  }

  async getOwned(userId: string, id: string) {
    if (!isUuid(id)) throw notFound();
    const d = await this.prisma.design.findFirst({ where: { id, userId }, include: this.include });
    if (!d) throw notFound();
    return d;
  }

  async setFavorite(userId: string, id: string, favorite: boolean, locale: Locale) {
    await this.getOwned(userId, id);
    const d = await this.prisma.design.update({ where: { id }, data: { favorite }, include: this.include });
    return this.toDto(d, locale);
  }

  async remove(id: string, userId?: string) {
    const d = userId ? await this.getOwned(userId, id) : await this.prisma.design.findUnique({ where: { id }, include: this.include });
    if (!d) throw notFound();
    await this.prisma.design.delete({ where: { id } });
    await this.images.remove(d.results.map((r) => r.id));
  }

  async analysis(userId: string, designId: string, imageId: string | undefined, locale: Locale, requestId: string) {
    const d = await this.getOwned(userId, designId);
    const target = imageId ? d.results.find((r) => r.id === imageId) : d.results[0];
    if (!target) throw notFound();
    const cached = await this.prisma.analysis.findUnique({ where: { designId_imageId: { designId, imageId: target.id } } });
    if (cached) return this.analysisDto(cached);

    const style = d.styleId ? (await this.catalog.styles(true)).find((s) => s.id === d.styleId) : undefined;
    const out = await this.ai.analyze(
      {
        image_b64: (await this.images.read(target.id)).toString('base64'),
        locale,
        room: d.roomId ? ROOMS[d.roomId]?.prompt : undefined,
        style_name: style ? this.catalog.styleName(style, locale) : undefined,
      },
      requestId,
    );
    await this.usage.record(out.usage, { userId, designId });
    const items = out.items.slice(0, 12).map((i) => {
      const lo = Math.max(0, Math.min(i.price_min_try, i.price_max_try));
      const hi = Math.max(i.price_min_try, i.price_max_try);
      return {
        name: i.name, category: i.category, material: i.material, color: i.color, quantity: i.quantity,
        priceMinTRY: round(lo), priceMaxTRY: round(hi),
        links: STORES.map((s) => ({ store: s.store, url: s.url(i.search_query.slice(0, 80)) })),
      };
    });
    const renovation = out.renovation.slice(0, 8).map((r) => ({
      task: r.task, unit: r.unit, quantity: r.quantity,
      costMinTRY: round(Math.min(r.cost_min_try, r.cost_max_try)), costMaxTRY: round(Math.max(r.cost_min_try, r.cost_max_try)),
    }));
    const furnitureMinTRY = items.reduce((s, i) => s + i.priceMinTRY * i.quantity, 0);
    const furnitureMaxTRY = items.reduce((s, i) => s + i.priceMaxTRY * i.quantity, 0);
    const renovationMinTRY = round(renovation.reduce((s, r) => s + r.costMinTRY * r.quantity, 0));
    const renovationMaxTRY = round(renovation.reduce((s, r) => s + r.costMaxTRY * r.quantity, 0));
    const data = {
      summary: out.summary,
      palette: out.palette.filter((p) => /^#[0-9A-Fa-f]{6}$/.test(p)).slice(0, 6),
      items,
      renovation,
      totals: {
        furnitureMinTRY, furnitureMaxTRY, renovationMinTRY, renovationMaxTRY,
        grandMinTRY: furnitureMinTRY + renovationMinTRY, grandMaxTRY: furnitureMaxTRY + renovationMaxTRY,
      },
      disclaimer: out.disclaimer,
    };
    const saved = await this.prisma.analysis.upsert({
      where: { designId_imageId: { designId, imageId: target.id } },
      create: { designId, imageId: target.id, data },
      update: {},
    });
    return this.analysisDto(saved);
  }

  private analysisDto(a: { id: string; designId: string; imageId: string; data: Prisma.JsonValue; createdAt: Date }) {
    return { id: a.id, designId: a.designId, imageId: a.imageId, ...(a.data as object), createdAt: a.createdAt.toISOString() };
  }
}

/** Keyset pagination: the cursor is the last row's id; Prisma resolves its position. */
export function cursorArgs(cursor?: string): { cursor?: { id: string }; skip?: number } {
  return cursor && isUuid(cursor) ? { cursor: { id: cursor }, skip: 1 } : {};
}

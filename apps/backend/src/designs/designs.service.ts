import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type Config } from '../config.js';
import { AiClient, AiError } from '../ai/ai.client.js';
import { ConsentsService } from '../kvkk/consents.service.js';
import { QueuesService } from '../jobs/queues.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { UsageService } from '../usage/usage.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { TOOL_IDS, isLocale, type Locale } from '../catalog/catalog.data.js';
import { ProductCatalogService } from '../catalog/product.service.js';
import { PromptTemplatesService } from '../prompts/prompts.service.js';
import { EngineService } from '../ai/engine.service.js';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService, Semaphore } from '../common/infra.js';
import { log } from '../common/log.js';
import type { Design, Image, Prisma } from '../generated/prisma/client.js';
import { ImagesService, isUuid, sniffMime } from '../images/images.service.js';
import { UsersService, type Charge } from '../users/users.service.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { ProjectsService } from '../orgs/projects.service.js';

const text = (max: number) => z.string().trim().min(1).max(max);

/** Tap selection (API.md §7.15): 0..1 from the top-left of the input photo, one object per point. */
export const PointsSchema = z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(1).max(8);

export const SelectionSchema = z.object({ points: PointsSchema.optional(), target: text(120).optional() }).strict();
export type Selection = z.infer<typeof SelectionSchema>;

export const CreateDesignSchema = z
  .object({
    tool: z.enum(TOOL_IDS),
    inputImageId: z.uuid(),
    variants: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(2),
    styleId: z.string().regex(/^[a-z_]{2,40}$/).optional(),
    /** Offered rooms and floors come from the admin's product catalog (API.md §7.25), checked when creating. */
    roomId: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
    floorId: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
    colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    colorName: text(40).optional(),
    target: text(120).optional(),
    replacement: text(120).optional(),
    instructions: text(300).optional(),
    removeAll: z.boolean().optional(),
    referenceImageId: z.uuid().optional(),
    points: PointsSchema.optional(),
    /** API.md §7.23: create in this firm's workspace (charged to its pool, PRO features). */
    orgId: z.uuid().optional(),
    /** API.md §7.23 step 4: put it in this firm project (shared with the team); needs `orgId`. */
    projectId: z.uuid().optional(),
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
    private orgs: OrgsService,
    private projects: ProjectsService,
    private product: ProductCatalogService,
    private prompts: PromptTemplatesService,
    private engine: EngineService,
  ) {
    this.slots = new Semaphore(cfg.MAX_CONCURRENT_GENERATIONS);
  }

  /** "Japandi · Oturma odası" — style (or tool) name plus room, in the given locale. */
  async titleOf(d: Pick<Design, 'styleId' | 'tool' | 'roomId'>, locale: Locale = 'tr') {
    const style = d.styleId ? (await this.catalog.styles(true)).find((s) => s.id === d.styleId) : undefined;
    const room = this.product.roomName(d.roomId, locale);
    const head = style ? this.catalog.styleName(style, locale) : this.product.toolName(d.tool, locale);
    return room ? `${head} · ${room}` : head;
  }

  /** `viewerId`: who is looking — a teammate sees a shared project design as not theirs (`mine: false`). */
  async toDto(d: DesignWithImages, locale: Locale = 'tr', viewerId?: string) {
    return {
      id: d.id,
      title: await this.titleOf(d, locale),
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
      orgId: d.orgId,
      projectId: d.projectId,
      mine: viewerId ? d.userId === viewerId : true,
      chargeState: d.chargeState,
      region: ((d.params ?? {}) as { region?: unknown }).region ?? null,
      queuedAt: d.queuedAt?.toISOString() ?? null,
      startedAt: d.startedAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    };
  }

  private include = { inputImage: true, results: true } as const;

  /**
   * KVKK: every path that sends the user's photo (or an image made from it) to an AI provider needs the current
   * AI-processing consent when the setting requires it — generation, selection, analysis and chat with images.
   */
  async assertAiConsent(userId: string) {
    if (this.settings.current.requireAiConsent && !(await this.consents.hasCurrent(userId, 'ai_processing'))) {
      throw new AppError(403, 'consent_required', 'Yapay zekâ işleme onayı gerekli');
    }
  }

  /**
   * Budget brake for the other paid AI paths a FREE user can trigger (selection, analysis, chat): with the hard
   * brake (`free_paused`) on and the daily budget spent they pause like generation does. PRO users keep service.
   */
  async assertBudgetFor(userId: string) {
    const budget = await this.usage.budget();
    if (budget.state !== 'exceeded' || budget.brakeMode !== 'free_paused') return;
    if (this.users.isPro(await this.users.get(userId))) return;
    throw new AppError(503, 'generation_paused', 'Yoğunluk nedeniyle bu özellik kısa süreliğine durduruldu');
  }

  /** Validates the request, holds credits and either runs inline (sync) or enqueues (async, 202). */
  async create(userId: string, body: CreateDesign, requestId: string, mode: 'sync' | 'async' = 'sync') {
    const settings = this.settings.current;
    if (settings.maintenance.enabled) throw new AppError(503, 'busy', settings.maintenance.messageTr);
    const user = await this.users.get(userId);
    // A firm's workspace (API.md §7.23) is paid by the firm: PRO tools, styles and variants, no budget brake.
    const org = body.orgId ? await this.orgs.workspace(body.orgId, userId) : null;
    if (body.projectId && !org) throw new AppError(400, 'validation_failed', 'Proje yalnız firma çalışma alanında seçilir');
    const project = org && body.projectId ? await this.projects.usable(org.id, body.projectId) : null;
    const pro = this.users.isPro(user) || org !== null;
    const locale: Locale = isLocale(user.locale) ? user.locale : 'tr';
    const tool = this.product.offeredTool(body.tool);
    this.product.assertOffered(body.roomId, body.floorId);
    if (tool.isPro && !pro) throw new AppError(402, 'pro_required', 'Bu araç PRO üyelere özel');
    await this.assertAiConsent(userId);

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
    if (body.points && (!tool.needs.points || body.removeAll)) {
      throw new AppError(400, 'validation_failed', 'Dokunarak seçim bu araçta kullanılamaz');
    }
    const input = await this.images.owned(body.inputImageId, userId);
    if (body.referenceImageId) await this.images.owned(body.referenceImageId, userId);

    const params: Record<string, unknown> = {};
    for (const k of ['floorId', 'colorHex', 'colorName', 'target', 'replacement', 'instructions', 'removeAll', 'referenceImageId', 'points'] as const) {
      if (body[k] !== undefined) params[k] = body[k];
    }
    params.variants = variants;

    const design = await this.prisma.design.create({
      data: {
        userId, tool: body.tool, styleId: style?.id ?? null, roomId: body.roomId ?? null, orgId: org?.id ?? null, projectId: project?.id ?? null,
        params: params as Prisma.InputJsonValue, inputImageId: input.id, queuedAt: new Date(),
      },
    });

    // Personal designs spend the daily free slots then credits; firm designs spend the firm's pool (chargeDay null).
    let charge: Charge | null = null;
    try {
      if (org) await this.orgs.charge(org.id, userId, variants, design.id);
      else charge = await this.users.charge(userId, variants, design.id);
    } catch (e) {
      await this.prisma.design.delete({ where: { id: design.id } });
      throw e;
    }
    await this.prisma.design.update({
      where: { id: design.id },
      data: charge
        ? { chargeState: 'HELD', chargeDay: charge.day, freeUsed: charge.fromFree, creditsUsed: charge.fromCredits }
        : { chargeState: 'HELD', chargeDay: null, freeUsed: 0, creditsUsed: variants },
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
   * Tap selection preview (API.md §7.15): the mask a design with these points (or this object name) will be
   * locked to, shown over the photo before anything is generated. Each call is a paid SAM 3 request.
   */
  async selection(userId: string, imageId: string, body: Selection, requestId: string) {
    if (!body.points && !body.target) throw new AppError(400, 'validation_failed', 'Dokunulan nokta ya da nesne adı gerekli');
    const settings = this.settings.current;
    if (settings.maintenance.enabled) throw new AppError(503, 'busy', settings.maintenance.messageTr);
    await this.assertAiConsent(userId);
    await this.assertBudgetFor(userId);
    const img = await this.images.owned(imageId, userId);
    try {
      const out = await this.ai.segment(
        { image_b64: (await this.images.read(img.id)).toString('base64'), target: body.target, points: body.points },
        requestId,
      );
      await this.usage.record(out.usage, { userId });
      // Only a real PNG goes back to the browser as a data URI.
      if (sniffMime(Buffer.from(out.mask_b64, 'base64')) !== 'image/png') {
        throw new AiError(502, 'ai_unavailable', 'Yapay zekâ şu an yanıt veremiyor', false);
      }
      return { mask: `data:image/png;base64,${out.mask_b64}`, coverage: out.coverage, method: out.method };
    } catch (e) {
      if (e instanceof AiError && e.usage) await this.usage.record(e.usage, { userId });
      throw e;
    }
  }

  /**
   * Runs one generation. Idempotent: anything not PENDING is skipped. A retryable AI failure on a
   * non-final attempt is re-thrown with the design left PENDING so the queue can try again.
   */
  async process(designId: string, opts: { finalAttempt: boolean; requestId?: string }): Promise<void> {
    const d = await this.prisma.design.findUnique({ where: { id: designId }, include: { user: true } });
    if (!d || d.status !== 'PENDING') return;
    const pro = this.users.isPro(d.user) || Boolean(d.orgId);
    // The budget may have run out while this design waited in the queue: a FREE design then stops here,
    // before any provider call, and its held credits go back.
    if (!pro) {
      const budget = await this.usage.budget();
      if (budget.state === 'exceeded' && budget.brakeMode === 'free_paused') {
        await this.fail(designId, 'generation_paused');
        return;
      }
    }
    await this.prisma.design.update({ where: { id: designId }, data: { startedAt: new Date() } });
    const params = (d.params ?? {}) as Record<string, string | number | boolean | undefined>;
    const style = d.styleId ? (await this.catalog.styles(true)).find((s) => s.id === d.styleId) : undefined;
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const points = PointsSchema.safeParse((d.params as { points?: unknown } | null)?.points);
    // The panel's live prompt templates (API.md §7.26); which versions were used is kept with the design.
    const prompts = this.prompts.forTool(d.tool);
    try {
      const out = await this.ai.generate(
        {
          tool: d.tool,
          image_b64: (await this.images.read(d.inputImageId)).toString('base64'),
          variants: Number(params.variants ?? 1),
          style_prompt: style?.prompt,
          room: this.product.roomPrompt(d.roomId),
          floor: this.product.floorPrompt(str(params.floorId)),
          color_hex: str(params.colorHex),
          color_name: str(params.colorName),
          target: str(params.target),
          replacement: str(params.replacement),
          instructions: str(params.instructions),
          remove_all: params.removeAll === true,
          reference_image_b64: str(params.referenceImageId)
            ? (await this.images.read(str(params.referenceImageId)!)).toString('base64')
            : undefined,
          points: points.success ? points.data : undefined,
          prompt_templates: prompts.templates,
          // The panel's provider chain and models (API.md §7.27); undefined = the AI service's own chain.
          engine: this.engine.current,
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
      await this.settleSuccess(d, buffers.length, {
        status: 'SUCCEEDED', prompt: out.prompt, provider: out.provider, finishedAt: new Date(),
        ...(out.region || prompts.templates
          ? { params: { ...(d.params as Prisma.JsonObject), ...(out.region ? { region: out.region } : {}), ...(prompts.templates ? { promptVersions: prompts.versions } : {}) } }
          : {}),
      });
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

  /**
   * Success: captures the hold and, for variants that didn't come back, refunds the missing units (paid credits
   * first) in ONE transaction — a crash can't refund twice or lose the refund. Only the call that moves the design
   * out of HELD refunds; a retried job finds it CAPTURED and refunds nothing.
   */
  private async settleSuccess(
    d: { id: string; userId: string; orgId: string | null; params: Prisma.JsonValue; creditsUsed: number; freeUsed: number; chargeDay: string | null },
    produced: number,
    data: Prisma.DesignUpdateInput,
  ) {
    const missing = Math.max(0, Number((d.params as { variants?: number } | null)?.variants ?? 1) - produced);
    const refundCredits = Math.min(missing, d.creditsUsed);
    const refundFree = Math.min(missing - refundCredits, d.freeUsed);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.design.updateMany({ where: { id: d.id, chargeState: 'HELD' }, data: { chargeState: 'CAPTURED' } });
      const refund = claimed.count === 1 && refundCredits + refundFree > 0 && (d.chargeDay !== null || Boolean(d.orgId));
      if (refund && d.orgId) await this.orgs.refund(d.orgId, d.userId, refundCredits, d.id, tx);
      else if (refund) await this.users.refund(d.userId, { day: d.chargeDay!, fromFree: refundFree, fromCredits: refundCredits }, d.id, tx);
      await tx.design.update({
        where: { id: d.id },
        data: { ...data, ...(refund ? { creditsUsed: d.creditsUsed - refundCredits, freeUsed: d.freeUsed - refundFree } : {}) },
      });
    });
  }

  /** Marks a design FAILED and releases its held credits exactly once. */
  async fail(designId: string, code: string) {
    await this.prisma.design.updateMany({
      where: { id: designId, status: 'PENDING' },
      data: { status: 'FAILED', error: code, finishedAt: new Date() },
    });
    const d = await this.prisma.design.findUnique({ where: { id: designId } });
    if (!d) return;
    await this.releaseHold(designId);
    log.warn('design_failed', { designId, userId: d.userId, tool: d.tool, code });
  }

  /**
   * HELD → RELEASED and the refund commit together. If the refund fails the design stays HELD and the reconciler
   * tries again; the conditional update means two callers can never both refund.
   */
  private async releaseHold(designId: string): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const d = await tx.design.findUnique({ where: { id: designId } });
        if (!d || d.chargeState !== 'HELD') return false;
        const claimed = await tx.design.updateMany({ where: { id: designId, chargeState: 'HELD' }, data: { chargeState: 'RELEASED' } });
        if (claimed.count !== 1) return false;
        if (d.orgId) await this.orgs.refund(d.orgId, d.userId, d.creditsUsed, designId, tx);
        else if (d.chargeDay) await this.users.refund(d.userId, { day: d.chargeDay, fromFree: d.freeUsed, fromCredits: d.creditsUsed }, designId, tx);
        return true;
      });
    } catch (err) {
      log.error('refund_failed', { designId, error: (err as Error).name });
      return false;
    }
  }

  /**
   * Reconciler: anything PENDING for more than 10 minutes is failed and refunded, and failed designs whose refund
   * didn't go through (still HELD) are refunded again.
   */
  async reconcile(): Promise<number> {
    const stale = await this.prisma.design.findMany({
      where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      select: { id: true },
      take: 200,
    });
    for (const s of stale) await this.fail(s.id, 'timeout');
    const unrefunded = await this.prisma.design.findMany({
      where: { status: 'FAILED', chargeState: 'HELD' },
      select: { id: true },
      take: 200,
    });
    for (const u of unrefunded) await this.releaseHold(u.id);
    return stale.length;
  }

  /**
   * One workspace at a time: personal designs, or the caller's designs in a firm they still belong to. With a
   * project: everyone's designs in that project (the shared folder), for members only.
   */
  async list(userId: string, opts: { cursor?: string; limit: number; favorite?: boolean; orgId?: string; projectId?: string }, locale: Locale) {
    if (opts.projectId && !opts.orgId) throw new AppError(400, 'validation_failed', 'Proje için firma seçilmeli');
    if (opts.projectId) await this.projects.assertVisible(opts.orgId!, opts.projectId, userId);
    else if (opts.orgId) await this.orgs.membership(opts.orgId, userId);
    const where: Prisma.DesignWhereInput = opts.projectId
      ? { orgId: opts.orgId, projectId: opts.projectId }
      : { userId, orgId: opts.orgId ?? null, ...(opts.favorite ? { favorite: true } : {}) };
    const rows = await this.prisma.design.findMany({
      where,
      include: this.include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      ...cursorArgs(opts.cursor),
    });
    const page = rows.slice(0, opts.limit);
    return {
      items: await Promise.all(page.map((d) => this.toDto(d, locale, userId))),
      nextCursor: rows.length > opts.limit ? page[page.length - 1].id : null,
    };
  }

  /**
   * Read access: one's own design, or a teammate's design that sits in a project of a firm the caller still
   * belongs to. Everything that changes a design keeps using getOwned (the maker only).
   */
  async getVisible(userId: string, id: string) {
    if (!isUuid(id)) throw notFound();
    const d = await this.prisma.design.findFirst({ where: { id }, include: this.include });
    if (!d) throw notFound();
    if (d.userId === userId) {
      if (d.orgId) await this.orgs.membership(d.orgId, userId);
      return d;
    }
    if (!d.orgId || !d.projectId) throw notFound();
    await this.orgs.membership(d.orgId, userId);
    return d;
  }

  /** The maker moves a firm design into one of the firm's open projects, or out of it (null). */
  async setProject(userId: string, id: string, projectId: string | null, locale: Locale) {
    const d = await this.getOwned(userId, id);
    if (!d.orgId) throw new AppError(409, 'personal_design', 'Kişisel tasarımlar firma projesine taşınamaz');
    if (projectId) await this.projects.usable(d.orgId, projectId);
    const updated = await this.prisma.design.update({ where: { id }, data: { projectId }, include: this.include });
    return this.toDto(updated, locale, userId);
  }

  async getOwned(userId: string, id: string) {
    if (!isUuid(id)) throw notFound();
    const d = await this.prisma.design.findFirst({ where: { id, userId }, include: this.include });
    if (!d) throw notFound();
    // A firm design stays the firm's: someone who left (or was removed) no longer reaches it (AZ-01).
    if (d.orgId) await this.orgs.membership(d.orgId, userId);
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

  /** `beforeNew` runs only when a new analysis is needed (e.g. the feature flag, API.md §7.28): a cached one is always shown. */
  async analysis(userId: string, designId: string, imageId: string | undefined, locale: Locale, requestId: string, beforeNew?: () => void) {
    const d = await this.getOwned(userId, designId);
    const target = imageId ? d.results.find((r) => r.id === imageId) : d.results[0];
    if (!target) throw notFound();
    const cached = await this.prisma.analysis.findUnique({ where: { designId_imageId: { designId, imageId: target.id } } });
    if (cached) return this.analysisDto(cached);
    beforeNew?.();
    // A new analysis sends the result image to the AI provider: same consent and budget brake as generating it.
    await this.assertAiConsent(userId);
    await this.assertBudgetFor(userId);

    const style = d.styleId ? (await this.catalog.styles(true)).find((s) => s.id === d.styleId) : undefined;
    const out = await this.ai.analyze(
      {
        image_b64: (await this.images.read(target.id)).toString('base64'),
        locale,
        room: this.product.roomPrompt(d.roomId),
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

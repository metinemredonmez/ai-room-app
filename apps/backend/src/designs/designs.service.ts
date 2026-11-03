import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type Config } from '../config.js';
import { AiClient } from '../ai/ai.client.js';
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
      createdAt: d.createdAt.toISOString(),
    };
  }

  private include = { inputImage: true, results: true } as const;

  async create(userId: string, body: CreateDesign, requestId: string) {
    const user = await this.users.get(userId);
    const pro = this.users.isPro(user);
    const tool = TOOLS[body.tool];
    if (tool.isPro && !pro) throw new AppError(402, 'pro_required', 'Bu araç PRO üyelere özel');

    const style = tool.needs.style || body.styleId ? await this.catalog.style(body.styleId ?? 'modern') : undefined;
    if (style?.isPro && !pro) throw new AppError(402, 'pro_required', 'Bu stil PRO üyelere özel');
    if (body.tool === 'reference' && !body.referenceImageId) {
      throw new AppError(400, 'validation_failed', 'Referans görsel gerekli');
    }
    const input = await this.images.owned(body.inputImageId, userId);
    const reference = body.referenceImageId ? await this.images.owned(body.referenceImageId, userId) : undefined;

    const params: Record<string, unknown> = {};
    for (const k of ['floorId', 'colorHex', 'colorName', 'target', 'replacement', 'instructions', 'removeAll', 'referenceImageId'] as const) {
      if (body[k] !== undefined) params[k] = body[k];
    }
    params.variants = body.variants;

    const design = await this.prisma.design.create({
      data: {
        userId, tool: body.tool, styleId: style?.id ?? null, roomId: body.roomId ?? null,
        params: params as Prisma.InputJsonValue, inputImageId: input.id,
      },
    });

    let charge: Charge;
    try {
      charge = await this.users.charge(userId, body.variants, design.id);
    } catch (e) {
      await this.prisma.design.delete({ where: { id: design.id } });
      throw e;
    }

    try {
      const out = await this.slots.run(async () =>
        this.ai.generate(
          {
            tool: body.tool,
            image_b64: (await this.images.read(input.id)).toString('base64'),
            variants: body.variants,
            style_prompt: style?.prompt,
            room: body.roomId ? ROOMS[body.roomId].prompt : undefined,
            floor: body.floorId ? FLOORS[body.floorId].prompt : undefined,
            color_hex: body.colorHex,
            color_name: body.colorName,
            target: body.target,
            replacement: body.replacement,
            instructions: body.instructions,
            remove_all: body.removeAll ?? false,
            reference_image_b64: reference ? (await this.images.read(reference.id)).toString('base64') : undefined,
          },
          requestId,
        ),
      );
      for (const b64 of out.images_b64) {
        let buf: Buffer = Buffer.from(b64, 'base64');
        // Provider output is untrusted too: decode/re-encode with the same limits as uploads.
        buf = (await this.images.normalize(buf, 'image/jpeg', 2048)).buffer;
        if (!pro) buf = await this.images.watermark(buf);
        await this.images.save(buf, { ownerId: userId, kind: 'RESULT', designId: design.id });
      }
      const done = await this.prisma.design.update({
        where: { id: design.id },
        data: {
          status: 'SUCCEEDED', prompt: out.prompt, provider: out.provider, finishedAt: new Date(),
          creditsUsed: charge.fromCredits, freeUsed: charge.fromFree,
        },
        include: this.include,
      });
      log.info('design_succeeded', { designId: design.id, userId, tool: body.tool, provider: out.provider, variants: body.variants });
      return this.toDto(done, user.locale === 'en' ? 'en' : 'tr');
    } catch (e) {
      const code = e instanceof AppError ? e.code : 'internal';
      await this.prisma.design.update({ where: { id: design.id }, data: { status: 'FAILED', error: code, finishedAt: new Date() } });
      await this.users.refund(userId, charge, design.id);
      log.warn('design_failed', { designId: design.id, userId, tool: body.tool, code });
      throw e;
    }
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

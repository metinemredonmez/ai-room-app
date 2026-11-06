import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { Prisma } from '../generated/prisma/client.js';
import { TOOLS, TOOL_IDS, type Locale, type ToolId } from './catalog.data.js';
import {
  ROOM_ICONS, defaultProduct, findFloor, findRoom, findTool, nextProduct, parseStoredProduct, productDiff, publicProduct, roomName, toolName,
  type ProductInput, type StoredProduct,
} from './product.rules.js';

// Product catalog from the admin (API.md §7.25): one Setting row (key `product.catalog`). Like the runtime settings
// it is kept in memory and refreshed every 15 s (and at once on save), so every API and worker process converges and
// reading it costs nothing on the hot path.

const KEY = 'product.catalog';
const REFRESH_MS = 15_000;

@Injectable()
export class ProductCatalogService implements OnModuleInit, OnModuleDestroy {
  readonly defaults = defaultProduct();
  private value: StoredProduct = this.defaults;
  private meta: { updatedAt: Date | null; updatedBy: string | null } = { updatedAt: null, updatedBy: null };
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload().catch((e: Error) => log.warn('product_catalog_load_failed', { error: e.name }));
    this.timer = setInterval(() => void this.reload().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reload() {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    if (!row) {
      this.value = this.defaults;
      this.meta = { updatedAt: null, updatedBy: null };
      return;
    }
    const { catalog, ok } = parseStoredProduct(row.value, this.defaults);
    // A corrupt row must never take the app down: the code's catalog is used and the error is logged.
    if (!ok) log.error('product_catalog_invalid', { key: KEY });
    this.value = catalog;
    this.meta = { updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }

  get current(): StoredProduct {
    return this.value;
  }

  /** `/v1/catalog` part: offered tools, rooms, floors and colours in the panel's order. */
  forApp(locale: Locale) {
    return publicProduct(this.value, locale);
  }

  /** The tool as offered now; a switched-off tool is refused with a clear message (an old app may still show it). */
  offeredTool(id: ToolId) {
    const t = findTool(this.value, id);
    if (!t || !t.enabled) throw new AppError(400, 'tool_unavailable', 'Bu araç şu an kullanılamıyor; uygulamayı yenileyip başka bir araç seç.');
    return { ...t, needs: TOOLS[id].needs };
  }

  /** New designs take only rooms and floors that are on the list and switched on. */
  assertOffered(roomId: string | undefined, floorId: string | undefined) {
    if (roomId && !this.value.rooms.some((r) => r.id === roomId && r.enabled)) {
      throw new AppError(400, 'validation_failed', 'Bu oda tipi artık seçilemiyor; listeden başka bir oda seç.');
    }
    if (floorId && !this.value.floors.some((f) => f.id === floorId && f.enabled)) {
      throw new AppError(400, 'validation_failed', 'Bu zemin artık seçilemiyor; listeden başka bir zemin seç.');
    }
  }

  /** Prompt words for the image model; retired entries still resolve so a queued job never loses its room. */
  roomPrompt(id: string | null | undefined) {
    return findRoom(this.value, id)?.prompt;
  }

  floorPrompt(id: string | null | undefined) {
    return findFloor(this.value, id)?.prompt;
  }

  roomName(id: string | null | undefined, locale: Locale) {
    return roomName(this.value, id, locale);
  }

  toolName(id: string, locale: Locale) {
    const t = findTool(this.value, id);
    return t ? toolName(t, locale) : id;
  }

  async forAdmin() {
    await this.reload();
    const [rooms, floors, editor] = await Promise.all([
      this.prisma.design.groupBy({ by: ['roomId'], _count: { _all: true }, where: { roomId: { not: null } } }),
      this.prisma.$queryRaw<Array<{ id: string; n: bigint }>>`
        SELECT params->>'floorId' AS id, COUNT(*) AS n FROM "Design" WHERE params->>'floorId' IS NOT NULL GROUP BY 1`,
      this.meta.updatedBy ? this.prisma.user.findUnique({ where: { id: this.meta.updatedBy }, select: { email: true, name: true } }) : null,
    ]);
    const { retired, ...catalog } = this.value;
    return {
      catalog,
      defaults: (({ retired: _r, ...d }) => d)(this.defaults),
      usage: {
        rooms: Object.fromEntries(rooms.map((r) => [r.roomId!, r._count._all])),
        floors: Object.fromEntries(floors.map((f) => [f.id, Number(f.n)])),
      },
      retired: { rooms: retired.rooms.length, floors: retired.floors.length },
      // What each tool is and asks for (set in code), so the panel can explain a switch.
      toolInfo: Object.fromEntries(
        TOOL_IDS.map((tid) => [tid, { category: TOOLS[tid].category, needs: Object.entries(TOOLS[tid].needs).filter(([, v]) => v).map(([k]) => k) }]),
      ),
      roomIcons: ROOM_ICONS,
      saved: this.meta.updatedAt !== null,
      version: this.meta.updatedAt?.toISOString() ?? null,
      updatedAt: this.meta.updatedAt?.toISOString() ?? null,
      updatedBy: editor ? (editor.name ?? editor.email) : null,
    };
  }

  /** Saved under an advisory lock with an optimistic version, so two admins cannot overwrite each other (BUS-02). */
  async save(input: ProductInput, version: string | null, actorId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      if ((row?.updatedAt.toISOString() ?? null) !== version) {
        throw new AppError(409, 'version_conflict', 'Katalog bu arada değişti; sayfayı yenileyip yeniden dene.');
      }
      const prev = row ? parseStoredProduct(row.value, this.defaults).catalog : this.defaults;
      const next = nextProduct(prev, input);
      const value = next as unknown as Prisma.InputJsonValue;
      const saved = await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      return { changes: productDiff(prev, input), next, updatedAt: saved.updatedAt };
    });
    this.value = result.next;
    this.meta = { updatedAt: result.updatedAt, updatedBy: actorId };
    return { changes: result.changes };
  }

  /**
   * One tool's credit price, for scheduled price changes (API.md §7.36). With `onlyIf`, the price changes only while it
   * is still that value, so undoing a scheduled change never overwrites an edit made by hand in the meantime.
   */
  async setToolCredits(toolId: string, credits: number, onlyIf: number | null, actorId: string | null): Promise<SetPriceResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      const prev = row ? parseStoredProduct(row.value, this.defaults).catalog : this.defaults;
      const tool = prev.tools.find((t) => t.id === toolId);
      if (!tool) return { status: 'missing' as const };
      if (onlyIf !== null && tool.credits !== onlyIf) return { status: 'changed' as const, current: tool.credits };
      const next: StoredProduct = { ...prev, tools: prev.tools.map((t) => (t.id === toolId ? { ...t, credits } : t)) };
      const value = next as unknown as Prisma.InputJsonValue;
      const saved = await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      return { status: 'ok' as const, before: tool.credits, next, updatedAt: saved.updatedAt };
    });
    if (result.status !== 'ok') return result;
    this.value = result.next;
    this.meta = { updatedAt: result.updatedAt, updatedBy: actorId };
    return { status: 'ok', before: result.before };
  }
}

export type SetPriceResult = { status: 'ok'; before: number } | { status: 'missing' } | { status: 'changed'; current: number };

import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { CONFIG, type Config } from '../config.js';
import { Prisma } from '../generated/prisma/client.js';
import type { SetPriceResult } from '../catalog/product.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { Locale } from '../catalog/catalog.data.js';
import { catalogDiff, catalogPlans, creditsFor, defaultCatalog, nextCatalog, parseStored, publicCatalog, webPricing, type CatalogInput, type StoredCatalog } from './plans.rules.js';

// Plans and credit packs (API.md §7.21). Kept as one row of the Setting table (key `billing.catalog`), outside the
// runtime-settings form; until someone saves it the catalog is built from `CREDIT_PACKS`, so behaviour is unchanged.

const KEY = 'billing.catalog';
const TTL_MS = 15_000;

type State = { at: number; catalog: StoredCatalog; updatedAt: Date | null; updatedBy: string | null };

@Injectable()
export class PlansService {
  readonly defaults: StoredCatalog;
  private cache: State | null = null;

  constructor(private prisma: PrismaService, private settings: SettingsService, @Inject(CONFIG) private cfg: Config) {
    this.defaults = defaultCatalog(cfg.CREDIT_PACKS);
  }

  private async state(fresh = false): Promise<State> {
    if (!fresh && this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache;
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    this.cache = {
      at: Date.now(),
      catalog: row ? parseStored(row.value, this.defaults) : this.defaults,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
    return this.cache;
  }

  /** Read fresh on every purchase: a credit change in the panel applies to the very next purchase. */
  async creditsFor(productId: string): Promise<number | null> {
    return creditsFor((await this.state(true)).catalog, productId);
  }

  private limits() {
    const s = this.settings.current;
    return {
      free: { dailyGenerations: s.freeDailyGenerations, maxVariants: s.maxVariantsFree },
      pro: { dailyGenerations: s.proDailyGenerations, maxVariants: s.maxVariantsPro },
    };
  }

  /** `GET /v1/catalog`: the plan cards (`plans`) and the web pricing page's Pro card, packs and limits (`pricing`). */
  async forCatalog(locale: Locale) {
    const { catalog } = await this.state();
    return { plans: catalogPlans(catalog, locale), pricing: { ...webPricing(catalog, locale), limits: this.limits() } };
  }

  async forPaywall(lang: 'tr' | 'en') {
    return publicCatalog((await this.state()).catalog, lang, this.limits());
  }

  async forAdmin() {
    const s = await this.state(true);
    const editor = s.updatedBy ? await this.prisma.user.findUnique({ where: { id: s.updatedBy }, select: { email: true, name: true } }) : null;
    const { retired, ...catalog } = s.catalog;
    return {
      catalog,
      retiredProducts: retired.length,
      saved: s.updatedAt !== null,
      version: s.updatedAt?.toISOString() ?? null,
      updatedAt: s.updatedAt?.toISOString() ?? null,
      updatedBy: editor ? (editor.name ?? editor.email) : null,
      limits: this.limits(),
      revenuecatRest: Boolean(this.cfg.REVENUECAT_API_KEY),
    };
  }

  /**
   * Saves under an advisory lock with an optimistic version (the `updatedAt` the editor loaded; null = never saved),
   * so two admins cannot overwrite each other's change unseen (BUS-02).
   */
  async save(input: CatalogInput, version: string | null, actorId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      if ((row?.updatedAt.toISOString() ?? null) !== version) {
        throw new AppError(409, 'version_conflict', 'Katalog bu arada değişti; sayfayı yenileyip yeniden dene.');
      }
      const prev = row ? parseStored(row.value, this.defaults) : this.defaults;
      const next = nextCatalog(prev, input);
      const value = next as unknown as Prisma.InputJsonValue;
      const saved = await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      return { changes: catalogDiff(prev, input), next, updatedAt: saved.updatedAt };
    });
    this.cache = { at: Date.now(), catalog: result.next, updatedAt: result.updatedAt, updatedBy: actorId };
    return { changes: result.changes };
  }

  /** Current packs, read fresh (scheduled price changes, API.md §7.36). */
  async packs() {
    return (await this.state(true)).catalog.packs;
  }

  /**
   * How many credits one pack grants, for scheduled price changes (API.md §7.36). With `onlyIf`, it changes only while
   * it is still that value, so undoing a scheduled change never overwrites an edit made by hand in the meantime.
   */
  async setPackCredits(key: string, credits: number, onlyIf: number | null, actorId: string | null): Promise<SetPriceResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${KEY}))) AS l`;
      const row = await tx.setting.findUnique({ where: { key: KEY } });
      const prev = row ? parseStored(row.value, this.defaults) : this.defaults;
      const pack = prev.packs.find((p) => p.key === key);
      if (!pack) return { status: 'missing' as const };
      if (onlyIf !== null && pack.credits !== onlyIf) return { status: 'changed' as const, current: pack.credits };
      const next: StoredCatalog = { ...prev, packs: prev.packs.map((p) => (p.key === key ? { ...p, credits } : p)) };
      const value = next as unknown as Prisma.InputJsonValue;
      const saved = await tx.setting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
      return { status: 'ok' as const, before: pack.credits, next, updatedAt: saved.updatedAt };
    });
    if (result.status !== 'ok') return result;
    this.cache = { at: Date.now(), catalog: result.next, updatedAt: result.updatedAt, updatedBy: actorId };
    return { status: 'ok', before: result.before };
  }
}

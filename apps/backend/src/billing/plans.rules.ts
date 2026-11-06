import { z } from 'zod';
import type { Locale } from '../catalog/catalog.data.js';
import { localize } from '../catalog/catalog.i18n.js';

// Plans and credit packs (API.md §7.21; palemi `billing/catalog` + fal-app `subscriptions/plans` pattern, adapted).
// The catalog says what the paywall shows (PRO features, which billing periods, which credit packs) and how many
// credits a pack's store product grants. Prices are never stored: the store sets them and the app shows the store's
// own localized price. Texts are Turkish and English (other languages get English, like e-mails and legal texts).

export const CYCLES = ['weekly', 'monthly', 'yearly'] as const;
export type Cycle = (typeof CYCLES)[number];
export const MAX_PACKS = 6;
export const MAX_FEATURES = 8;
const MAX_RETIRED = 100;

const PRODUCT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const productId = z.string().trim().regex(PRODUCT_ID).nullable();
const name = z.string().trim().min(1).max(40);
const line = z.string().trim().min(1).max(80);
/** Price shown on the web (TRY, for information: the store charges its own price). Older saves have none. */
const webPrice = z.number().min(0.01).max(100_000).nullable().default(null);
const badge = z.string().trim().max(20).default('');

const CycleSchema = z
  .object({
    cycle: z.enum(CYCLES),
    active: z.boolean(),
    highlight: z.boolean(),
    iosProductId: productId,
    androidProductId: productId,
    webPriceTRY: webPrice,
    badgeTr: badge,
    badgeEn: badge,
  })
  .strict();
const PackSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
    nameTr: name,
    nameEn: name,
    credits: z.number().int().min(1).max(10_000),
    iosProductId: productId,
    androidProductId: productId,
    highlight: z.boolean(),
    active: z.boolean(),
    webPriceTRY: webPrice,
  })
  .strict();

/** What the admin edits. */
export const CatalogInputSchema = z
  .object({
    plan: z
      .object({
        nameTr: name,
        nameEn: name,
        taglineTr: z.string().trim().max(120),
        taglineEn: z.string().trim().max(120),
        featuresTr: z.array(line).max(MAX_FEATURES),
        featuresEn: z.array(line).max(MAX_FEATURES),
        cycles: z.array(CycleSchema).max(CYCLES.length),
      })
      .strict(),
    packs: z.array(PackSchema).max(MAX_PACKS),
  })
  .strict()
  .superRefine((c, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const cycles = new Set<string>();
    c.plan.cycles.forEach((cy, i) => {
      if (cycles.has(cy.cycle)) issue(['plan', 'cycles', i, 'cycle'], 'duplicate_cycle');
      cycles.add(cy.cycle);
      if (cy.active && !cy.iosProductId && !cy.androidProductId) issue(['plan', 'cycles', i], 'active_needs_product');
    });
    if (c.plan.cycles.filter((cy) => cy.highlight).length > 1) issue(['plan', 'cycles'], 'one_highlight');
    const keys = new Set<string>();
    c.packs.forEach((p, i) => {
      if (keys.has(p.key)) issue(['packs', i, 'key'], 'duplicate_key');
      keys.add(p.key);
      if (p.active && !p.iosProductId && !p.androidProductId) issue(['packs', i], 'active_needs_product');
    });
    if (c.packs.filter((p) => p.highlight).length > 1) issue(['packs'], 'one_highlight');
    // One store product means one thing: a subscription period or a pack, never two packs (credits stay unambiguous).
    // The same id on iOS and Android of one entry is fine (one id on both stores is common).
    const owner = new Map<string, string>();
    const claim = (id: string | null, entry: string, path: (string | number)[]) => {
      if (!id) return;
      const prev = owner.get(id);
      if (prev && prev !== entry) issue(path, 'duplicate_product');
      else owner.set(id, entry);
    };
    c.plan.cycles.forEach((cy, i) => {
      claim(cy.iosProductId, `cycle${i}`, ['plan', 'cycles', i, 'iosProductId']);
      claim(cy.androidProductId, `cycle${i}`, ['plan', 'cycles', i, 'androidProductId']);
    });
    c.packs.forEach((p, i) => {
      claim(p.iosProductId, `pack${i}`, ['packs', i, 'iosProductId']);
      claim(p.androidProductId, `pack${i}`, ['packs', i, 'androidProductId']);
    });
  });
export type CatalogInput = z.infer<typeof CatalogInputSchema>;
export type Pack = z.infer<typeof PackSchema>;
export type CycleEntry = z.infer<typeof CycleSchema>;

/**
 * What an admin save must also meet (not checked on stored values, so an older save keeps loading): a period on sale
 * has a web price, so the web never shows a plan without one.
 */
export const CatalogSaveSchema = CatalogInputSchema.superRefine((c, ctx) => {
  c.plan.cycles.forEach((cy, i) => {
    if (cy.active && cy.webPriceTRY === null) ctx.addIssue({ code: 'custom', path: ['plan', 'cycles', i, 'webPriceTRY'], message: 'active_needs_price' });
  });
});

const PERIOD = { weekly: 'week', monthly: 'month', yearly: 'year' } as const;
export const CYCLE_NAMES: Record<Cycle, { tr: string; en: string }> = {
  weekly: { tr: 'Haftalık', en: 'Weekly' },
  monthly: { tr: 'Aylık', en: 'Monthly' },
  yearly: { tr: 'Yıllık', en: 'Yearly' },
};

/** The three periods the web and the app showed before the catalog had them; the first catalog starts from these. */
export const DEFAULT_CYCLES: CycleEntry[] = [
  { cycle: 'weekly', active: true, highlight: false, iosProductId: 'casalume_pro_weekly', androidProductId: 'casalume_pro_weekly', webPriceTRY: 149.99, badgeTr: '', badgeEn: '' },
  { cycle: 'monthly', active: true, highlight: true, iosProductId: 'casalume_pro_monthly', androidProductId: 'casalume_pro_monthly', webPriceTRY: 349.99, badgeTr: 'POPÜLER', badgeEn: 'POPULAR' },
  { cycle: 'yearly', active: true, highlight: false, iosProductId: 'casalume_pro_yearly', androidProductId: 'casalume_pro_yearly', webPriceTRY: 1299.99, badgeTr: 'EN AVANTAJLI', badgeEn: 'BEST VALUE' },
];

/** Stored form: the input plus `retired`, the packs taken off the catalog (a purchase of one still gets its credits). */
export type StoredCatalog = CatalogInput & { retired: Array<{ productId: string; credits: number }> };

/** First catalog, before anyone saves one: today's credit packs from `CREDIT_PACKS` (`id:credits,…`). */
export function defaultCatalog(creditPacks: string): StoredCatalog {
  const packs = creditPacks
    .split(',')
    .map((p) => p.trim().split(':'))
    .filter(([id, n]) => id && PRODUCT_ID.test(id) && Number(n) > 0)
    .slice(0, MAX_PACKS)
    .map(([id, n], i): Pack => {
      const credits = Math.min(10_000, Math.trunc(Number(n)));
      return {
        key: `pack_${i + 1}`,
        nameTr: `${credits} tasarım hakkı`,
        nameEn: `${credits} design credits`,
        credits,
        iosProductId: id,
        androidProductId: id,
        highlight: false,
        active: true,
        webPriceTRY: null,
      };
    });
  return {
    plan: {
      nameTr: 'Casalume Pro',
      nameEn: 'Casalume Pro',
      taglineTr: 'Daha çok tasarım, tüm stiller',
      taglineEn: 'More designs, every style',
      featuresTr: ['Günde çok daha fazla tasarım', 'Tüm Pro stiller', 'Tek seferde daha çok seçenek', 'Filigransız sonuçlar'],
      featuresEn: ['Many more designs a day', 'Every Pro style', 'More options at once', 'Results without watermark'],
      cycles: DEFAULT_CYCLES,
    },
    packs,
    retired: [],
  };
}

/** Packs that leave the catalog keep crediting their product ids; a product put back on sale leaves `retired`. */
export function nextCatalog(prev: StoredCatalog, input: CatalogInput): StoredCatalog {
  const live = new Set(input.packs.flatMap((p) => [p.iosProductId, p.androidProductId]).filter((x): x is string => !!x));
  const dropped = prev.packs.flatMap((p) =>
    [...new Set([p.iosProductId, p.androidProductId])].filter((id): id is string => !!id && !live.has(id)).map((productId) => ({ productId, credits: p.credits })),
  );
  const retired = [...dropped, ...prev.retired.filter((r) => !live.has(r.productId) && !dropped.some((d) => d.productId === r.productId))];
  return { ...input, retired: retired.slice(0, MAX_RETIRED) };
}

/** Credits a store product grants: an active or inactive pack first, then a retired one; null for anything else. */
export function creditsFor(c: StoredCatalog, productId: string): number | null {
  const pack = c.packs.find((p) => p.iosProductId === productId || p.androidProductId === productId);
  if (pack) return pack.credits;
  return c.retired.find((r) => r.productId === productId)?.credits ?? null;
}

/** A stored value read back from the database: anything that no longer validates falls back to the default. */
export function parseStored(value: unknown, fallback: StoredCatalog): StoredCatalog {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const input = CatalogInputSchema.safeParse({ plan: v.plan, packs: v.packs });
  if (!input.success) return fallback;
  // No period at all means the periods were never set up (saves made before they existed): start from the defaults.
  // The admin always sends all three, so switching every period off is stored as three inactive periods.
  if (input.data.plan.cycles.length === 0) input.data.plan.cycles = fallback.plan.cycles;
  // A period saved before web prices existed (no `webPriceTRY` key at all) keeps the price and badge the web showed
  // for it until then; an explicit null stays null.
  const rawCycles = ((v.plan as { cycles?: unknown } | undefined)?.cycles ?? []) as Array<Record<string, unknown>>;
  input.data.plan.cycles = input.data.plan.cycles.map((cy, i) => {
    const raw = rawCycles[i];
    const def = DEFAULT_CYCLES.find((d) => d.cycle === cy.cycle);
    return raw && typeof raw === 'object' && !('webPriceTRY' in raw) && def ? { ...cy, webPriceTRY: def.webPriceTRY, badgeTr: def.badgeTr, badgeEn: def.badgeEn } : cy;
  });
  const retired = Array.isArray(v.retired)
    ? v.retired.filter((r): r is { productId: string; credits: number } =>
        !!r && typeof r === 'object' && typeof (r as { productId?: unknown }).productId === 'string' && Number.isInteger((r as { credits?: unknown }).credits),
      )
    : [];
  return { ...input.data, retired };
}

/** Short audit summary: what changed, without repeating the whole catalog. */
export function catalogDiff(prev: StoredCatalog, next: CatalogInput) {
  const changes: string[] = [];
  const p = prev.plan;
  const n = next.plan;
  if (p.nameTr !== n.nameTr || p.nameEn !== n.nameEn || p.taglineTr !== n.taglineTr || p.taglineEn !== n.taglineEn) changes.push('plan.texts');
  if (JSON.stringify([p.featuresTr, p.featuresEn]) !== JSON.stringify([n.featuresTr, n.featuresEn])) changes.push('plan.features');
  if (JSON.stringify(p.cycles) !== JSON.stringify(n.cycles)) changes.push('plan.cycles');
  const before = new Map(prev.packs.map((x) => [x.key, x]));
  for (const pack of next.packs) {
    const old = before.get(pack.key);
    if (!old) changes.push(`pack.added:${pack.key}`);
    else {
      if (old.credits !== pack.credits) changes.push(`pack.credits:${pack.key}:${old.credits}->${pack.credits}`);
      if (old.iosProductId !== pack.iosProductId || old.androidProductId !== pack.androidProductId) changes.push(`pack.products:${pack.key}`);
      if (old.active !== pack.active) changes.push(`pack.${pack.active ? 'activated' : 'deactivated'}:${pack.key}`);
      if (old.webPriceTRY !== pack.webPriceTRY) changes.push(`pack.web_price:${pack.key}`);
    }
    before.delete(pack.key);
  }
  for (const key of before.keys()) changes.push(`pack.removed:${key}`);
  return changes;
}

/** The paywall's view: active entries only, texts in Turkish or English. */
export function publicCatalog(c: StoredCatalog, lang: 'tr' | 'en', limits: { free: { dailyGenerations: number; maxVariants: number }; pro: { dailyGenerations: number; maxVariants: number } }) {
  const tr = lang === 'tr';
  return {
    plan: {
      name: tr ? c.plan.nameTr : c.plan.nameEn,
      tagline: tr ? c.plan.taglineTr : c.plan.taglineEn,
      features: tr ? c.plan.featuresTr : c.plan.featuresEn,
      cycles: c.plan.cycles
        .filter((cy) => cy.active)
        .sort((a, b) => CYCLES.indexOf(a.cycle) - CYCLES.indexOf(b.cycle))
        .map((cy) => ({
          cycle: cy.cycle,
          highlight: cy.highlight,
          badge: (tr ? cy.badgeTr || cy.badgeEn : cy.badgeEn || cy.badgeTr) || null,
          webPriceTRY: cy.webPriceTRY,
          productIds: { ios: cy.iosProductId, android: cy.androidProductId },
        })),
    },
    packs: c.packs
      .filter((p) => p.active)
      .map((p) => ({ key: p.key, name: tr ? p.nameTr : p.nameEn, credits: p.credits, highlight: p.highlight, webPriceTRY: p.webPriceTRY, productIds: { ios: p.iosProductId, android: p.androidProductId } })),
    limits,
  };
}

/** Badge in the visitor's language: an unchanged default badge keeps its translation in the other languages. */
function badgeFor(cy: CycleEntry, locale: Locale): string | null {
  const text = { tr: cy.badgeTr || cy.badgeEn, en: cy.badgeEn || cy.badgeTr };
  if (!text.tr) return null;
  const isDefault = DEFAULT_CYCLES.some((d) => d.cycle === cy.cycle && d.badgeEn && d.badgeEn === cy.badgeEn);
  if (locale === 'tr' || locale === 'en' || isDefault) return localize(locale, `plans.pro_${cy.cycle}.badge`, text);
  return text.en;
}

/**
 * `GET /v1/catalog` `plans` (the web pricing page and the app's paywall fallback): the periods on sale that have a web
 * price, weekly first. Same shape as before the catalog managed them (plus `highlight`).
 */
export function catalogPlans(c: StoredCatalog, locale: Locale) {
  return c.plan.cycles
    .filter((cy): cy is CycleEntry & { webPriceTRY: number } => cy.active && cy.webPriceTRY !== null)
    .sort((a, b) => CYCLES.indexOf(a.cycle) - CYCLES.indexOf(b.cycle))
    .map((cy) => ({
      id: `pro_${cy.cycle}`,
      name: localize(locale, `plans.pro_${cy.cycle}.name`, CYCLE_NAMES[cy.cycle]),
      period: PERIOD[cy.cycle],
      priceTRY: cy.webPriceTRY,
      badge: badgeFor(cy, locale),
      highlight: cy.highlight,
      storeProductId: cy.iosProductId ?? cy.androidProductId,
    }));
}

/** The web pricing page's Pro card and packs: Turkish for Turkish visitors, English for everyone else (like the app). */
export function webPricing(c: StoredCatalog, locale: Locale) {
  const tr = locale === 'tr';
  return {
    name: tr ? c.plan.nameTr : c.plan.nameEn,
    tagline: tr ? c.plan.taglineTr : c.plan.taglineEn,
    features: tr ? c.plan.featuresTr : c.plan.featuresEn,
    packs: c.packs.filter((p) => p.active).map((p) => ({ key: p.key, name: tr ? p.nameTr : p.nameEn, credits: p.credits, highlight: p.highlight, priceTRY: p.webPriceTRY })),
  };
}

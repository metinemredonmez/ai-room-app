import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { LOCALES } from '../catalog/catalog.data.js';

// Home page and FAQ from the admin (API.md §7.46; MAEYJA "İçerik → Ana sayfa / SSS", fal-app CMS). One Setting row:
// which home-page sections show, an announcement bar, and per-language overrides of the landing texts. A text that is
// not overridden keeps the site's own translation, so the public endpoint returns overrides only.
// Plain text everywhere: clients render it as text, never as HTML (WEB-01); control and bidi characters are refused
// (PRS-01); the announcement links only to our own pages (EXT-02).

export type Locale = (typeof LOCALES)[number];

/** Home-page sections the admin can hide. Hero and the final call to action always show. */
export const SECTIONS = ['gallery', 'tools', 'features', 'pro', 'how', 'styles', 'pricing', 'faq'] as const;
export type Section = (typeof SECTIONS)[number];

/** Single-line texts and their limits (about twice the longest of the 11 built-in translations). */
export const TEXT_LIMITS = {
  badge: 60,
  heroTitle: 80,
  heroText: 320,
  ctaPrimary: 30,
  ctaSecondary: 30,
  galleryTitle: 60,
  galleryText: 180,
  toolsTitle: 70,
  toolsText: 180,
  moreTools: 180,
  featuresTitle: 90,
  featuresText: 180,
  proBadge: 40,
  proTitle: 80,
  proText: 280,
  howTitle: 60,
  stylesTitle: 60,
  stylesText: 90,
  pricingTitle: 40,
  pricingText: 160,
  faqTitle: 50,
  finalTitle: 90,
  finalCta: 30,
} as const;
export type TextKey = keyof typeof TEXT_LIMITS;
export const TEXT_KEYS = Object.keys(TEXT_LIMITS) as TextKey[];

export const LIST_LIMITS = { trust: { items: 4, length: 40 }, proPoints: { items: 6, length: 90 } } as const;
export type ListKey = keyof typeof LIST_LIMITS;
export const FAQ_LIMITS = { items: 20, q: 160, a: 1000 } as const;
export const ANNOUNCEMENT_MAX = 140;

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;
const NEWLINE = /[\n\t]/;
const line = (max: number) =>
  z
    .string()
    .transform((s) => s.normalize('NFC').trim())
    .pipe(z.string().min(1).max(max))
    .refine((s) => !CONTROL.test(s) && !NEWLINE.test(s), 'control_char');
const para = (max: number) =>
  z
    .string()
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim().replace(/\n{3,}/g, '\n\n'))
    .pipe(z.string().min(1).max(max))
    .refine((s) => !CONTROL.test(s) && !/\t/.test(s), 'control_char');

/** Our own pages only; a blog article may be named by its address. */
export const LINK_RE = /^\/(studio|fiyatlar|sohbet|blog(\/[a-z0-9]+(?:-[a-z0-9]+)*)?)$/;
export const LINK_PATHS = ['/studio', '/fiyatlar', '/sohbet', '/blog'] as const;

const textShape = Object.fromEntries(TEXT_KEYS.map((k) => [k, line(TEXT_LIMITS[k]).optional()])) as { [K in TextKey]: z.ZodOptional<ReturnType<typeof line>> };

export const LocaleTextsSchema = z
  .object({
    ...textShape,
    trust: z.array(line(LIST_LIMITS.trust.length)).min(1).max(LIST_LIMITS.trust.items).optional(),
    proPoints: z.array(line(LIST_LIMITS.proPoints.length)).min(1).max(LIST_LIMITS.proPoints.items).optional(),
    faq: z
      .array(z.object({ q: line(FAQ_LIMITS.q), a: para(FAQ_LIMITS.a) }).strict())
      .min(1)
      .max(FAQ_LIMITS.items)
      .refine((items) => new Set(items.map((i) => i.q.toLocaleLowerCase())).size === items.length, 'duplicate_question')
      .optional(),
  })
  .strict();
export type LocaleTexts = z.infer<typeof LocaleTextsSchema>;

const localeEnum = z.enum(LOCALES);

export const AnnouncementSchema = z
  .object({
    enabled: z.boolean(),
    tone: z.enum(['info', 'promo', 'warning']),
    link: z.string().max(100).regex(LINK_RE).nullable(),
    text: z.partialRecord(localeEnum, line(ANNOUNCEMENT_MAX)),
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    endsAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine((a) => !a.enabled || Object.keys(a.text).length > 0, 'announcement_empty')
  .refine((a) => !a.startsAt || !a.endsAt || Date.parse(a.endsAt) > Date.parse(a.startsAt), 'announcement_window');
export type Announcement = z.infer<typeof AnnouncementSchema>;

export const SiteContentSchema = z
  .object({
    sections: z.object(Object.fromEntries(SECTIONS.map((s) => [s, z.boolean()])) as Record<Section, z.ZodBoolean>).strict(),
    announcement: AnnouncementSchema,
    texts: z.partialRecord(localeEnum, LocaleTextsSchema),
  })
  .strict();
export type SiteContent = z.infer<typeof SiteContentSchema>;

export const DEFAULT_CONTENT: SiteContent = {
  sections: Object.fromEntries(SECTIONS.map((s) => [s, true])) as Record<Section, boolean>,
  announcement: { enabled: false, tone: 'info', link: null, text: {}, startsAt: null, endsAt: null },
  texts: {},
};

/** A language with nothing overridden is dropped, so "customised" means something is really there. */
export function compact(c: SiteContent): SiteContent {
  const texts: SiteContent['texts'] = {};
  for (const l of LOCALES) {
    const t = c.texts[l];
    if (t && Object.values(t).some((v) => v !== undefined)) texts[l] = t;
  }
  return { ...c, texts };
}

export function parseContent(value: unknown): { content: SiteContent; ok: boolean } {
  if (value === undefined || value === null) return { content: DEFAULT_CONTENT, ok: true };
  const r = SiteContentSchema.safeParse(value);
  return r.success ? { content: compact(r.data), ok: true } : { content: DEFAULT_CONTENT, ok: false };
}

/** What a visitor in `locale` sees: the announcement only inside its window, in that language or else English. */
export function publicContent(c: SiteContent, locale: Locale, now = new Date()) {
  const a = c.announcement;
  const live = a.enabled && (!a.startsAt || Date.parse(a.startsAt) <= now.getTime()) && (!a.endsAt || Date.parse(a.endsAt) > now.getTime());
  const text = live ? (a.text[locale] ?? a.text.en) : undefined;
  return {
    sections: c.sections,
    announcement: text ? { text, tone: a.tone, link: a.link } : null,
    texts: c.texts[locale] ?? {},
  };
}

/** Audit summary: which parts changed, never the texts themselves. */
export function contentDiff(prev: SiteContent, next: SiteContent): string[] {
  const out: string[] = [];
  for (const s of SECTIONS) if (prev.sections[s] !== next.sections[s]) out.push(`bölüm ${s}: ${prev.sections[s] ? 'açık' : 'kapalı'} → ${next.sections[s] ? 'açık' : 'kapalı'}`);
  if (JSON.stringify(prev.announcement) !== JSON.stringify(next.announcement)) out.push(`duyuru: ${prev.announcement.enabled ? 'açık' : 'kapalı'} → ${next.announcement.enabled ? 'açık' : 'kapalı'}`);
  for (const l of LOCALES) {
    const a = prev.texts[l] ?? {};
    const b = next.texts[l] ?? {};
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k as keyof LocaleTexts]) !== JSON.stringify(b[k as keyof LocaleTexts]));
    if (keys.length) out.push(`${l}: ${keys.sort().join(', ')}`);
  }
  return out;
}

// ---- the site's own texts, shown in the admin as the starting point ----

export type DefaultTexts = Required<Pick<LocaleTexts, TextKey | ListKey | 'faq'>>;

/** Generated from apps/web/src/messages by scripts/landing-defaults.mjs; a unit test keeps the two in step. */
export function loadDefaults(): Partial<Record<Locale, DefaultTexts>> {
  try {
    const file = fileURLToPath(new URL('../../assets/site/landing-defaults.json', import.meta.url));
    return JSON.parse(readFileSync(file, 'utf8')) as Partial<Record<Locale, DefaultTexts>>;
  } catch {
    return {};
  }
}

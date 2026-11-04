import { z } from 'zod';
import { LOCALES, ROOMS, TOOLS, TOOL_IDS, type Locale } from '../catalog/catalog.data.js';
import { localize } from '../catalog/catalog.i18n.js';

// Admin "Pazarlama" (API.md §7.18): store listing (ASO) drafts. Pure rules here; the service does the I/O.

/** App Store Connect and Google Play Console limits, in characters. The AI service checks the same numbers. */
export const ASO_LIMITS = {
  app_name: 30,
  app_subtitle: 30,
  app_keywords: 100,
  app_promo: 170,
  app_description: 4000,
  app_whats_new: 4000,
  play_title: 30,
  play_short: 80,
  play_description: 4000,
} as const;
export type AsoField = keyof typeof ASO_LIMITS;
export const ASO_FIELDS = Object.keys(ASO_LIMITS) as AsoField[];

const field = (max: number) => z.string().trim().min(1).max(max);
/** An edited listing must fit the stores: they would reject it anyway. */
export const AsoListingSchema = z
  .object(Object.fromEntries(ASO_FIELDS.map((k) => [k, field(ASO_LIMITS[k])])) as { [K in AsoField]: z.ZodString })
  .strict();
export type AsoListing = z.infer<typeof AsoListingSchema>;

export const AsoRunSchema = z
  .object({
    locales: z.array(z.enum(LOCALES)).min(1).max(LOCALES.length).transform((l) => [...new Set(l)]),
    brief: z.string().trim().max(1000).optional(),
    whatsNew: z.string().trim().max(1000).optional(),
  })
  .strict();
export type AsoRun = z.infer<typeof AsoRunSchema>;

/** App Store Connect locale codes (EAS Metadata `apple.info` keys). */
export const APPLE_LOCALES: Record<Locale, string> = {
  tr: 'tr', en: 'en-US', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it', ru: 'ru', nl: 'nl-NL', ja: 'ja', ko: 'ko', zh: 'zh-Hans',
};
/** Google Play Console locale codes. */
export const PLAY_LOCALES: Record<Locale, string> = {
  tr: 'tr-TR', en: 'en-US', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', ru: 'ru-RU', nl: 'nl-NL', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN',
};

/**
 * The facts the copywriter may use. Built from the live catalog and settings, so the listing never promises a
 * tool, style or limit the app doesn't have. Prices are left out on purpose (they differ per store country).
 * Tool, style and room names are the ones the app shows in that language, so the listing matches the screens.
 */
export function buildFacts(o: {
  locale: Locale;
  styles: Array<{ id: string; nameTr: string; nameEn: string; isPro: boolean }>;
  freeDaily: number;
  maxVariantsFree: number;
}): string {
  const tools = TOOL_IDS.map((id) => {
    const name = localize(o.locale, `tools.${id}.name`, TOOLS[id].name);
    return `- ${name}${TOOLS[id].isPro ? ' (PRO)' : ''}: ${TOOLS[id].description.en}`;
  });
  const styles = o.styles
    .map((s) => `${localize(o.locale, `styles.${s.id}.name`, { tr: s.nameTr, en: s.nameEn })}${s.isPro ? ' (PRO)' : ''}`)
    .join(', ');
  const rooms = Object.entries(ROOMS).map(([id, r]) => localize(o.locale, `rooms.${id}.name`, r.name)).join(', ');
  return [
    'Tool, style and room names below are written exactly as the app shows them in the target language: use them as they are.',
    '',
    'Product: Casalume — AI interior, exterior and garden redesign. Apps for iPhone and Android, and the web site casalume.app.',
    'Made in Turkey: Turkish and Anatolian styles alongside international ones. The app and the web site are available in 11 languages: Turkish, English, German, Spanish, French, Italian, Russian, Dutch, Japanese, Korean and Simplified Chinese.',
    '',
    'What makes it different:',
    '- Object-level editing: tap one or more objects in the room photo (a cushion, an armchair, a wall, the floor) and change only those. Everything outside the selection stays exactly as in the original photo.',
    '- Whole-room redesign in a chosen style is available too.',
    '',
    'Tools:',
    ...tools,
    '',
    `Styles (${o.styles.length}): ${styles}.`,
    `Rooms: ${rooms}.`,
    '',
    'Also:',
    `- Take a photo, upload one or start from a sample room; up to ${o.maxVariantsFree} variants per design on the free plan; before/after comparison; save and download the results.`,
    '- Cost analysis of a design: a shopping list with price ranges in Turkish lira from Turkish stores, plus renovation estimates (paint, flooring, lighting). Mainly useful in Turkey.',
    "- An AI design assistant chat that answers in the user's language and suggests designs to generate.",
    '',
    `Plans (never quote prices): a free plan with ${o.freeDaily} free designs a day; PRO subscription (weekly, monthly or yearly) unlocks the PRO tools and styles and more variants per design; credit packs can be bought too.`,
    'Accounts: use it without an account first; Sign in with Apple, Google or e-mail.',
    'Privacy: photos are processed only to create the design; the account and its data can be deleted in the app; compliant with KVKK, the Turkish data protection law.',
  ].join('\n');
}

/** EAS Metadata (`eas metadata:push`) store.config.json for the App Store, from the approved listings. */
export function storeConfig(listings: Partial<Record<Locale, AsoListing>>) {
  const info: Record<string, unknown> = {};
  for (const locale of LOCALES) {
    const l = listings[locale];
    if (!l) continue;
    info[APPLE_LOCALES[locale]] = {
      title: l.app_name,
      subtitle: l.app_subtitle,
      description: l.app_description,
      keywords: l.app_keywords.split(',').map((k) => k.trim()).filter(Boolean),
      releaseNotes: l.app_whats_new,
      promoText: l.app_promo,
    };
  }
  return { configVersion: 0, apple: { info } };
}

/** Google Play has no metadata file here: one block per language, ready to paste into the Play Console. */
export function playListings(listings: Partial<Record<Locale, AsoListing>>) {
  const out: Record<string, { title: string; shortDescription: string; fullDescription: string; releaseNotes: string }> = {};
  for (const locale of LOCALES) {
    const l = listings[locale];
    if (!l) continue;
    out[PLAY_LOCALES[locale]] = { title: l.play_title, shortDescription: l.play_short, fullDescription: l.play_description, releaseNotes: l.app_whats_new };
  }
  return out;
}

/** Fields over the store limit (shown in red in the admin; such a draft can't be approved). */
export function violationsOf(output: Record<string, unknown>): AsoField[] {
  return ASO_FIELDS.filter((k) => typeof output[k] !== 'string' || (output[k] as string).length > ASO_LIMITS[k]);
}

// --------------------------------------------------------------------------------------------- social posts

export const PLATFORMS = ['instagram', 'tiktok', 'pinterest'] as const;
export type Platform = (typeof PLATFORMS)[number];
/** Same numbers as the AI service; hashtags are capped at 5 (Instagram's limit since 2025). */
export const SOCIAL_LIMITS: Record<Platform, { title: number; caption: number; alt_text: number }> = {
  instagram: { title: 100, caption: 2200, alt_text: 250 },
  tiktok: { title: 100, caption: 2200, alt_text: 250 },
  pinterest: { title: 100, caption: 500, alt_text: 250 },
};
export const HASHTAGS_MAX = 5;
const HASHTAG = /^[\p{L}\p{N}_]{1,40}$/u;

export const socialPostSchema = (platform: Platform) =>
  z
    .object({
      title: field(SOCIAL_LIMITS[platform].title),
      caption: field(SOCIAL_LIMITS[platform].caption),
      hashtags: z.array(z.string().regex(HASHTAG, 'Etiket: harf, rakam ya da _; # ve boşluk yok')).max(HASHTAGS_MAX),
      alt_text: field(SOCIAL_LIMITS[platform].alt_text),
    })
    .strict();
export type SocialPost = z.infer<ReturnType<typeof socialPostSchema>>;

const uniq = <T,>(a: T[]) => [...new Set(a)];
/** One draft per style × platform × language; at most 30 per run (≈1 $). */
export const SOCIAL_RUN_MAX = 30;
export const SocialRunSchema = z
  .object({
    styleIds: z.array(z.string().regex(/^[a-z_]{2,40}$/)).min(1).max(5).transform(uniq),
    platforms: z.array(z.enum(PLATFORMS)).min(1).max(PLATFORMS.length).transform(uniq),
    locales: z.array(z.enum(LOCALES)).min(1).max(LOCALES.length).transform(uniq),
    brief: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((r) => r.styleIds.length * r.platforms.length * r.locales.length <= SOCIAL_RUN_MAX, {
    message: `Bir seferde en çok ${SOCIAL_RUN_MAX} gönderi (stil × platform × dil)`,
  });
export type SocialRun = z.infer<typeof SocialRunSchema>;

export function socialViolations(platform: Platform, post: Record<string, unknown>): string[] {
  const lim = SOCIAL_LIMITS[platform];
  const out = (['title', 'caption', 'alt_text'] as const).filter((k) => typeof post[k] !== 'string' || (post[k] as string).length > lim[k]);
  const tags = post.hashtags;
  return Array.isArray(tags) && tags.length <= HASHTAGS_MAX ? out : [...out, 'hashtags'];
}

// ------------------------------------------------------------------------------------------------ campaigns

export const CAMPAIGN_LIMITS = { PUSH: { title: 50, body: 300 }, EMAIL: { title: 80, body: 2000 } } as const;
export type Channel = keyof typeof CAMPAIGN_LIMITS;

export const CampaignRunSchema = z
  .object({
    locales: z.array(z.enum(LOCALES)).min(1).max(LOCALES.length).transform(uniq),
    channel: z.enum(['PUSH', 'EMAIL']),
    kind: z.enum(['SERVICE', 'MARKETING']),
    goal: z.string().trim().min(5).max(1000),
  })
  .strict();
export type CampaignRun = z.infer<typeof CampaignRunSchema>;

export const campaignSchema = (channel: Channel, links: readonly string[]) =>
  z
    .object({
      title: z.string().trim().min(3).max(CAMPAIGN_LIMITS[channel].title),
      body: z.string().trim().min(5).max(CAMPAIGN_LIMITS[channel].body),
      link: z.string().refine((l) => links.includes(l), 'Yalnız uygulama içi bağlantı').nullable(),
    })
    .strict();
export type CampaignText = z.infer<ReturnType<typeof campaignSchema>>;

export function campaignViolations(channel: Channel, msg: Record<string, unknown>): string[] {
  const lim = CAMPAIGN_LIMITS[channel];
  return (['title', 'body'] as const).filter((k) => typeof msg[k] !== 'string' || (msg[k] as string).length > lim[k]);
}

// -------------------------------------------------------------------------------------------- blog and SEO

/** In-site paths an article may link to; the web renders any other link as plain text. */
export const BLOG_LINKS = ['/studio', '/fiyatlar', '/sohbet', '/blog'] as const;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BLOG_LIMITS = { title: 70, description: 160, slug: 80, body: 30000 } as const;

export const blogArticleSchema = z
  .object({
    title: z.string().trim().min(5).max(BLOG_LIMITS.title),
    description: z.string().trim().min(50).max(BLOG_LIMITS.description),
    slug: z.string().trim().max(BLOG_LIMITS.slug).regex(SLUG_RE, 'Küçük harf, rakam ve tire'),
    body: z.string().trim().min(200).max(BLOG_LIMITS.body),
  })
  .strict();
export type BlogArticle = z.infer<typeof blogArticleSchema>;

export function blogViolations(a: Record<string, unknown>): string[] {
  const r = blogArticleSchema.safeParse(a);
  return r.success ? [] : [...new Set(r.error.issues.map((i) => String(i.path[0] ?? 'body')))];
}

export const BlogRunSchema = z
  .object({
    topic: z.string().trim().min(5).max(300),
    keywords: z.string().trim().max(300).optional(),
    locale: z.enum(LOCALES).default('tr'),
    styleId: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  })
  .strict();
export type BlogRun = z.infer<typeof BlogRunSchema>;

export const BlogTranslateSchema = z
  .object({ postId: z.uuid(), locales: z.array(z.enum(LOCALES)).min(1).max(LOCALES.length).transform(uniq) })
  .strict();
export type BlogTranslate = z.infer<typeof BlogTranslateSchema>;

/** Indexable pages whose <title> and meta description the SEO agent proposes (web keys in lib/page-meta.ts). */
export const SEO_PAGES = [
  { key: 'home', path: '/', purpose: 'Landing page: AI interior, exterior and garden redesign from a photo; tap one object and change only it.' },
  { key: 'studio', path: '/studio', purpose: 'The design studio: upload a room photo, pick a tool and a style, get the redesign in seconds.' },
  { key: 'pricing', path: '/fiyatlar', purpose: 'Plans: free daily designs, PRO subscription and credit packs (no prices in the text).' },
  { key: 'chat', path: '/sohbet', purpose: 'AI interior design assistant chat that answers in your language and suggests designs.' },
  { key: 'blog', path: '/blog', purpose: 'Interior design articles: ideas, colours, small spaces, styles.' },
] as const;
export const SEO_KEYS = SEO_PAGES.map((p) => p.key) as unknown as readonly [string, ...string[]];
export const SEO_LIMITS = { title: 60, description: 160 } as const;

export const SeoRunSchema = z.object({ locales: z.array(z.enum(LOCALES)).min(1).max(LOCALES.length).transform(uniq) }).strict();
export const seoSchema = z
  .object({
    pages: z
      .array(
        z
          .object({
            key: z.enum(SEO_KEYS),
            title: z.string().trim().min(5).max(SEO_LIMITS.title),
            description: z.string().trim().min(50).max(SEO_LIMITS.description),
          })
          .strict(),
      )
      .min(1)
      .max(SEO_PAGES.length),
  })
  .strict();
export type SeoOutput = z.infer<typeof seoSchema>;

export function seoViolations(o: { pages?: Array<{ key: string; title: string; description: string }> }): string[] {
  const out: string[] = [];
  for (const p of o.pages ?? []) {
    if (p.title.length > SEO_LIMITS.title) out.push(`${p.key}.title`);
    if (p.description.length > SEO_LIMITS.description) out.push(`${p.key}.description`);
  }
  return out;
}

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

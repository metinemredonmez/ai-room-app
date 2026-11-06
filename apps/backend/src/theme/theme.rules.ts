import { z } from 'zod';

// Colour themes managed from the admin (API.md §7.34). A palette is six tones, darkest to lightest (the swatch the
// owner picks, e.g. #211713 … #F6EEDB), plus the eleven colour tokens the web and the app paint with. New palettes get
// their tokens from the tones by `deriveTokens`; the four original themes keep their hand-tuned tokens. Contrast is
// checked on every save: text, secondary text, filled buttons and primary-coloured text must reach 4.5:1 (WCAG AA) or
// the palette cannot be switched on. The accent colour plays two roles (behind dark text, and as small coloured text),
// so its checks are warnings only.
//
// Values end up inside a <style> element on the web, so the schema admits nothing but `#rrggbb` colours and
// slug-shaped ids (INP-01 / WEB-01: no CSS or markup can be smuggled through a theme).

export const TOKEN_KEYS = ['primary', 'primaryStrong', 'primarySoft', 'accent', 'accentSoft', 'bg', 'surface', 'surface2', 'text', 'muted', 'border'] as const;
export type TokenKey = (typeof TOKEN_KEYS)[number];
export type Tokens = Record<TokenKey, string>;

export const HEX = /^#[0-9a-f]{6}$/;
export const PALETTE_ID = /^[a-z][a-z0-9-]{1,23}$/;
export const MAX_PALETTES = 48;

const Hex = z.string().trim().toLowerCase().regex(HEX);
export const TonesSchema = z.array(Hex).length(6);
const TokensSchema = z.object(Object.fromEntries(TOKEN_KEYS.map((k) => [k, Hex])) as Record<TokenKey, typeof Hex>).strict();

export const PaletteSchema = z
  .object({
    id: z.string().regex(PALETTE_ID),
    name: z.object({ tr: z.string().trim().min(1).max(30), en: z.string().trim().min(1).max(30) }).strict(),
    tones: TonesSchema,
    tokens: TokensSchema,
    enabled: z.boolean(),
  })
  .strict();
export type Palette = z.infer<typeof PaletteSchema>;

export const ThemeSchema = z
  .object({
    defaultId: z.string().regex(PALETTE_ID),
    palettes: z.array(PaletteSchema).min(1).max(MAX_PALETTES),
    /** Built-in ids this saved set already knew: a built-in added later is offered once, a deleted one stays deleted. */
    seen: z.array(z.string().regex(PALETTE_ID)).max(100).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = v.palettes.map((p) => p.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'duplicate_id' });
    const def = v.palettes.find((p) => p.id === v.defaultId);
    if (!def) ctx.addIssue({ code: 'custom', message: 'default_missing' });
    else if (!def.enabled) ctx.addIssue({ code: 'custom', message: 'default_disabled' });
  });
export type Theme = z.infer<typeof ThemeSchema>;

// ---- colour maths (sRGB, WCAG 2 relative luminance) ----

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c: number[]) => `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a: string, b: string, t: number) => {
  const A = rgb(a);
  const B = rgb(b);
  return hex(A.map((x, i) => x * (1 - t) + B[i] * t));
};
const luminance = (h: string) => {
  const [r, g, b] = rgb(h).map((x) => {
    const c = x / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = '#ffffff';

/** Tokens for a light theme from six tones (darkest → lightest). Every pick is checked against its background. */
export function deriveTokens(tones: string[]): Tokens {
  const [t0, t1, t2, t3, t4, t5] = tones.map((t) => t.toLowerCase());
  const bg = mix(t5, WHITE, 0.45);
  const surface = mix(t5, WHITE, 0.85);
  const surface2 = mix(t5, t4, 0.25);
  const primarySoft = mix(t5, WHITE, 0.15);
  const accentSoft = mix(t5, WHITE, 0.3);
  const text = t0;
  const first = (candidates: string[], ok: (c: string) => boolean) => candidates.find(ok) ?? candidates[candidates.length - 1];
  const muted = first([t2, mix(t1, t2, 0.5), t1], (c) => Math.min(contrast(c, bg), contrast(c, surface)) >= 4.6);
  const primary = first([t3, mix(t2, t3, 0.5), t2, mix(t1, t2, 0.5), t1], (c) => Math.min(contrast(WHITE, c), contrast(c, bg), contrast(c, primarySoft)) >= 4.6);
  const primaryStrong = mix(primary, t0, 0.3);
  // Accent sits behind dark text (accent button) and is also small coloured text on light surfaces: take the tone
  // between t2 and t4 that best satisfies both.
  const ramp = [0, 0.25, 0.5, 0.75, 1].map((i) => mix(t2, t3, i)).concat([0.25, 0.5, 0.75, 1].map((i) => mix(t3, t4, i)));
  const score = (c: string) => Math.min(contrast(text, c) / 4.5, contrast(c, surface) / 3, contrast(c, accentSoft) / 3);
  const accent = ramp.reduce((best, c) => (score(c) > score(best) ? c : best));
  const border = mix(t4, t5, 0.5);
  return { primary, primaryStrong, primarySoft, accent, accentSoft, bg, surface, surface2, text, muted, border };
}

export type ContrastCheck = { pair: string; ratio: number; min: number };

const BLOCKING: Array<[string, TokenKey | 'white', TokenKey]> = [
  ['Metin / sayfa', 'text', 'bg'],
  ['Metin / kart', 'text', 'surface'],
  ['Metin / ikinci zemin', 'text', 'surface2'],
  ['Metin / açık vurgu kutusu', 'text', 'primarySoft'],
  ['İkincil metin / sayfa', 'muted', 'bg'],
  ['İkincil metin / kart', 'muted', 'surface'],
  ['Buton yazısı / ana renk', 'white', 'primary'],
  ['Buton yazısı / koyu ana renk', 'white', 'primaryStrong'],
  ['Ana renk yazı / sayfa', 'primary', 'bg'],
  ['Ana renk yazı / kart', 'primary', 'surface'],
  ['Ana renk yazı / açık vurgu kutusu', 'primary', 'primarySoft'],
];
const WARNINGS: Array<[string, TokenKey, TokenKey, number]> = [
  ['Vurgu yazı / kart', 'accent', 'surface', 3],
  ['Metin / vurgu butonu', 'text', 'accent', 4.5],
  ['Vurgu yazı / açık vurgu rozeti', 'accent', 'accentSoft', 3],
];

const round = (n: number) => Math.round(n * 100) / 100;

/** Failing pairs only. `blocking` must be empty for a palette to be switched on. */
export function contrastReport(tokens: Tokens): { blocking: ContrastCheck[]; warnings: ContrastCheck[] } {
  const color = (k: TokenKey | 'white') => (k === 'white' ? WHITE : tokens[k]);
  const blocking = BLOCKING.map(([pair, a, b]) => ({ pair, ratio: round(contrast(color(a), color(b))), min: 4.5 })).filter((c) => c.ratio < c.min);
  const warnings = WARNINGS.map(([pair, a, b, min]) => ({ pair, ratio: round(contrast(tokens[a], tokens[b])), min })).filter((c) => c.ratio < c.min);
  return { blocking, warnings };
}

// ---- built-in palettes ----

const handTuned = (id: string, tr: string, en: string, tokens: Tokens): Palette => ({
  id,
  name: { tr, en },
  // Swatch for the hand-tuned themes, darkest → lightest.
  tones: [tokens.text, tokens.primaryStrong, tokens.primary, tokens.accent, tokens.surface2, tokens.bg],
  tokens,
  enabled: true,
});
const fromTones = (id: string, tr: string, en: string, tones: string[]): Palette => {
  const t = tones.map((x) => x.toLowerCase());
  return { id, name: { tr, en }, tones: t, tokens: deriveTokens(t), enabled: true };
};

/**
 * The default theme set: the four original themes (Kil is the brand default), the eight reference palettes and the
 * owner's palette library (~/Desktop/renk-paletlerim/palet-kutuphanesi, 6 Nov 2026: 24 palettes built with the same
 * OKLCH formula). Ids of palettes already shipped never change, so a visitor's saved choice keeps working.
 */
export const BUILTIN_THEME: Theme = {
  defaultId: 'kil',
  palettes: [
    handTuned('kil', 'Kil', 'Clay', { primary: '#a9532e', primaryStrong: '#8e4424', primarySoft: '#f8ece4', accent: '#c9673e', accentSoft: '#f6e3d6', bg: '#f6f1ea', surface: '#ffffff', surface2: '#efe7dc', text: '#1c1714', muted: '#6e655e', border: '#e7ddd1' }),
    // primarySoft lifted from #f3ecdd so brass-coloured text on it reaches 4.5:1.
    handTuned('pirinc', 'Pirinç', 'Brass', { primary: '#8a6a2f', primaryStrong: '#725724', primarySoft: '#f8f4eb', accent: '#c8a46a', accentSoft: '#f2e8d4', bg: '#f7f4ee', surface: '#ffffff', surface2: '#eee8db', text: '#161513', muted: '#6b655b', border: '#e6dfd1' }),
    handTuned('murekkep', 'Mürekkep', 'Ink', { primary: '#24406e', primaryStrong: '#1a3157', primarySoft: '#e6edf7', accent: '#e08a3c', accentSoft: '#fbeadb', bg: '#f4f6f9', surface: '#ffffff', surface2: '#e8edf3', text: '#141a26', muted: '#5f6878', border: '#dde3ec' }),
    handTuned('erik', 'Erik', 'Plum', { primary: '#7a3e63', primaryStrong: '#63304f', primarySoft: '#f5e9ef', accent: '#c27c8a', accentSoft: '#f6e6ea', bg: '#f8f3f4', surface: '#ffffff', surface2: '#efe5e8', text: '#22171d', muted: '#6c5f66', border: '#eadde2' }),
    fromTones('kahve', 'Karamel Krem', 'Toffee Cream', ['#211713', '#493126', '#78533B', '#B18A62', '#E0C58E', '#F6EEDB']),
    fromTones('tarcin', 'Kakao Latte', 'Cocoa Latte', ['#211713', '#493027', '#76503B', '#A87557', '#D0A98B', '#F0DFCE']),
    fromTones('gul-kurusu', 'Leylak Alacakaranlık', 'Mauve Dusk', ['#3E3239', '#6B5560', '#9E8189', '#C7A9A3', '#E8D2C4', '#F7EFE7']),
    fromTones('visne', 'Kara Kiraz', 'Cherry Noir', ['#1D1015', '#421B29', '#702B40', '#A64C61', '#D28B96', '#F1DDE0']),
    fromTones('lavanta', 'Mürdüm Kadife', 'Plum Velvet', ['#17121D', '#302538', '#51405F', '#796487', '#B09BB8', '#E8DDEB']),
    fromTones('orman', 'Orman Sisi', 'Forest Mist', ['#051F20', '#0B2B26', '#163832', '#235347', '#8EB69B', '#DAF1DE']),
    fromTones('petrol', 'Derin Petrol', 'Deep Teal', ['#071C27', '#123747', '#245568', '#477C8B', '#91B3B9', '#DCE9E8']),
    fromTones('arduvaz', 'Gece Arduvazı', 'Slate Midnight', ['#06141B', '#11212D', '#253745', '#4A5C6A', '#9BA8AB', '#CCD0CF']),
    // The owner's palette library.
    fromTones('ocean-ink', 'Okyanus Mürekkebi', 'Ocean Ink', ['#0D1722', '#1A2D41', '#2B4A69', '#4D759B', '#8CAFCF', '#D9E7F2']),
    fromTones('indigo-night', 'Çivit Gece', 'Indigo Night', ['#121524', '#242945', '#3D446E', '#656DA3', '#A1A7D6', '#E1E3F5']),
    fromTones('navy-steel', 'Lacivert Çelik', 'Navy Steel', ['#10171E', '#1F2D3A', '#344A5D', '#58768D', '#94AFC2', '#DCE6ED']),
    fromTones('arctic-frost', 'Kutup Ayazı', 'Arctic Frost', ['#10171A', '#1F2E32', '#354C52', '#5A777D', '#97B0B3', '#DDE7E7']),
    fromTones('peacock', 'Tavus', 'Peacock', ['#041A1E', '#023239', '#03515C', '#227F8C', '#76B7C1', '#D3E9EC']),
    fromTones('lagoon', 'Lagün', 'Lagoon', ['#071A19', '#0C3231', '#165250', '#397F7B', '#82B7B2', '#D7E9E7']),
    fromTones('emerald-depth', 'Zümrüt Derinlik', 'Emerald Depth', ['#081A13', '#103325', '#1E533D', '#428063', '#88B89D', '#D9E9DF']),
    fromTones('moss-stone', 'Yosun Taşı', 'Moss Stone', ['#12180F', '#232F1D', '#3B4E33', '#607A58', '#9BB396', '#DFE8DD']),
    fromTones('sage-linen', 'Adaçayı Keten', 'Sage Linen', ['#131813', '#252E25', '#3D4C3F', '#647867', '#9FB0A2', '#E0E7E1']),
    fromTones('olive-grove', 'Zeytinlik', 'Olive Grove', ['#16170B', '#2B2D16', '#474B27', '#707649', '#A8B08A', '#E3E6D9']),
    fromTones('saffron', 'Safran', 'Saffron', ['#1D1503', '#382901', '#5B4401', '#8A6E1F', '#BFA96F', '#EBE4D0']),
    fromTones('amber-glow', 'Kehribar', 'Amber Glow', ['#211203', '#3F2500', '#643F01', '#96671D', '#C8A46D', '#EFE3CF']),
    fromTones('rust-copper', 'Bakır Pas', 'Rust Copper', ['#241007', '#451F0A', '#6F3611', '#A35D2E', '#D69D74', '#F5E0D1']),
    fromTones('terracotta', 'Terakota', 'Terracotta', ['#23100B', '#432015', '#6C3724', '#9F5E42', '#D39D81', '#F4E0D5']),
    fromTones('ember', 'Kor', 'Ember', ['#270D09', '#4B1911', '#782C1C', '#B05138', '#E39479', '#FBDDD2']),
    fromTones('burgundy', 'Bordo', 'Burgundy', ['#250E0F', '#471C1E', '#723032', '#A85555', '#DD9591', '#F9DDDB']),
    fromTones('rose-quartz', 'Pembe Kuvars', 'Rose Quartz', ['#201114', '#3D2226', '#643A3E', '#966163', '#CC9D9B', '#F2E0DE']),
    fromTones('orchid-bloom', 'Orkide', 'Orchid Bloom', ['#1E111C', '#3A2137', '#5E3859', '#905E86', '#C79BBB', '#F0DFEA']),
    fromTones('lavender-haze', 'Lavanta Pusu', 'Lavender Haze', ['#17141F', '#2D283B', '#4B4260', '#776A90', '#B1A4C4', '#E7E2EE']),
    fromTones('ink-violet', 'Mor Mürekkep', 'Ink Violet', ['#15151E', '#2A293A', '#46445E', '#6F6D8E', '#A9A7C3', '#E4E3EE']),
    fromTones('espresso', 'Espresso', 'Espresso', ['#1B1410', '#352820', '#564336', '#846C5B', '#BAA797', '#EAE3DD']),
    fromTones('sand-dune', 'Kum Tepesi', 'Sand Dune', ['#1A150D', '#332A1A', '#53462D', '#806F50', '#B7A98F', '#E9E4DA']),
    fromTones('warm-stone', 'Sıcak Taş', 'Warm Stone', ['#171614', '#2E2B27', '#4C4741', '#777069', '#AFAAA3', '#E6E4E2']),
    fromTones('graphite', 'Grafit', 'Graphite', ['#151618', '#2A2B2E', '#45484C', '#6E7278', '#A8ABB0', '#E3E4E6']),
  ],
};

/** Stored row → theme. Junk (or a palette that no longer passes) falls back to the built-in set. */
export function parseTheme(value: unknown): { theme: Theme; ok: boolean } {
  if (value === undefined || value === null) return { theme: BUILTIN_THEME, ok: true };
  const r = ThemeSchema.safeParse(value);
  if (!r.success) return { theme: BUILTIN_THEME, ok: false };
  if (r.data.palettes.some((p) => p.enabled && contrastReport(p.tokens).blocking.length)) return { theme: BUILTIN_THEME, ok: false };
  return { theme: withNewBuiltins(r.data), ok: true };
}

/** A saved set gets the built-ins added since it was saved (switched on); built-ins it already knew stay as saved. */
export function withNewBuiltins(theme: Theme): Theme {
  const known = new Set([...(theme.seen ?? []), ...theme.palettes.map((p) => p.id)]);
  const added = BUILTIN_THEME.palettes.filter((p) => !known.has(p.id));
  if (!added.length) return theme;
  return { ...theme, palettes: [...theme.palettes, ...added].slice(0, MAX_PALETTES) };
}

/** What a save stores: the set plus the built-in ids it now knows. */
export function toStored(theme: Theme): Theme {
  return { defaultId: theme.defaultId, palettes: theme.palettes, seen: BUILTIN_THEME.palettes.map((p) => p.id) };
}

/** What the clients get: enabled palettes only, default first. */
export function publicTheme(theme: Theme) {
  const enabled = theme.palettes.filter((p) => p.enabled);
  enabled.sort((a, b) => Number(b.id === theme.defaultId) - Number(a.id === theme.defaultId));
  return { defaultId: theme.defaultId, palettes: enabled.map(({ id, name, tones, tokens }) => ({ id, name, tones, tokens })) };
}

/** Human-readable change list for the audit log. */
export function themeDiff(prev: Theme, next: Theme): string[] {
  const out: string[] = [];
  if (prev.defaultId !== next.defaultId) out.push(`varsayılan: ${prev.defaultId} → ${next.defaultId}`);
  const before = new Map(prev.palettes.map((p) => [p.id, p]));
  const after = new Map(next.palettes.map((p) => [p.id, p]));
  for (const [id, p] of after) {
    const b = before.get(id);
    if (!b) out.push(`eklendi: ${id}${p.enabled ? '' : ' (kapalı)'}`);
    else {
      if (b.enabled !== p.enabled) out.push(`${id}: ${p.enabled ? 'açıldı' : 'kapandı'}`);
      if (JSON.stringify(b.tokens) !== JSON.stringify(p.tokens) || JSON.stringify(b.tones) !== JSON.stringify(p.tones)) out.push(`${id}: renkler değişti`);
      if (b.name.tr !== p.name.tr || b.name.en !== p.name.en) out.push(`${id}: ad değişti`);
    }
  }
  for (const id of before.keys()) if (!after.has(id)) out.push(`silindi: ${id}`);
  const order = (t: Theme) => t.palettes.map((p) => p.id).join(',');
  if (!out.length && order(prev) !== order(next)) out.push('sıra değişti');
  return out;
}

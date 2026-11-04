import type tr from "@/messages/tr.json";

// Languages (maeyja's set). Turkish is the source and keeps the unprefixed URLs (/studio); every other language
// lives under its prefix (/en/studio). Messages are JSON files in src/messages, one per language; Turkish is the
// source of truth and `npm run i18n:fill` translates missing keys into the others.

export const LOCALES = ["tr", "en", "de", "es", "fr", "it", "ru", "nl", "ja", "ko", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "tr";

/** Native names for the language menu. */
export const LOCALE_LABELS: Record<Locale, string> = {
  tr: "Türkçe",
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  ru: "Русский",
  nl: "Nederlands",
  ja: "日本語",
  ko: "한국어",
  zh: "中文",
};

/** BCP 47 tags for <html lang>, hreflang and Intl formatting. */
export const LOCALE_TAGS: Record<Locale, string> = {
  tr: "tr-TR", en: "en", de: "de", es: "es", fr: "fr", it: "it", ru: "ru", nl: "nl", ja: "ja", ko: "ko", zh: "zh-CN",
};

/** Cookie remembering the visitor's language; the BFF also forwards it to the backend as Accept-Language. */
export const LOCALE_COOKIE = "air_locale";

export type Dict = typeof tr;

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** Fills `{name}` placeholders: fmt(t.studio.cost, { n: 2 }). Unknown placeholders stay visible. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** The URL of an in-app path in a language: /studio → /en/studio (Turkish stays unprefixed). */
export function localePath(locale: Locale, path: string): string {
  if (!path.startsWith("/") || path.startsWith("/api/") || path.startsWith("//")) return path;
  if (locale === DEFAULT_LOCALE) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/** Splits a pathname into its language and the language-free path: /en/studio → { en, /studio }. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const first = pathname.split("/")[1];
  if (isLocale(first) && first !== DEFAULT_LOCALE) {
    const rest = pathname.slice(first.length + 1);
    return { locale: first, path: rest || "/" };
  }
  return { locale: DEFAULT_LOCALE, path: pathname || "/" };
}

/** Best supported language from an Accept-Language header (q-values respected), or null. */
export function negotiateLocale(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.trim().slice(2) ?? "1");
      return { base: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.base && x.q > 0)
    .sort((a, b) => b.q - a.q);
  return ranked.map((x) => x.base).find(isLocale) ?? null;
}

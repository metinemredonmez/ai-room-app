import type { MetadataRoute } from "next";
import { DEFAULT_LOCALE, LOCALES, LOCALE_TAGS, localePath } from "@/lib/i18n";

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://casalume.app").replace(/\/$/, "");
// Public pages only; account, sign-in and one-time link pages stay out of search.
const PAGES = ["/", "/studio", "/fiyatlar", "/sohbet"];

/** Every page in every language, each entry listing its alternates (hreflang) and x-default (Turkish). */
export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.flatMap((page) => {
    const languages = Object.fromEntries([
      ...LOCALES.map((l) => [LOCALE_TAGS[l], `${BASE}${localePath(l, page)}`]),
      ["x-default", `${BASE}${localePath(DEFAULT_LOCALE, page)}`],
    ]);
    return LOCALES.map((l) => ({
      url: `${BASE}${localePath(l, page)}`,
      changeFrequency: "weekly" as const,
      priority: page === "/" ? 1 : 0.7,
      alternates: { languages },
    }));
  });
}

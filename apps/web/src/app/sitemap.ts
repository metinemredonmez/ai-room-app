import type { MetadataRoute } from "next";
import { blogSitemap } from "@/lib/content";
import { DEFAULT_LOCALE, LOCALES, LOCALE_TAGS, localePath } from "@/lib/i18n";

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://casalume.app").replace(/\/$/, "");
// Public pages only; account, sign-in and one-time link pages stay out of search.
const PAGES = ["/", "/studio", "/fiyatlar", "/sohbet", "/blog", "/yasal/kvkk", "/yasal/kosullar", "/yasal/yapay-zeka", "/yasal/pazarlama", "/hesap-silme"];

/** Every page in every language with its alternates (hreflang) and x-default (Turkish), then every blog article. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = PAGES.flatMap((page) => {
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
  // Articles: translations share a group, so each lists the others as alternates.
  const posts = await blogSitemap();
  const groups = new Map<string, typeof posts>();
  for (const p of posts) groups.set(p.groupId, [...(groups.get(p.groupId) ?? []), p]);
  const articles = posts.map((p) => {
    const siblings = groups.get(p.groupId) ?? [p];
    const languages = Object.fromEntries(siblings.map((s) => [LOCALE_TAGS[s.locale], `${BASE}${localePath(s.locale, `/blog/${s.slug}`)}`]));
    return { url: `${BASE}${localePath(p.locale, `/blog/${p.slug}`)}`, lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.6, alternates: { languages } };
  });
  return [...pages, ...articles];
}

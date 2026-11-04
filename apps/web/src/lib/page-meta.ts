import type { Metadata } from "next";
import { seoPages, type SeoPages } from "./content";
import { isLocale, type Dict } from "./i18n";
import { loadMessages } from "./messages";

/** Pages whose title and description the SEO agent may set (API.md §7.18); approved texts win over the JSON ones. */
const SEO_KEY: Partial<Record<keyof Dict["meta"]["titles"], keyof SeoPages>> = { studio: "studio", pricing: "pricing", chat: "chat", blog: "blog" };

/** A page's <title> in the URL's language: `export const generateMetadata = pageMetadata("studio");` */
export function pageMetadata(key: keyof Dict["meta"]["titles"], extra: Metadata = {}) {
  return async ({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> => {
    const { locale } = await params;
    const l = isLocale(locale) ? locale : "tr";
    const seoKey = SEO_KEY[key];
    const [t, seo] = await Promise.all([loadMessages(l), seoKey ? seoPages(l) : Promise.resolve({} as SeoPages)]);
    const own = seoKey ? seo[seoKey] : undefined;
    return { title: own?.title ?? t.meta.titles[key], ...(own ? { description: own.description } : {}), ...extra };
  };
}

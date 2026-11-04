import type { Metadata } from "next";
import { isLocale, type Dict } from "./i18n";
import { loadMessages } from "./messages";

/** A page's <title> in the URL's language: `export const generateMetadata = pageMetadata("studio");` */
export function pageMetadata(key: keyof Dict["meta"]["titles"], extra: Metadata = {}) {
  return async ({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> => {
    const { locale } = await params;
    const t = await loadMessages(isLocale(locale) ? locale : "tr");
    return { title: t.meta.titles[key], ...extra };
  };
}

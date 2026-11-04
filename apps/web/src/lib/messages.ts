import en from "@/messages/en.json";
import type { Dict, Locale } from "./i18n";

// Server-only: each page sends exactly one language's messages to the browser (as the provider's prop).
const LOADERS: Record<Locale, () => Promise<{ default: unknown }>> = {
  tr: () => import("@/messages/tr.json"),
  en: () => import("@/messages/en.json"),
  de: () => import("@/messages/de.json"),
  es: () => import("@/messages/es.json"),
  fr: () => import("@/messages/fr.json"),
  it: () => import("@/messages/it.json"),
  ru: () => import("@/messages/ru.json"),
  nl: () => import("@/messages/nl.json"),
  ja: () => import("@/messages/ja.json"),
  ko: () => import("@/messages/ko.json"),
  zh: () => import("@/messages/zh.json"),
};

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** English fills any key a translation does not have yet, so a new Turkish key never shows up blank. */
function withFallback(base: Json, over: Json): Json {
  if (Array.isArray(base)) return Array.isArray(over) && over.length === base.length ? over : base;
  if (base && typeof base === "object") {
    const o = over && typeof over === "object" && !Array.isArray(over) ? over : {};
    return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, withFallback(v, (o as Record<string, Json>)[k])]));
  }
  return typeof over === typeof base ? over : base;
}

export async function loadMessages(locale: Locale): Promise<Dict> {
  const own = (await LOADERS[locale]()).default as Json;
  return (locale === "tr" || locale === "en" ? own : withFallback(en as Json, own)) as Dict;
}

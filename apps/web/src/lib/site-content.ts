import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { Locale } from "./i18n";

// Home page and FAQ from the admin (API.md §7.46), cached for a few minutes like the blog and the theme. Only texts
// the admin changed come back; everything else keeps the site's own translation. The API already validates all of it;
// here the shape is checked again (known keys, strings, our own links only) so a bad answer can never reach the page
// (INP-01, EXT-02). Texts are rendered as React text, never as HTML (WEB-01). If the API cannot be read, the page
// shows its built-in content.

const API = (process.env.API_BASE_URL ?? "http://localhost:4000/v1").replace(/\/+$/, "");

export const SECTIONS = ["gallery", "tools", "features", "pro", "how", "styles", "pricing", "faq"] as const;
export type Section = (typeof SECTIONS)[number];

const TEXT_KEYS = [
  "badge", "heroTitle", "heroText", "ctaPrimary", "ctaSecondary", "galleryTitle", "galleryText", "toolsTitle", "toolsText", "moreTools",
  "featuresTitle", "featuresText", "proBadge", "proTitle", "proText", "howTitle", "stylesTitle", "stylesText", "pricingTitle", "pricingText",
  "faqTitle", "finalTitle", "finalCta",
] as const;
type TextKey = (typeof TEXT_KEYS)[number];

export type LandingOverrides = Partial<Record<TextKey, string>> & { trust?: string[]; proPoints?: string[]; faq?: Array<{ q: string; a: string }> };
export type Announcement = { text: string; tone: "info" | "promo" | "warning"; link: string | null };
export type SiteContent = { sections: Record<Section, boolean>; announcement: Announcement | null; texts: LandingOverrides };

export const LINK_RE = /^\/(studio|fiyatlar|sohbet|blog(\/[a-z0-9]+(?:-[a-z0-9]+)*)?)$/;
const ALL_ON = Object.fromEntries(SECTIONS.map((s) => [s, true])) as Record<Section, boolean>;
export const EMPTY_CONTENT: SiteContent = { sections: ALL_ON, announcement: null, texts: {} };

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v : null);
const strList = (v: unknown, items: number, max: number) => (Array.isArray(v) && v.length && v.length <= items && v.every((x) => str(x, max)) ? (v as string[]) : null);

export function cleanSiteContent(raw: unknown): SiteContent {
  if (!raw || typeof raw !== "object") return EMPTY_CONTENT;
  const r = raw as { sections?: Record<string, unknown>; announcement?: Record<string, unknown> | null; texts?: Record<string, unknown> };
  const sections = { ...ALL_ON };
  for (const s of SECTIONS) if (r.sections?.[s] === false) sections[s] = false;

  const a = r.announcement;
  const tone: Announcement["tone"] = a?.tone === "promo" || a?.tone === "warning" ? a.tone : "info";
  const text = str(a?.text, 140);
  const link = typeof a?.link === "string" && LINK_RE.test(a.link) ? a.link : null;
  const announcement = text ? { text, tone, link } : null;

  const texts: LandingOverrides = {};
  const t = r.texts && typeof r.texts === "object" ? r.texts : {};
  for (const k of TEXT_KEYS) {
    const v = str(t[k], 320);
    if (v) texts[k] = v;
  }
  const trust = strList(t.trust, 4, 40);
  if (trust) texts.trust = trust;
  const proPoints = strList(t.proPoints, 6, 90);
  if (proPoints) texts.proPoints = proPoints;
  if (Array.isArray(t.faq) && t.faq.length && t.faq.length <= 20) {
    const faq = (t.faq as Array<Record<string, unknown>>).map((f) => ({ q: str(f?.q, 160), a: str(f?.a, 1000) }));
    if (faq.every((f) => f.q && f.a) && new Set(faq.map((f) => f.q)).size === faq.length) texts.faq = faq as Array<{ q: string; a: string }>;
  }
  return { sections, announcement, texts };
}

export async function siteContent(locale: Locale): Promise<SiteContent> {
  "use cache";
  cacheLife("minutes");
  cacheTag("site-content");
  try {
    const res = await fetch(`${API}/site/content?locale=${locale}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(3000) });
    return res.ok ? cleanSiteContent(await res.json()) : EMPTY_CONTENT;
  } catch {
    return EMPTY_CONTENT;
  }
}

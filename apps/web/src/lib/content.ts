import { cacheLife, cacheTag } from "next/cache";
import type { Locale } from "./i18n";

// Public content from the API (API.md §7.18): blog articles and approved SEO texts. Cached for a few minutes, so
// an article approved in the admin is live within ~5 minutes without a deploy. Any API failure falls back to the
// site's own texts (and an empty blog) instead of breaking the page.

const API = (process.env.API_BASE_URL ?? "http://localhost:4000/v1").replace(/\/+$/, "");

export type BlogCard = {
  id: string;
  locale: Locale;
  slug: string;
  title: string;
  description: string;
  coverUrl: string | null;
  publishedAt: string;
  updatedAt: string;
};
export type BlogPost = BlogCard & { body: string; translations: Array<{ locale: Locale; slug: string }> };
export type SeoPages = Partial<Record<"home" | "studio" | "pricing" | "chat" | "blog", { title: string; description: string }>>;

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function blogList(locale: Locale): Promise<BlogCard[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("blog");
  return (await get<{ items: BlogCard[] }>(`/blog?locale=${locale}`))?.items ?? [];
}

export async function blogPost(locale: Locale, slug: string): Promise<BlogPost | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("blog");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) return null;
  return get<BlogPost>(`/blog/${slug}?locale=${locale}`);
}

export async function blogSitemap(): Promise<Array<{ groupId: string; locale: Locale; slug: string; updatedAt: string }>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("blog");
  return (await get<{ items: Array<{ groupId: string; locale: Locale; slug: string; updatedAt: string }> }>("/blog/sitemap"))?.items ?? [];
}

export async function seoPages(locale: Locale): Promise<SeoPages> {
  "use cache";
  cacheLife("minutes");
  cacheTag("seo");
  return (await get<{ pages: SeoPages }>(`/seo/meta?locale=${locale}`))?.pages ?? {};
}

/** Reading time from the word count (CJK: characters / 400 per minute). */
export function readingMinutes(body: string): number {
  const cjk = (body.match(/[぀-ヿ㐀-鿿가-힯]/g) ?? []).length;
  const words = body.replace(/[぀-ヿ㐀-鿿가-힯]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220 + cjk / 400));
}

export type LegalKind = "privacy" | "terms" | "ai_processing" | "marketing";
export type LegalDoc = { kind: LegalKind; version: string; locale: "tr" | "en"; title: string; body: string; publishedAt: string };

/** Published legal text (Turkish or English; the other languages get English). Null when the API is down. */
export async function legalDoc(kind: LegalKind, locale: Locale): Promise<LegalDoc | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("legal");
  return get<LegalDoc>(`/legal/${kind}?locale=${locale}`);
}

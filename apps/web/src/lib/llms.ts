import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { blogList, type BlogCard } from "./content";
import { DEFAULT_LOCALE, LOCALES, localePath } from "./i18n";
import { loadMessages } from "./messages";
import { siteContent } from "./site-content";
import type { Catalog } from "./types";

// API.md §7.53: /llms.txt and /llms-full.txt, a plain Markdown map of the site for AI assistants (llmstxt.org). Built
// on every refresh from the site's own texts, the catalog, the admin's FAQ and the blog, so it never goes stale like a
// hand-written file. No prices (they change in the admin), no personal data, no claims the site does not make itself.
// The admin can turn it off (Ayarlar → AI asistanları ve tarayıcılar); then it answers 404 and robots.txt blocks the bots.

const API = (process.env.API_BASE_URL ?? "http://localhost:4000/v1").replace(/\/+$/, "");
const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://casalume.app").replace(/\/$/, "");

export type Discovery = { aiAssistants: boolean; aiTraining: boolean };

/** The admin's switches. Unknown (API down) counts as off: the owner's "no" must hold even then. */
export async function discovery(): Promise<Discovery> {
  "use cache";
  cacheLife("minutes");
  cacheTag("discovery");
  try {
    const res = await fetch(`${API}/site/discovery`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { aiAssistants: false, aiTraining: false };
    const body = (await res.json()) as Partial<Discovery>;
    return { aiAssistants: body.aiAssistants === true, aiTraining: body.aiTraining === true };
  } catch {
    return { aiAssistants: false, aiTraining: false };
  }
}

async function catalog(): Promise<Catalog | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  try {
    const res = await fetch(`${API}/catalog?locale=en`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    return res.ok ? ((await res.json()) as Catalog) : null;
  } catch {
    return null;
  }
}

/** One line of plain text: no control characters, no Markdown link syntax from data. */
const line = (s: unknown, max = 300) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const url = (path: string, locale: (typeof LOCALES)[number] = "en") => `${BASE}${localePath(locale, path)}`;

async function header() {
  const [t, site, cat] = await Promise.all([loadMessages("en"), siteContent("en"), catalog()]);
  const flags = cat?.features ?? {};
  const heroText = site.texts.heroText ?? t.landing.heroText;
  const pages = [
    `- [Home](${url("/")}): ${line(t.brandTagline)}`,
    `- [Studio](${url("/studio")}): upload a photo of a room, a facade or a garden, pick a tool and a style, get redesigned variants.`,
    `- [Pricing](${url("/fiyatlar")}): free daily designs, the Pro subscription and credit packs. Current prices are on the page.`,
    ...(flags.assistant_chat ? [`- [AI Chat](${url("/sohbet")}): ask an AI interior designer about a room.`] : []),
    ...(flags.blog ? [`- [Blog](${url("/blog")}): articles on interior design and decoration.`] : []),
  ];
  const legal = (["kvkk", "kosullar", "yapay-zeka", "pazarlama"] as const).map((k) => `- [${line(t.legal.names[k])}](${url(`/yasal/${k}`)})`);
  const head = [
    "# Casalume",
    "",
    `> ${line(t.meta.description)}`,
    "",
    line(heroText, 600),
    "",
    `Casalume is a website and a mobile app. The site is in ${LOCALES.length} languages: Turkish at unprefixed addresses (${BASE}/studio), the others under a language prefix (${BASE}/en/studio). The links below are the English pages.`,
    "",
    "## Main pages",
    "",
    ...pages,
    `- Turkish: [Ana sayfa](${url("/", DEFAULT_LOCALE)}), [Stüdyo](${url("/studio", DEFAULT_LOCALE)}), [Fiyatlar](${url("/fiyatlar", DEFAULT_LOCALE)})`,
    "",
    "## Legal",
    "",
    ...legal,
    `- [${line(t.meta.titles.deletion)}](${url("/hesap-silme")})`,
  ];
  return { head, t, site, cat, flags };
}

export async function llmsTxt(): Promise<string> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog", "site-content", "blog");
  const { head } = await header();
  return [...head, "", "## Optional", "", `- [Full summary](${BASE}/llms-full.txt): tools, styles, rooms, frequently asked questions and articles.`, ""].join("\n");
}

const articles = (posts: BlogCard[], locale: (typeof LOCALES)[number]) =>
  posts.slice(0, 30).map((p) => `- [${line(p.title, 120)}](${url(`/blog/${p.slug}`, locale)}): ${line(p.description, 200)}`);

export async function llmsFullTxt(): Promise<string> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog", "site-content", "blog");
  const { head, t, site, cat, flags } = await header();
  const out = [...head];
  if (cat?.tools.length) {
    out.push("", "## Tools", "", ...cat.tools.map((x) => `- **${line(x.name, 80)}**${x.isPro ? " (Pro)" : ""}: ${line(x.description)}`));
  }
  if (cat?.styles.length) {
    out.push("", "## Styles", "", ...cat.styles.map((x) => `- **${line(x.name, 80)}**${x.isPro ? " (Pro)" : ""}: ${line(x.description)}`));
  }
  if (cat?.rooms.length) out.push("", "## Rooms", "", cat.rooms.map((r) => line(r.name, 60)).join(", "));
  if (site.sections.faq) {
    const faq = site.texts.faq ?? t.landing.faq;
    out.push("", "## Frequently asked questions", "", ...faq.flatMap((f) => [`### ${line(f.q, 200)}`, "", line(f.a, 1200), ""]));
  }
  if (flags.blog) {
    const [en, tr] = await Promise.all([blogList("en"), blogList(DEFAULT_LOCALE)]);
    if (en.length) out.push("", "## Articles", "", ...articles(en, "en"));
    if (tr.length) out.push("", "## Articles in Turkish", "", ...articles(tr, DEFAULT_LOCALE));
  }
  out.push("");
  return out.join("\n");
}

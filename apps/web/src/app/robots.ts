import type { MetadataRoute } from "next";
import { discovery } from "@/lib/llms";

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://casalume.app").replace(/\/$/, "");

// Account and one-time-link pages, in every language (/en/tasarimlarim matches "/*/tasarimlarim").
// "/hesap$" is an exact match: a plain "/hesap" prefix would also hide the public /hesap-silme page.
const PRIVATE = ["/tasarimlarim", "/hesap$", "/destek", "/abonelikten-cik", "/eposta-dogrula", "/sifre-sifirla", "/davet", "/ekip"];

// API.md §7.53, switched in the admin (Ayarlar → AI asistanları ve tarayıcılar). Answer engines that open a page for
// a user's question, and crawlers that collect pages for model training. Search engines (Googlebot, Bingbot) are not
// in either list: closing these never takes the site out of search.
const AI_ASSISTANTS = ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "DuckAssistBot", "MistralAI-User"];
const AI_TRAINING = ["GPTBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "Applebot-Extended", "CCBot", "Bytespider", "meta-externalagent", "cohere-training-data-crawler"];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const ai = await discovery();
  const blocked = [...(ai.aiAssistants ? [] : AI_ASSISTANTS), ...(ai.aiTraining ? [] : AI_TRAINING)];
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/api/", ...PRIVATE, ...PRIVATE.map((p) => `/*${p}`)] },
      ...(blocked.length ? [{ userAgent: blocked, disallow: "/" }] : []),
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}

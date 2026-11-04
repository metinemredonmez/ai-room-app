import type { MetadataRoute } from "next";

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://casalume.app").replace(/\/$/, "");

// Account and one-time-link pages, in every language (/en/tasarimlarim matches "/*/tasarimlarim").
// "/hesap$" is an exact match: a plain "/hesap" prefix would also hide the public /hesap-silme page.
const PRIVATE = ["/tasarimlarim", "/hesap$", "/destek", "/abonelikten-cik", "/eposta-dogrula", "/sifre-sifirla"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", ...PRIVATE, ...PRIVATE.map((p) => `/*${p}`)] }],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}

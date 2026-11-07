import type { NextConfig } from "next";
import { DEFAULT_LOCALE_HEADER } from "./src/lib/locale-header";

const isDev = process.env.NODE_ENV === "development";

// Image URLs returned by the backend are signed and absolute; they are the only
// third-party origin the browser may load from.
function imageOrigins(): string[] {
  const origins = new Set<string>();
  const api = process.env.API_BASE_URL ?? "http://localhost:4000/v1";
  try {
    origins.add(new URL(api).origin);
  } catch {}
  for (const raw of (process.env.IMAGE_ORIGINS ?? "").split(",")) {
    try {
      if (raw.trim()) origins.add(new URL(raw.trim()).origin);
    } catch {}
  }
  return [...origins];
}

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${imageOrigins().join(" ")}`,
  // API.md §7.54: the coach's voice, a signed link on the API origin.
  `media-src 'self' blob: data: ${imageOrigins().join(" ")}`,
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  // The deploy builds into a separate folder and swaps it in, so the running site never serves a half-written
  // build (deploy/hazal/build.sh). `next start` uses the default .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Turkish pages are unprefixed but live under app/[locale] as /tr/…. src/proxy.ts marks those requests with a
  // header and this rewrite maps them. The rewrite sits here, not in the proxy: a proxy rewrite is an absolute URL,
  // and behind `next start -H 127.0.0.1` Next spells its own origin as localhost there, takes it for an external
  // URL and proxies it (TLS error, 500 on hazal). A config rewrite is a path and never leaves the server.
  async rewrites() {
    return {
      // Same paths as the proxy matcher: the header only ever applies where the proxy set (or removed) it, never to
      // /api, /_next or files, so a client sending it by hand changes nothing outside pages.
      beforeFiles: [
        {
          source: "/:path((?!api/|_next/|.*\\..*).*)",
          has: [{ type: "header", key: DEFAULT_LOCALE_HEADER, value: "1" }],
          destination: "/tr/:path",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default nextConfig;

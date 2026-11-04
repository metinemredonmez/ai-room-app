import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, negotiateLocale } from "@/lib/i18n";
import { DEFAULT_LOCALE_HEADER } from "@/lib/locale-header";

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview/i;

/**
 * Language routing (maeyja pattern, Turkish unprefixed):
 * - /en/studio, /de/… are served as they are;
 * - /tr/studio redirects to /studio, so every page has one Turkish URL;
 * - an unprefixed URL is Turkish (next.config.ts maps it onto /tr/…), unless the visitor chose another language (cookie) or their browser prefers one
 *   (Accept-Language): then they are sent to that language's URL. Crawlers are never redirected, so search engines
 *   index each language at its own address (sitemap.xml lists the alternates).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split("/")[1];

  if (first === DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(DEFAULT_LOCALE.length + 1) || "/";
    return NextResponse.redirect(url, 308);
  }
  if (isLocale(first)) return pass(request, false);

  const chosen = request.cookies.get(LOCALE_COOKIE)?.value;
  const isBot = BOT_RE.test(request.headers.get("user-agent") ?? "");
  const wanted = isLocale(chosen) ? chosen : isBot ? null : negotiateLocale(request.headers.get("accept-language"));
  if (wanted && wanted !== DEFAULT_LOCALE && !isBot && request.method === "GET") {
    const url = request.nextUrl.clone();
    url.pathname = `/${wanted}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url, 307);
  }
  return pass(request, true);
}

/** Continue with the Turkish marker set or removed (a client can't send it to reach /tr/… paths by hand). */
function pass(request: NextRequest, turkish: boolean) {
  const headers = new Headers(request.headers);
  if (turkish) headers.set(DEFAULT_LOCALE_HEADER, "1");
  else headers.delete(DEFAULT_LOCALE_HEADER);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: not the BFF (/api), Next assets, or files (icons, landing images, robots.txt, sitemap.xml).
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};

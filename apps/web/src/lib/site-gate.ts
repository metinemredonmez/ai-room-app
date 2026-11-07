import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, negotiateLocale } from "@/lib/i18n";

// API.md §7.52: the maintenance page (Ayarlar → Bakım modu → web sitesi) and the staff preview link, for src/proxy.ts.
// The admin's link is https://casalume.app/#onizleme=<token>: the token stays in the fragment (no server log, no
// Referer, AUT-03). The maintenance page's script posts it to /api/preview, which asks the API and sets an httpOnly
// cookie; this proxy asks the API about that cookie again (cached a minute), so a cancelled link stops within a minute.

export const PREVIEW_COOKIE = "air_preview";
/** Not httpOnly: it only tells the page to show "you are previewing"; the httpOnly cookie is what lets a visitor in. */
export const PREVIEW_FLAG = "air_pv";
export const PREVIEW_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const API = (process.env.API_BASE_URL ?? "http://localhost:4000/v1").replace(/\/+$/, "");
const STATUS_TTL_MS = 10_000;
const PREVIEW_TTL_MS = 60_000;
const PREVIEW_CACHE_MAX = 500;

interface SiteStatus {
  maintenance: boolean;
  messageTr: string;
  messageEn: string;
}

const OPEN: SiteStatus = { maintenance: false, messageTr: "", messageEn: "" };
let status: { value: SiteStatus; until: number } | null = null;
let inflight: Promise<SiteStatus> | null = null;

/**
 * Whether the site is closed. Maintenance is not a security boundary: when the API cannot be reached the last answer
 * stays (or the site stays open), so an API outage never shuts the whole site.
 */
async function siteStatus(): Promise<SiteStatus> {
  if (status && status.until > Date.now()) return status.value;
  inflight ??= (async () => {
    let value = status?.value ?? OPEN;
    try {
      const res = await fetch(`${API}/site/status`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const body = (await res.json()) as Partial<SiteStatus>;
        value = { maintenance: body.maintenance === true, messageTr: String(body.messageTr ?? ""), messageEn: String(body.messageEn ?? "") };
      }
    } catch {}
    status = { value, until: Date.now() + STATUS_TTL_MS };
    return value;
  })().finally(() => (inflight = null));
  return inflight;
}

const previews = new Map<string, { ok: boolean; until: number }>();

/** The visitor's IP as nginx set it (last X-Forwarded-For entry), so the API's per-IP limit is per visitor. */
function visitorIp(request: NextRequest): string | null {
  const last = (request.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last && isIP(last) ? last : null;
}

async function previewValid(token: string | undefined, request: NextRequest): Promise<boolean> {
  if (!token || !PREVIEW_TOKEN_RE.test(token)) return false;
  const hit = previews.get(token);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = false;
  try {
    const headers = new Headers({ "content-type": "application/json" });
    const ip = visitorIp(request);
    if (ip) headers.set("x-forwarded-for", ip);
    const res = await fetch(`${API}/site/preview`, { method: "POST", headers, body: JSON.stringify({ token }), cache: "no-store", signal: AbortSignal.timeout(1500) });
    ok = res.status === 204;
    // A rate-limited or failed check is not cached: the next page asks again.
    if (res.status !== 204 && res.status !== 403) return false;
  } catch {
    return false;
  }
  if (previews.size >= PREVIEW_CACHE_MAX) previews.clear();
  previews.set(token, { ok, until: Date.now() + PREVIEW_TTL_MS });
  return ok;
}

export type SiteGate = { page: Response; preview?: never } | { page?: never; preview: boolean };

/** The maintenance page for a closed site (unless this browser holds a valid preview cookie). */
export async function siteGate(request: NextRequest): Promise<SiteGate> {
  const s = await siteStatus();
  if (!s.maintenance) return { preview: false };
  if (await previewValid(request.cookies.get(PREVIEW_COOKIE)?.value, request)) return { preview: true };
  return { page: maintenancePage(request, s) };
}

function pageLocale(request: NextRequest): string {
  const first = request.nextUrl.pathname.split("/")[1];
  if (isLocale(first)) return first;
  const chosen = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return negotiateLocale(request.headers.get("accept-language")) ?? DEFAULT_LOCALE;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const TEXT = {
  tr: { title: "Birazdan buradayız", fallback: "Kısa bir bakım yapıyoruz, birazdan tekrar dene.", wait: "Önizleme açılıyor…", bad: "Önizleme bağlantısı geçersiz ya da yenilenmiş." },
  en: { title: "We’ll be right back", fallback: "We are doing short maintenance, please try again shortly.", wait: "Opening the preview…", bad: "This preview link is invalid or has been replaced." },
};

/** Self-contained 503 page: no app code, no external request; its one script only handles the preview link. */
function maintenancePage(request: NextRequest, s: SiteStatus): Response {
  const tr = pageLocale(request) === "tr";
  const t = tr ? TEXT.tr : TEXT.en;
  const message = (tr ? s.messageTr : s.messageEn).trim() || t.fallback;
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const html = `<!doctype html>
<html lang="${tr ? "tr" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Casalume</title>
<style nonce="${nonce}">
:root{--bg:#f6f1ea;--surface:#fff;--text:#1c1714;--muted:#6e655e;--border:#e7ddd1;--primary:#a9532e}
@media (prefers-color-scheme:dark){:root{--bg:#15110f;--surface:#1f1916;--text:#f3ece2;--muted:#ada39a;--border:#342a25;--primary:#e07a52}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:440px;width:100%;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:24px;padding:40px 28px}
.brand{font-family:Georgia,"Times New Roman",serif;font-size:28px;letter-spacing:.02em;color:var(--primary);margin:0 0 20px}
h1{font-size:20px;font-weight:600;margin:0 0 8px}
p{margin:0;color:var(--muted)}
#pv{margin-top:16px;font-size:14px}
</style>
</head>
<body>
<main>
<p class="brand">Casalume</p>
<h1>${t.title}</h1>
<p>${escapeHtml(message)}</p>
<p id="pv" role="status"></p>
</main>
<script nonce="${nonce}">
(function(){var o=document.getElementById("pv");function bad(){o.textContent=${JSON.stringify(t.bad)};}
function run(){var m=location.hash.match(/^#onizleme=([A-Za-z0-9_-]{43})$/);if(!m)return;
history.replaceState(null,"",location.pathname+location.search);o.textContent=${JSON.stringify(t.wait)};
fetch("/api/preview",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:m[1]}),credentials:"same-origin"})
.then(function(r){if(r.ok)location.reload();else bad();},bad);}
run();addEventListener("hashchange",run);})();
</script>
</body>
</html>`;
  return new Response(request.method === "HEAD" ? null : html, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "300",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    },
  });
}

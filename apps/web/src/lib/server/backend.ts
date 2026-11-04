import "server-only";
import { isIP } from "node:net";
import { cookies, headers as requestHeaders } from "next/headers";
import type { NextRequest } from "next/server";
import type { AuthResponse } from "@/lib/types";
import { isLocale, type Locale } from "@/lib/i18n";

// BFF helpers (docs/API.md §1, SES-01 / WEB-03): the browser only ever holds httpOnly
// cookies; access and refresh tokens never reach client JavaScript.

export const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:4000/v1").replace(/\/+$/, "");

export const COOKIE = {
  access: "air_at",
  refresh: "air_rt",
  device: "air_did",
  locale: "air_locale",
} as const;

const secure = process.env.NODE_ENV === "production";
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export function allowedImageOrigins(): Set<string> {
  const origins = new Set<string>([new URL(API_BASE_URL).origin]);
  for (const raw of (process.env.IMAGE_ORIGINS ?? "").split(",")) {
    try {
      if (raw.trim()) origins.add(new URL(raw.trim()).origin);
    } catch {}
  }
  return origins;
}

export function jsonError(status: number, code: string, message: string, extra?: HeadersInit) {
  return Response.json({ error: { code, message } }, { status, headers: extra });
}

/** WEB-03: state-changing requests must come from our own origin. */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const expected = new Set<string>([req.nextUrl.origin]);
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      expected.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
    } catch {}
  }
  return expected.has(origin);
}

export function csrfRejected() {
  return jsonError(403, "forbidden", "Bu istek yalnızca uygulamanın kendi sayfalarından yapılabilir.");
}

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const v = store.get(COOKIE.locale)?.value;
  return isLocale(v) ? v : "tr";
}

export async function setAuthCookies(auth: Pick<AuthResponse, "accessToken" | "refreshToken" | "expiresIn">) {
  const store = await cookies();
  store.set(COOKIE.access, auth.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(60, Math.floor(auth.expiresIn) - 15),
  });
  // Refresh token is only sent to BFF routes.
  store.set(COOKIE.refresh, auth.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api",
    maxAge: REFRESH_MAX_AGE,
  });
}

export async function clearAuthCookies() {
  const store = await cookies();
  store.set(COOKIE.access, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
  store.set(COOKIE.refresh, "", { httpOnly: true, secure, sameSite: "lax", path: "/api", maxAge: 0 });
}

export async function getOrCreateDeviceId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE.device)?.value;
  if (existing && /^[A-Za-z0-9-]{16,64}$/.test(existing)) return existing;
  const id = crypto.randomUUID();
  store.set(COOKIE.device, id, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api",
    maxAge: 60 * 60 * 24 * 365,
  });
  return id;
}

export interface BackendCall {
  method: string;
  path: string; // starts with "/", relative to API_BASE_URL
  search?: string;
  body?: BodyInit | null;
  contentType?: string | null;
  bearer?: string | null;
  locale?: string;
}

/**
 * The visitor's IP as nginx saw it: nginx overwrites X-Forwarded-For with $remote_addr, so its last entry can't be
 * forged by the browser. Without it the backend would see every web visitor as 127.0.0.1 (this server), and its
 * per-IP limits (login, guest accounts, chat) would be one shared bucket.
 */
async function visitorIp(): Promise<string | null> {
  try {
    const last = ((await requestHeaders()).get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop();
    return last && isIP(last) ? last : null;
  } catch {
    return null; // outside a request (build time)
  }
}

export async function callBackend(call: BackendCall): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });
  const ip = await visitorIp();
  if (ip) headers.set("x-forwarded-for", ip);
  if (call.contentType) headers.set("content-type", call.contentType);
  if (call.bearer) headers.set("authorization", `Bearer ${call.bearer}`);
  if (call.locale) headers.set("accept-language", call.locale);
  return fetch(`${API_BASE_URL}${call.path}${call.search ?? ""}`, {
    method: call.method,
    headers,
    body: call.body ?? undefined,
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(150_000),
  });
}

/** Rotates the refresh token (SES-05). Returns the new access token or null. */
export async function refreshSession(): Promise<string | null> {
  const store = await cookies();
  const refreshToken = store.get(COOKIE.refresh)?.value;
  if (!refreshToken) return null;
  try {
    const res = await callBackend({
      method: "POST",
      path: "/auth/refresh",
      body: JSON.stringify({ refreshToken }),
      contentType: "application/json",
    });
    if (!res.ok) {
      await clearAuthCookies();
      return null;
    }
    const auth = (await res.json()) as AuthResponse;
    await setAuthCookies(auth);
    return auth.accessToken;
  } catch {
    return null;
  }
}

/** Copies a backend response through, keeping only safe headers. */
export async function relay(res: Response): Promise<Response> {
  const headers = new Headers();
  // x-request-id lets the error screen attach the failing request to a support ticket.
  for (const name of ["content-type", "retry-after", "cache-control", "x-request-id"]) {
    const v = res.headers.get(name);
    if (v) headers.set(name, v);
  }
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  if (res.status === 204 || res.status === 304) return new Response(null, { status: res.status, headers });
  return new Response(await res.arrayBuffer(), { status: res.status, headers });
}

export function backendUnavailable() {
  return jsonError(502, "ai_unavailable", "Sunucuya şu an ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.");
}

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import {
  COOKIE,
  backendUnavailable,
  callBackend,
  csrfRejected,
  getLocale,
  isSameOrigin,
  jsonError,
  refreshSession,
  relay,
} from "@/lib/server/backend";

// Catch-all BFF proxy: /api/v1/<path> → ${API_BASE_URL}/<path> with the session's Bearer token.

const SEGMENT = /^[A-Za-z0-9_-]{1,80}$/;
// Auth has dedicated BFF routes; admin endpoints are never reachable from the public web app.
const BLOCKED_ROOTS = new Set(["auth", "admin", "images"]);
// …except the e-mail flows, which carry no session cookies of their own (AUT-03).
const ALLOWED_AUTH = new Set(["auth/password/forgot", "auth/password/reset", "auth/email/verify", "auth/email/resend"]);
const MAX_BODY_BYTES = 15 * 1024 * 1024;

async function handle(req: NextRequest, ctx: RouteContext<"/api/v1/[...path]">): Promise<Response> {
  const { path } = await ctx.params;
  const blocked = BLOCKED_ROOTS.has(path[0]) && !ALLOWED_AUTH.has(path.join("/"));
  if (!path.length || !path.every((s) => SEGMENT.test(s)) || blocked) {
    return jsonError(404, "not_found", "Bulunamadı.");
  }
  const method = req.method.toUpperCase();
  const mutating = !["GET", "HEAD"].includes(method);
  if (mutating && !isSameOrigin(req)) return csrfRejected();

  let body: ArrayBuffer | null = null;
  if (mutating) {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return jsonError(413, "payload_too_large", "Dosya çok büyük (en fazla 10 MB).");
    body = await req.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return jsonError(413, "payload_too_large", "Dosya çok büyük (en fazla 10 MB).");
  }

  const store = await cookies();
  let bearer = store.get(COOKIE.access)?.value ?? null;
  let refreshed = false;
  if (!bearer && store.get(COOKIE.refresh)?.value) {
    bearer = await refreshSession();
    refreshed = true;
  }

  const call = {
    method,
    path: `/${path.join("/")}`,
    search: req.nextUrl.search,
    body: body && body.byteLength ? body : null,
    contentType: body && body.byteLength ? (req.headers.get("content-type") ?? "application/json") : null,
    locale: await getLocale(),
  };

  try {
    let res = await callBackend({ ...call, bearer });
    if (res.status === 401 && bearer && !refreshed) {
      const fresh = await refreshSession();
      if (fresh) res = await callBackend({ ...call, bearer: fresh });
    }
    return relay(res);
  } catch {
    return backendUnavailable();
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { backendUnavailable, callBackend, csrfRejected, isSameOrigin, jsonError, relay } from "@/lib/server/backend";
import { PREVIEW_COOKIE, PREVIEW_FLAG, PREVIEW_TOKEN_RE } from "@/lib/site-gate";

// API.md §7.52: the maintenance page posts the staff link's token here; when the API accepts it, the browser gets an
// httpOnly cookie for 7 days (src/proxy.ts checks it again on every page). DELETE leaves the preview.

const secure = process.env.NODE_ENV === "production";
const MAX_AGE = 60 * 60 * 24 * 7;

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return csrfRejected();
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  if (!PREVIEW_TOKEN_RE.test(token)) return jsonError(400, "validation_failed", "Geçersiz bağlantı.");
  let res: Response;
  try {
    res = await callBackend({ method: "POST", path: "/site/preview", body: JSON.stringify({ token }), contentType: "application/json" });
  } catch {
    return backendUnavailable();
  }
  if (res.status !== 204) return relay(res);
  (await cookies()).set(PREVIEW_COOKIE, token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: MAX_AGE });
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  if (!isSameOrigin(req)) return csrfRejected();
  const store = await cookies();
  store.set(PREVIEW_COOKIE, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
  store.set(PREVIEW_FLAG, "", { secure, sameSite: "lax", path: "/", maxAge: 0 });
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

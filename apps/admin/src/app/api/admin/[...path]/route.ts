import { NextResponse, type NextRequest } from "next/server";
import { apiBaseUrl, cookieOptions, PROFILE_COOKIE, SESSION_COOKIE } from "@/lib/server/config";
import { forwardedFor } from "@/lib/server/client-ip";
import { errorResponse, isSameOrigin } from "@/lib/server/guards";

const SEGMENT = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_BODY_BYTES = 256 * 1024;

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: NextRequest, ctx: Ctx, method: "GET" | "POST" | "PATCH" | "DELETE") {
  if (method !== "GET" && !isSameOrigin(req)) {
    return errorResponse(403, "forbidden", "İstek kaynağı doğrulanamadı.");
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return errorResponse(401, "unauthorized", "Oturum gerekli.");

  // Only plain path segments reach the backend: no "..", encoded slashes or empty parts.
  const { path } = await ctx.params;
  if (!path.length || !path.every((s) => SEGMENT.test(s))) {
    return errorResponse(400, "bad_request", "Geçersiz yol.");
  }
  const target = new URL(`${apiBaseUrl()}/admin/${path.join("/")}`);
  req.nextUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));

  let body: string | undefined;
  if (method === "POST" || method === "PATCH") {
    body = await req.text();
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return errorResponse(413, "payload_too_large", "İstek çok büyük.");
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "accept-language": "tr",
        ...(await forwardedFor()),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return errorResponse(502, "backend_unavailable", "Sunucuya ulaşılamadı.");
  }

  const headers = new Headers({ "cache-control": "no-store" });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);

  let response: NextResponse;
  if (upstream.status === 204) {
    response = new NextResponse(null, { status: 204, headers });
  } else {
    const text = await upstream.text();
    headers.set("content-type", upstream.headers.get("content-type") ?? "application/json");
    response = new NextResponse(text, { status: upstream.status, headers });
  }
  if (upstream.status === 401) {
    // Expired or revoked admin token: drop the session so the UI returns to the login screen.
    response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
    response.cookies.set(PROFILE_COOKIE, "", cookieOptions(0));
  }
  return response;
}

export const GET = (req: NextRequest, ctx: Ctx) => forward(req, ctx, "GET");
export const POST = (req: NextRequest, ctx: Ctx) => forward(req, ctx, "POST");
export const PATCH = (req: NextRequest, ctx: Ctx) => forward(req, ctx, "PATCH");
export const DELETE = (req: NextRequest, ctx: Ctx) => forward(req, ctx, "DELETE");

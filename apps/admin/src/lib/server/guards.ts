import "server-only";
import { NextResponse, type NextRequest } from "next/server";

/**
 * WEB-03: state-changing BFF calls must come from this admin origin. Browsers always send
 * `Origin` on cross-origin and same-origin fetch POST/PATCH/DELETE, so a missing header is refused.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = process.env.ADMIN_ORIGIN;
  if (allowed) return origin === allowed.replace(/\/+$/, "");
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export function errorResponse(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { COOKIE, callBackend, clearAuthCookies, csrfRejected, isSameOrigin } from "@/lib/server/backend";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return csrfRejected();
  const refreshToken = (await cookies()).get(COOKIE.refresh)?.value;
  if (refreshToken) {
    // Best effort: the backend revokes the refresh family; cookies are cleared regardless (SES-04).
    await callBackend({
      method: "POST",
      path: "/auth/logout",
      body: JSON.stringify({ refreshToken }),
      contentType: "application/json",
    }).catch(() => null);
  }
  await clearAuthCookies();
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

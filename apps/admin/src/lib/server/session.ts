import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiBaseUrl, cookieOptions, PROFILE_COOKIE, SESSION_COOKIE } from "@/lib/server/config";
import { errorResponse } from "@/lib/server/guards";
import { ADMIN_ROLES, type AdminRole } from "@/lib/types";

export type BackendSession = {
  accessToken: string;
  expiresIn: number;
  admin: { id: string; email: string | null; name: string | null; role: string };
};

/** Reads a small JSON body; null when it is not an object. */
export async function readJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** POSTs to the backend's admin auth API; a network failure becomes a 502 response. */
export async function backendAuth(path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(`${apiBaseUrl()}/admin/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "accept-language": "tr" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ error: { code: "backend_unavailable", message: "Sunucuya ulaşılamadı. Lütfen tekrar deneyin." } }, { status: 502 });
  }
}

/** Same generic wording for every credential failure, so a form never reveals which factor was wrong. */
export async function credentialError(res: Response) {
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  const retryAfter = res.headers.get("retry-after");
  const message =
    res.status === 429
      ? "Çok fazla deneme yapıldı. Lütfen biraz bekleyin."
      : res.status === 401 || res.status === 403
        ? "Giriş bilgileri veya doğrulama kodu hatalı."
        : (data?.error?.message ?? "Giriş yapılamadı.");
  return errorResponse(res.status, data?.error?.code ?? "login_failed", message, retryAfter ? { "retry-after": retryAfter } : undefined);
}

/** Stores the admin token in the httpOnly session cookie (it never reaches page scripts). */
export function startSession(data: BackendSession, extra: Record<string, unknown> = {}) {
  // Any admin role may sign in; the backend enforces what each role can do on every request.
  if (!data?.accessToken || !ADMIN_ROLES.includes(data.admin?.role as AdminRole)) {
    return errorResponse(403, "forbidden", "Bu hesap yönetici paneline erişemez.");
  }
  const maxAge = Math.max(60, Math.min(Number(data.expiresIn) || 0, 12 * 60 * 60));
  const profile = { email: data.admin.email, name: data.admin.name };
  const response = NextResponse.json({ admin: profile, ...extra });
  response.cookies.set(SESSION_COOKIE, data.accessToken, cookieOptions(maxAge));
  response.cookies.set(PROFILE_COOKIE, Buffer.from(JSON.stringify(profile)).toString("base64url"), cookieOptions(maxAge));
  return response;
}

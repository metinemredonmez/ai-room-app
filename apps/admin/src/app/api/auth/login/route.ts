import { NextResponse, type NextRequest } from "next/server";
import { apiBaseUrl, cookieOptions, PROFILE_COOKIE, SESSION_COOKIE } from "@/lib/server/config";
import { errorResponse, isSameOrigin } from "@/lib/server/guards";
import { ADMIN_ROLES, type AdminRole } from "@/lib/types";

type LoginBody = { email?: unknown; password?: unknown; otp?: unknown };
type BackendLogin = {
  accessToken: string;
  expiresIn: number;
  admin: { id: string; email: string | null; name: string | null; role: string };
};

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return errorResponse(403, "forbidden", "İstek kaynağı doğrulanamadı.");

  let body: LoginBody;
  try {
    body = (await req.json()) as LoginBody;
  } catch {
    return errorResponse(400, "bad_request", "Geçersiz istek gövdesi.");
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const otp = typeof body.otp === "string" ? body.otp.trim() : "";
  // The code is optional here: the backend decides whether this deployment needs it (ADMIN_DEV_SKIP_MFA).
  if (!email || email.length > 254 || !password || password.length > 256 || (otp && !/^\d{6}$/.test(otp))) {
    return errorResponse(400, "validation_failed", "E-posta ve parola gerekli; doğrulama kodu 6 haneli olmalı.");
  }

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "accept-language": "tr" },
      body: JSON.stringify(otp ? { email, password, otp } : { email, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return errorResponse(502, "backend_unavailable", "Sunucuya ulaşılamadı. Lütfen tekrar deneyin.");
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    const retryAfter = res.headers.get("retry-after");
    // Same generic wording for every credential failure, so the form never reveals which factor was wrong.
    const message =
      res.status === 429
        ? "Çok fazla deneme yapıldı. Lütfen biraz bekleyin."
        : res.status === 401 || res.status === 403
          ? "Giriş bilgileri veya doğrulama kodu hatalı."
          : (data?.error?.message ?? "Giriş yapılamadı.");
    return errorResponse(res.status, data?.error?.code ?? "login_failed", message, retryAfter ? { "retry-after": retryAfter } : undefined);
  }

  const data = (await res.json()) as BackendLogin;
  // Any admin role may sign in; the backend enforces what each role can do on every request.
  if (!data?.accessToken || !ADMIN_ROLES.includes(data.admin?.role as AdminRole)) {
    return errorResponse(403, "forbidden", "Bu hesap yönetici paneline erişemez.");
  }
  const maxAge = Math.max(60, Math.min(Number(data.expiresIn) || 0, 12 * 60 * 60));
  const profile = { email: data.admin.email, name: data.admin.name };

  const response = NextResponse.json({ admin: profile });
  response.cookies.set(SESSION_COOKIE, data.accessToken, cookieOptions(maxAge));
  response.cookies.set(PROFILE_COOKIE, Buffer.from(JSON.stringify(profile)).toString("base64url"), cookieOptions(maxAge));
  return response;
}

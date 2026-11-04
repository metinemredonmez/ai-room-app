import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin } from "@/lib/server/guards";
import { backendAuth, credentialError, readJson, startSession, type BackendSession } from "@/lib/server/session";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return errorResponse(403, "forbidden", "İstek kaynağı doğrulanamadı.");
  const body = await readJson(req);
  if (!body) return errorResponse(400, "bad_request", "Geçersiz istek gövdesi.");

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const otp = typeof body.otp === "string" ? body.otp.trim() : "";
  // The code is optional here: the backend decides whether this deployment needs it (ADMIN_DEV_SKIP_MFA)
  // and answers 403 mfa_enrollment_required to an admin who still has to set up an authenticator.
  if (!email || email.length > 254 || !password || password.length > 256 || (otp && !/^\d{6}$/.test(otp))) {
    return errorResponse(400, "validation_failed", "E-posta ve parola gerekli; doğrulama kodu 6 haneli olmalı.");
  }

  const res = await backendAuth("login", otp ? { email, password, otp } : { email, password });
  if (!res.ok) return credentialError(res);
  return startSession((await res.json()) as BackendSession);
}

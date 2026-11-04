import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, isSameOrigin } from "@/lib/server/guards";
import { backendAuth, credentialError, readJson } from "@/lib/server/session";

/** Enrollment 1/2 for a newly promoted (or MFA-reset) admin: password → a fresh TOTP secret. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return errorResponse(403, "forbidden", "İstek kaynağı doğrulanamadı.");
  const body = await readJson(req);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || email.length > 254 || !password || password.length > 256) {
    return errorResponse(400, "validation_failed", "E-posta ve parola gerekli.");
  }

  const res = await backendAuth("mfa/enroll", { email, password });
  if (!res.ok) return credentialError(res);
  const data = (await res.json()) as { secret?: unknown; otpauth?: unknown };
  if (typeof data.secret !== "string" || typeof data.otpauth !== "string" || !data.otpauth.startsWith("otpauth://")) {
    return errorResponse(502, "bad_gateway", "Beklenmeyen sunucu yanıtı.");
  }
  return NextResponse.json({ secret: data.secret, otpauth: data.otpauth }, { headers: { "cache-control": "no-store" } });
}

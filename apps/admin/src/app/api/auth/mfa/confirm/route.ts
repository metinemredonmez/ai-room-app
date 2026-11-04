import type { NextRequest } from "next/server";
import { errorResponse, isSameOrigin } from "@/lib/server/guards";
import { backendAuth, credentialError, readJson, startSession, type BackendSession } from "@/lib/server/session";

/** Enrollment 2/2: the first code proves the authenticator works → session + 10 recovery codes (shown once). */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return errorResponse(403, "forbidden", "İstek kaynağı doğrulanamadı.");
  const body = await readJson(req);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const otp = typeof body?.otp === "string" ? body.otp.trim() : "";
  if (!email || email.length > 254 || !password || password.length > 256 || !/^\d{6}$/.test(otp)) {
    return errorResponse(400, "validation_failed", "E-posta, parola ve 6 haneli kod gerekli.");
  }

  const res = await backendAuth("mfa/confirm", { email, password, otp });
  if (!res.ok) return credentialError(res);
  const data = (await res.json()) as BackendSession & { backupCodes?: unknown };
  const backupCodes = Array.isArray(data.backupCodes) ? data.backupCodes.filter((c): c is string => typeof c === "string") : [];
  const response = startSession(data, { backupCodes });
  response.headers.set("cache-control", "no-store");
  return response;
}

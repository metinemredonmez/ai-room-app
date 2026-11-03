import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { COOKIE, csrfRejected, isSameOrigin, jsonError, refreshSession } from "@/lib/server/backend";
import { exchangeForSession, readCredentials } from "@/lib/server/auth-route";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return csrfRejected();
  const creds = readCredentials(await req.json().catch(() => null));
  if (!creds) return jsonError(400, "validation_failed", "E-posta veya parola geçersiz.");
  if (creds.password.length < 10) return jsonError(400, "validation_failed", "Parola en az 10 karakter olmalı.");
  // A current guest session is forwarded so the backend upgrades that account (designs are kept).
  const store = await cookies();
  let bearer = store.get(COOKIE.access)?.value ?? null;
  if (!bearer && store.get(COOKIE.refresh)?.value) bearer = await refreshSession();
  return exchangeForSession({
    method: "POST",
    path: "/auth/register",
    body: JSON.stringify(creds),
    contentType: "application/json",
    bearer,
  });
}

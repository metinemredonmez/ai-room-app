import type { NextRequest } from "next/server";
import { csrfRejected, isSameOrigin, jsonError } from "@/lib/server/backend";
import { exchangeForSession, readCredentials } from "@/lib/server/auth-route";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return csrfRejected();
  const creds = readCredentials(await req.json().catch(() => null));
  if (!creds) return jsonError(400, "validation_failed", "E-posta veya parola geçersiz.");
  return exchangeForSession({
    method: "POST",
    path: "/auth/login",
    body: JSON.stringify({ email: creds.email, password: creds.password }),
    contentType: "application/json",
  });
}

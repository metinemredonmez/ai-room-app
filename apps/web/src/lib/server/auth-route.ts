import "server-only";
import type { AuthResponse } from "@/lib/types";
import { backendUnavailable, callBackend, getLocale, relay, setAuthCookies, type BackendCall } from "./backend";

/**
 * Calls a backend auth endpoint and, on success, moves the tokens into httpOnly cookies.
 * The browser only receives `{ user }`.
 */
export async function exchangeForSession(call: Omit<BackendCall, "locale">): Promise<Response> {
  let res: Response;
  try {
    res = await callBackend({ ...call, locale: await getLocale() });
  } catch {
    return backendUnavailable();
  }
  if (!res.ok) return relay(res);
  const auth = (await res.json()) as AuthResponse;
  await setAuthCookies(auth);
  return Response.json({ user: auth.user }, { headers: { "cache-control": "no-store" } });
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export function readCredentials(input: unknown): { email: string; password: string; name?: string } | null {
  if (!input || typeof input !== "object") return null;
  const { email, password, name } = input as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  if (!EMAIL.test(trimmed) || password.length < 1 || password.length > 200) return null;
  const cleanName = typeof name === "string" ? name.trim().slice(0, 80) : undefined;
  return { email: trimmed, password, ...(cleanName ? { name: cleanName } : {}) };
}

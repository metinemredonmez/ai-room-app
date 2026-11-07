"use client";

import type { User } from "./types";

// Browser-side client. It only talks to this app's own BFF routes (/api/...), never to the backend.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter?: number,
    /** The backend's X-Request-Id: attached to a support ticket from the error screen. */
    public requestId?: string,
    /** Extra fields of the error body (e.g. `pro` on `coach_quota`). */
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", "Bağlantı kurulamadı.");
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } & Record<string, unknown> } | null)?.error;
    const retry = Number(res.headers.get("retry-after"));
    const rid = res.headers.get("x-request-id");
    throw new ApiError(res.status, err?.code ?? "internal", err?.message ?? "Beklenmeyen bir hata oluştu.", retry || undefined, rid && /^[A-Za-z0-9-]{8,64}$/.test(rid) ? rid : undefined, err ?? undefined);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(`/api/v1${path}`, "GET"),
  post: <T>(path: string, body?: unknown) => request<T>(`/api/v1${path}`, "POST", body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>(`/api/v1${path}`, "PATCH", body),
  del: (path: string) => request<void>(`/api/v1${path}`, "DELETE"),
};

export const authApi = {
  guest: () => request<{ user: User }>("/api/auth/guest", "POST", {}),
  login: (email: string, password: string) => request<{ user: User }>("/api/auth/login", "POST", { email, password }),
  register: (email: string, password: string, name?: string) =>
    request<{ user: User }>("/api/auth/register", "POST", { email, password, name }),
  logout: () => request<void>("/api/auth/logout", "POST", {}),
  forgotPassword: (email: string) => api.post<{ ok: true }>("/auth/password/forgot", { email }),
  resetPassword: (token: string, password: string) => api.post<void>("/auth/password/reset", { token, password }),
  verifyEmail: (token: string) => api.post<{ ok: true; welcomeCredits?: number }>("/auth/email/verify", { token }),
  resendVerification: () => api.post<{ ok: true; alreadyVerified: boolean }>("/auth/email/resend"),
};

/** Reads `#token=…` once and strips it from the address bar so it doesn't linger in history. */
/** API.md §7.23: a firm's e-mail invitation. */
export type InviteInfo = { orgName: string; role: "OWNER" | "ADMIN" | "MEMBER"; email: string; status: "pending" | "accepted" | "revoked" | "expired"; expiresAt: string };
export const orgsApi = {
  lookupInvite: (token: string) => api.post<InviteInfo>("/orgs/invites/lookup", { token }),
  acceptInvite: (token: string) => api.post<{ orgId: string; orgName: string; role: string; already: boolean }>("/orgs/invites/accept", { token }),
};

export function takeFragmentToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (token) window.history.replaceState(null, "", window.location.pathname);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function downloadUrl(imageUrl: string) {
  return `/api/download?src=${encodeURIComponent(imageUrl)}`;
}

/** Only http(s) links from AI output are ever rendered as hrefs (WEB-01). */
export function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

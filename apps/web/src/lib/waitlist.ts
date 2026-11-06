import "server-only";
import { cacheLife, cacheTag } from "next/cache";

// Waiting list status from the API (API.md §7.47), cached for a few minutes: whether the sign-up form shows and, once
// the apps are out, the store links (Admin → Ayarlar → uygulama sürümleri). Only the official store hosts are
// accepted as links (EXT-02). If the API cannot be read, the form stays hidden.

const API = (process.env.API_BASE_URL ?? "http://localhost:4000/v1").replace(/\/+$/, "");
const STORE = { ios: /^https:\/\/apps\.apple\.com\/[^\s"'<>]*$/, android: /^https:\/\/play\.google\.com\/[^\s"'<>]*$/ };

export type WaitlistStatus = { enabled: boolean; stores: { ios: string | null; android: string | null } };
export const WAITLIST_OFF: WaitlistStatus = { enabled: false, stores: { ios: null, android: null } };

export function cleanWaitlistStatus(raw: unknown): WaitlistStatus {
  const r = raw as { enabled?: unknown; stores?: { ios?: unknown; android?: unknown } } | null;
  if (!r || typeof r !== "object") return WAITLIST_OFF;
  const store = (v: unknown, re: RegExp) => (typeof v === "string" && v.length <= 300 && re.test(v) ? v : null);
  return { enabled: r.enabled === true, stores: { ios: store(r.stores?.ios, STORE.ios), android: store(r.stores?.android, STORE.android) } };
}

export async function waitlistStatus(): Promise<WaitlistStatus> {
  "use cache";
  cacheLife("minutes");
  cacheTag("waitlist");
  try {
    const res = await fetch(`${API}/waitlist/status`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(3000) });
    return res.ok ? cleanWaitlistStatus(await res.json()) : WAITLIST_OFF;
  } catch {
    return WAITLIST_OFF;
  }
}

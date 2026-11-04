import "server-only";
import { isIP } from "node:net";
import { headers } from "next/headers";

/**
 * The admin's IP as nginx saw it (nginx overwrites X-Forwarded-For with $remote_addr, so the browser can't forge
 * it). Forwarded to the backend so its per-IP limits and the audit log see the real address, not 127.0.0.1.
 */
export async function forwardedFor(): Promise<Record<string, string>> {
  try {
    const last = ((await headers()).get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop();
    return last && isIP(last) ? { "x-forwarded-for": last } : {};
  } catch {
    return {};
  }
}

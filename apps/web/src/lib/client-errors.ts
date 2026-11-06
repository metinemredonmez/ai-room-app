// API.md §7.43: crashes in the browser are reported to our own error list (no third-party tracker). At most five
// reports per page load, each distinct error once; noise we cannot act on (browser extensions, cross-origin
// "Script error.", ResizeObserver, aborted or offline requests) is dropped. The server masks personal data again.

const MAX_PER_PAGE = 5;
const NOISE = [/ResizeObserver loop/i, /^Script error\.?$/i, /(chrome|moz|safari(-web)?)-extension:/i, /AbortError|The user aborted|Load failed|Failed to fetch|NetworkError/i];
const sent = new Set<string>();

export function reportClientError(e: unknown, route?: string) {
  if (typeof window === "undefined" || sent.size >= MAX_PER_PAGE) return;
  const err = e instanceof Error ? e : new Error(typeof e === "string" ? e : "Unknown error");
  const message = (err.message || "Unknown error").slice(0, 1000);
  if (NOISE.some((r) => r.test(message) || r.test(err.stack ?? ""))) return;
  const key = `${err.name}:${message}`.slice(0, 200);
  if (sent.has(key)) return;
  sent.add(key);
  const body = { platform: "web", name: (err.name || "Error").slice(0, 80), message, stack: err.stack?.slice(0, 4000), route: (route ?? window.location.pathname).slice(0, 200) };
  void fetch("/api/v1/client-errors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
}

// Partner links (API.md §7.33): /p/<slug> remembers the partner on this device for 30 days; the first account made
// here within that time is attributed to it once (the server only accepts accounts younger than 24 h).

const KEY = "casalume.via";
const TTL_MS = 30 * 24 * 3600 * 1000;

export function rememberVia(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) return;
  try {
    // First touch wins: a later partner link does not replace an earlier one still in time.
    const old = storedVia();
    if (!old) localStorage.setItem(KEY, JSON.stringify({ slug, at: Date.now() }));
  } catch {
    /* storage blocked: the visit is still counted */
  }
}

export function storedVia(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as { slug?: string; at?: number } | null;
    if (!v?.slug || !v.at || Date.now() - v.at > TTL_MS) return null;
    return v.slug;
  } catch {
    return null;
  }
}

export function forgetVia() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}

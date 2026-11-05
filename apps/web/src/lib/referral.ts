// Invite links (API.md §7.30): /giris?ref=CODE keeps the friend's code for 14 days on this device, so it is still
// there after signing up and verifying the e-mail (often in another tab), and fills the "invite code" box.

const KEY = "casalume.ref";
const TTL_MS = 14 * 24 * 3600 * 1000;

export function rememberReferral(raw: string | null) {
  if (!raw || !/^[A-Za-z0-9-]{6,20}$/.test(raw)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ code: raw.toUpperCase(), at: Date.now() }));
  } catch {
    /* storage blocked: the code can still be typed */
  }
}

export function storedReferral(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as { code?: string; at?: number } | null;
    if (!v?.code || !v.at || Date.now() - v.at > TTL_MS) return null;
    return v.code;
  } catch {
    return null;
  }
}

export function forgetReferral() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}

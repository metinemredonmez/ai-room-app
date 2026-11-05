// Colour themes from the admin (API.md §7.34). The list, the default and every colour come from `GET /v1/theme`;
// the layout writes them into a <style> element on the server (lib/theme.ts), so the right colours paint first. The
// visitor's choice is a per-browser convenience kept in localStorage — a blocked or empty storage just means the
// default theme, and a theme the admin has since switched off simply has no CSS rule any more.

export type ThemeOption = { id: string; name: { tr: string; en: string }; tones: string[]; primary: string };
export type ThemeOptions = { defaultId: string; palettes: ThemeOption[] };

export const PALETTE_KEY = "casalume-palette";
export const PALETTE_ID_RE = /^[a-z][a-z0-9-]{1,23}$/;

/** Runs before first paint (layout <head>) so a saved theme never flashes the default first. Tiny, no dependencies. */
export const PALETTE_BOOT_SCRIPT = `try{var p=localStorage.getItem("${PALETTE_KEY}");if(p&&${PALETTE_ID_RE.toString()}.test(p))document.documentElement.dataset.palette=p}catch(e){}`;

const CHANGE = "casalume:palette";

/** useSyncExternalStore wiring: the server and first client render say "no choice", then the real value follows. */
export function subscribePalette(cb: () => void): () => void {
  window.addEventListener(CHANGE, cb);
  return () => window.removeEventListener(CHANGE, cb);
}

export function chosenPalette(): string | null {
  if (typeof document === "undefined") return null;
  const p = document.documentElement.dataset.palette;
  return p && PALETTE_ID_RE.test(p) ? p : null;
}

export function setPalette(id: string, defaultId: string) {
  if (!PALETTE_ID_RE.test(id)) return;
  const root = document.documentElement;
  if (id === defaultId) delete root.dataset.palette;
  else root.dataset.palette = id;
  window.dispatchEvent(new Event(CHANGE));
  try {
    if (id === defaultId) localStorage.removeItem(PALETTE_KEY);
    else localStorage.setItem(PALETTE_KEY, id);
  } catch {
    // Private mode or blocked storage: the theme still applies for this page view.
  }
}

// Colour themes (globals.css `:root[data-palette=…]`). Kil is the brand default; the choice is a per-browser
// convenience kept in localStorage — nothing depends on it, so a blocked or empty storage just means Kil.

export const PALETTES = [
  { id: "kil", tr: "Kil", en: "Clay", swatch: "#c9673e" },
  { id: "pirinc", tr: "Pirinç", en: "Brass", swatch: "#c8a46a" },
  { id: "murekkep", tr: "Mürekkep", en: "Ink", swatch: "#24406e" },
  { id: "erik", tr: "Erik", en: "Plum", swatch: "#7a3e63" },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

export const PALETTE_KEY = "casalume-palette";
const IDS: readonly string[] = PALETTES.map((p) => p.id);

export function isPalette(v: unknown): v is PaletteId {
  return typeof v === "string" && IDS.includes(v);
}

/** Runs before first paint (layout <head>) so a saved theme never flashes Kil first. Kept tiny and dependency-free. */
export const PALETTE_BOOT_SCRIPT = `try{var p=localStorage.getItem("${PALETTE_KEY}");if(${JSON.stringify(IDS)}.indexOf(p)>0)document.documentElement.dataset.palette=p}catch(e){}`;

const CHANGE = "casalume:palette";

/** useSyncExternalStore wiring: the server and first client render say "kil", then the real value follows. */
export function subscribePalette(cb: () => void): () => void {
  window.addEventListener(CHANGE, cb);
  return () => window.removeEventListener(CHANGE, cb);
}

export function currentPalette(): PaletteId {
  if (typeof document === "undefined") return "kil";
  const p = document.documentElement.dataset.palette;
  return isPalette(p) ? p : "kil";
}

export function setPalette(id: PaletteId) {
  const root = document.documentElement;
  if (id === "kil") delete root.dataset.palette;
  else root.dataset.palette = id;
  window.dispatchEvent(new Event(CHANGE));
  try {
    if (id === "kil") localStorage.removeItem(PALETTE_KEY);
    else localStorage.setItem(PALETTE_KEY, id);
  } catch {
    // Private mode or blocked storage: the theme still applies for this page view.
  }
}

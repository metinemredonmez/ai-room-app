// Panel colour themes (globals.css `:root[data-palette=…]`); Kil is the default. The choice lives in a cookie so the
// root layout renders the right theme on the server — no flash, and no inline script under the strict nonce CSP.

export const PALETTES = [
  { id: "kil", label: "Kil", swatch: "#c9673e" },
  { id: "pirinc", label: "Pirinç", swatch: "#c8a46a" },
  { id: "murekkep", label: "Mürekkep", swatch: "#24406e" },
  { id: "erik", label: "Erik", swatch: "#7a3e63" },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

export const PALETTE_COOKIE = "casalume_admin_palette";

export function isPalette(v: unknown): v is PaletteId {
  return typeof v === "string" && PALETTES.some((p) => p.id === v);
}

export function setPalette(id: PaletteId) {
  const root = document.documentElement;
  if (id === "kil") delete root.dataset.palette;
  else root.dataset.palette = id;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${PALETTE_COOKIE}=${id}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

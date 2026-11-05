import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { PALETTE_ID_RE, type ThemeOptions } from "./palette";

// Colour themes from the API (API.md §7.34), cached for a few minutes like the blog: a change in the admin reaches
// the site without a deploy. The colours go into a <style> element, so everything is re-checked here even though the
// API already validates it (INP-01 / WEB-01): ids must be slugs and every value a #rrggbb colour, or the palette is
// dropped. If the API cannot be read, nothing is written and globals.css keeps the built-in Kil theme.

const API = (process.env.API_BASE_URL ?? "http://localhost:4000/v1").replace(/\/+$/, "");
const HEX = /^#[0-9a-f]{6}$/;

const VARS = {
  primary: "--primary",
  primaryStrong: "--primary-strong",
  primarySoft: "--primary-soft",
  accent: "--accent",
  accentSoft: "--accent-soft",
  bg: "--bg",
  surface: "--surface",
  surface2: "--surface-2",
  text: "--text",
  muted: "--muted",
  border: "--border",
} as const;
type TokenKey = keyof typeof VARS;
const TOKEN_KEYS = Object.keys(VARS) as TokenKey[];

export type ThemePalette = { id: string; name: { tr: string; en: string }; tones: string[]; tokens: Record<TokenKey, string> };
export type ThemeData = { defaultId: string; palettes: ThemePalette[] };

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

/** Keeps only well-formed palettes; null when the default is missing or nothing is left. */
export function cleanTheme(raw: unknown): ThemeData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { defaultId?: unknown; palettes?: unknown };
  if (typeof r.defaultId !== "string" || !Array.isArray(r.palettes)) return null;
  const palettes: ThemePalette[] = [];
  for (const p of r.palettes.slice(0, 24) as Array<Record<string, unknown>>) {
    const id = typeof p?.id === "string" && PALETTE_ID_RE.test(p.id) ? p.id : null;
    const name = p?.name as { tr?: unknown; en?: unknown } | undefined;
    const tr = str(name?.tr, 30);
    const en = str(name?.en, 30);
    const tones = Array.isArray(p?.tones) && p.tones.length === 6 && p.tones.every((t) => typeof t === "string" && HEX.test(t)) ? (p.tones as string[]) : null;
    const tk = p?.tokens as Record<string, unknown> | undefined;
    const tokens = tk && TOKEN_KEYS.every((k) => typeof tk[k] === "string" && HEX.test(tk[k] as string)) ? (Object.fromEntries(TOKEN_KEYS.map((k) => [k, tk[k]])) as Record<TokenKey, string>) : null;
    if (id && tr && en && tones && tokens && !palettes.some((x) => x.id === id)) palettes.push({ id, name: { tr, en }, tones, tokens });
  }
  if (!palettes.some((p) => p.id === r.defaultId)) return null;
  return { defaultId: r.defaultId, palettes };
}

export async function getTheme(): Promise<ThemeData | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("theme");
  try {
    const res = await fetch(`${API}/theme`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(3000) });
    return res.ok ? cleanTheme(await res.json()) : null;
  } catch {
    return null;
  }
}

const block = (selector: string, tokens: Record<TokenKey, string>) => `${selector}{${TOKEN_KEYS.map((k) => `${VARS[k]}:${tokens[k]}`).join(";")}}`;

/** `html:root` outranks globals.css's `:root`; a chosen theme is matched by its data-palette attribute. */
export function themeCss(t: ThemeData): string {
  const def = t.palettes.find((p) => p.id === t.defaultId)!;
  return [block("html:root", def.tokens), ...t.palettes.map((p) => block(`html:root[data-palette="${p.id}"]`, p.tokens))].join("\n");
}

/** What the header's theme menu needs. */
export function themeOptions(t: ThemeData): ThemeOptions {
  return { defaultId: t.defaultId, palettes: t.palettes.map((p) => ({ id: p.id, name: p.name, tones: p.tones, primary: p.tokens.primary })) };
}

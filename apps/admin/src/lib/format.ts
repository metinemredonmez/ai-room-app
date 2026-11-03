import type { ToolId } from "./types";

const intFmt = new Intl.NumberFormat("tr-TR");
const compactFmt = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const dateTimeFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });
const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" });

export const fmtInt = (n: number | null | undefined) => (typeof n === "number" ? intFmt.format(n) : "—");
export const fmtCompact = (n: number) => (Math.abs(n) >= 1000 ? compactFmt.format(n) : intFmt.format(n));

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

/** "2026-11-03" → "3 Kas" (axis ticks), parsed as a calendar day, not a UTC instant. */
export function fmtDay(day: string, withYear = false): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(
    new Date(y, m - 1, d),
  );
}

export const TOOL_LABELS: Record<ToolId, string> = {
  redesign: "Yeniden tasarım",
  furnish: "Boş odayı döşe",
  declutter: "Nesne kaldır",
  replace: "Nesne değiştir",
  paint: "Duvar boyası",
  flooring: "Zemin",
  exterior: "Dış cephe",
  garden: "Bahçe",
  reference: "Referans stil",
  custom: "Serbest istek",
};

export const toolLabel = (tool: string) => TOOL_LABELS[tool as ToolId] ?? tool;

export const STATUS_LABELS = {
  PENDING: "Bekliyor",
  SUCCEEDED: "Başarılı",
  FAILED: "Başarısız",
} as const;

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

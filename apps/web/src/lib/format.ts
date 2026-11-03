import type { Locale } from "./types";

export function formatTRY(value: number, locale: Locale = "tr") {
  return new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatRange(min: number, max: number, locale: Locale = "tr") {
  if (Math.round(min) === Math.round(max)) return formatTRY(min, locale);
  return `${formatTRY(min, locale)} – ${formatTRY(max, locale)}`;
}

export function formatDate(iso: string, locale: Locale = "tr") {
  try {
    return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

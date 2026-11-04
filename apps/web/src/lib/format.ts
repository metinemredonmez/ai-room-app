import { LOCALE_TAGS, type Locale } from "./i18n";

export function formatTRY(value: number, locale: Locale = "tr") {
  return new Intl.NumberFormat(LOCALE_TAGS[locale] ?? "tr-TR", {
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
    return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : (LOCALE_TAGS[locale] ?? "tr-TR"), {
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

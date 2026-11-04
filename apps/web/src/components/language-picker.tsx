"use client";

import { Globe } from "lucide-react";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n";
import { useApp } from "./app-provider";
import { btn } from "./ui";

/** All languages in their own names; a native <select> so it works the same with mouse, touch and keyboard. */
export function LanguagePicker() {
  const { locale, setLocale } = useApp();
  return (
    <label className={`${btn.base} ${btn.subtle} relative h-9 cursor-pointer px-3 text-xs`}>
      <Globe className="h-4 w-4" aria-hidden />
      <span>{locale.toUpperCase()}</span>
      <select
        aria-label="Dil / Language"
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_LABELS[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

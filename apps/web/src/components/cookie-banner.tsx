"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "@/components/locale-link";
import { useApp } from "./app-provider";

// Information banner: the site uses only essential cookies (language, theme, session), so there is nothing to opt
// into; the visitor acknowledges once. The choice lives in this browser only; storage that throws (private mode)
// simply shows the banner again next time. Read through useSyncExternalStore so the server render and the first
// client render agree (no banner flash, no setState in an effect).

const KEY = "casalume:cookie-consent";
const subscribe = () => () => {};
const acknowledged = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export function CookieBanner() {
  const { t } = useApp();
  const stored = useSyncExternalStore(subscribe, acknowledged, () => true);
  const [closed, setClosed] = useState(false);
  if (stored || closed) return null;

  function accept() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode: the banner returns next visit */
    }
    setClosed(true);
  }

  return (
    <div role="region" aria-label={t.cookieBanner.accept} className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface p-4 shadow-lg">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p className="text-sm text-muted">
          {t.cookieBanner.text}{" "}
          <Link href="/yasal/kvkk" className="font-medium text-primary underline-offset-4 hover:underline">
            {t.legal.names.kvkk}
          </Link>
        </p>
        <button type="button" onClick={accept} className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          {t.cookieBanner.accept}
        </button>
      </div>
    </div>
  );
}

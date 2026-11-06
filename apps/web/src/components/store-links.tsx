"use client";

import { ArrowRight } from "lucide-react";
import type { WaitlistStatus } from "@/lib/waitlist";
import { useApp } from "./app-provider";
import { btn } from "./ui";

/** App Store and Google Play buttons from the admin's store links (Ayarlar → Zorunlu güncelleme); "soon" without one. */
export function StoreLinks({ stores }: { stores: WaitlistStatus["stores"] }) {
  const { t } = useApp();
  return (
    <div className="flex flex-wrap gap-3">
      {([["ios", "App Store"], ["android", "Google Play"]] as const).map(([k, label]) =>
        stores[k] ? (
          <a key={k} href={stores[k]!} target="_blank" rel="noopener noreferrer" className={`${btn.base} ${btn.ghost} ${btn.md}`}>
            {label} <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        ) : (
          <span key={k} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted">
            {label} <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{t.waitlist.soon}</span>
          </span>
        ),
      )}
    </div>
  );
}

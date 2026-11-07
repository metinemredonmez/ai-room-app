"use client";

import { useState, useSyncExternalStore } from "react";

// API.md §7.52: shown only to staff who opened the preview link while the site is closed for maintenance, so nobody
// takes the preview for the live site. Staff-only, hence Turkish. The proxy sets the flag cookie on each page.

const FLAG = /(?:^|;\s*)air_pv=1(?:;|$)/;
const subscribe = () => () => {};

export function PreviewBadge() {
  const on = useSyncExternalStore(subscribe, () => FLAG.test(document.cookie), () => false);
  const [leaving, setLeaving] = useState(false);
  if (!on) return null;
  return (
    <div role="status" className="fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-lg">
      <span className="size-2 shrink-0 rounded-full bg-[var(--primary)]" aria-hidden />
      <span>Site bakımda · önizleme görüyorsun</span>
      <button
        type="button"
        disabled={leaving}
        className="font-medium text-[var(--primary)] underline-offset-2 hover:underline disabled:opacity-60"
        onClick={() => {
          setLeaving(true);
          void fetch("/api/preview", { method: "DELETE", credentials: "same-origin" }).finally(() => location.reload());
        }}
      >
        Çık
      </button>
    </div>
  );
}

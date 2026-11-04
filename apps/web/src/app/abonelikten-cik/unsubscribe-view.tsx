"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/components/app-provider";
import { LogoMark } from "@/components/logo";
import { btn, card } from "@/components/ui";

/**
 * Link in the footer of a Casalume campaign e-mail (API.md §7.16). Nothing happens on page load: link scanners in
 * mail providers open URLs, so the withdrawal waits for a click (the one-click header covers the inbox button).
 */
export function UnsubscribeView() {
  const { t } = useApp();
  const [state, setState] = useState<"idle" | "working" | "done" | "invalid">("idle");

  async function confirm() {
    const q = new URLSearchParams(window.location.search);
    const r = q.get("r");
    const s = q.get("t");
    if (!r || !s) {
      setState("invalid");
      return;
    }
    setState("working");
    try {
      await api.post("/unsubscribe", { r, t: s });
      setState("done");
    } catch {
      setState("invalid");
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-20">
      <div className={`${card} p-6 sm:p-8`}>
        <LogoMark className="h-11 w-11" />
        <h1 className="mt-5 text-3xl font-display font-light">{t.unsubscribe.title}</h1>
        {(state === "idle" || state === "working") && (
          <>
            <p className="mt-3 text-sm text-muted">{t.unsubscribe.text}</p>
            <button type="button" onClick={confirm} disabled={state === "working"} className={`${btn.base} ${btn.primary} ${btn.md} mt-6 w-full`}>
              {state === "working" && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
              {t.unsubscribe.button}
            </button>
          </>
        )}
        {state === "done" && (
          <div className="mt-5 flex gap-3 rounded-2xl bg-primary-soft p-4 text-sm text-primary" role="status">
            <CircleCheck className="h-5 w-5 shrink-0" aria-hidden />
            <p>{t.unsubscribe.done}</p>
          </div>
        )}
        {state === "invalid" && (
          <div className="mt-5 flex gap-3 rounded-2xl border border-border p-4 text-sm" role="alert">
            <TriangleAlert className="h-5 w-5 shrink-0 text-danger" aria-hidden />
            <p>{t.unsubscribe.invalid}</p>
          </div>
        )}
        {(state === "done" || state === "invalid") && (
          <Link href="/" className={`${btn.base} ${btn.ghost} ${btn.md} mt-6 w-full`}>
            {t.unsubscribe.home}
          </Link>
        )}
      </div>
    </div>
  );
}

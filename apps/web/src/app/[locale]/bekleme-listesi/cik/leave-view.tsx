"use client";

import Link from "@/components/locale-link";
import { useState } from "react";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/components/app-provider";
import { LogoMark } from "@/components/logo";
import { btn, card } from "@/components/ui";

/**
 * Leave the waiting list and newsletter (API.md §7.47) from the signed link in an e-mail or on the thank-you page.
 * Nothing happens on load (mail scanners open links); the one-click header covers the inbox button.
 */
export function LeaveView() {
  const { t } = useApp();
  const W = t.waitlist;
  const [state, setState] = useState<"idle" | "working" | "done" | "invalid">("idle");

  async function leave() {
    const q = new URLSearchParams(window.location.search);
    const i = q.get("i");
    const s = q.get("t");
    if (!i || !s) {
      setState("invalid");
      return;
    }
    setState("working");
    try {
      await api.post("/waitlist/leave", { i, t: s });
      setState("done");
    } catch {
      setState("invalid");
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-20">
      <div className={`${card} p-6 sm:p-8`}>
        <LogoMark className="h-11 w-11" />
        <h1 className="mt-5 text-3xl font-display font-light">{W.leaveTitle}</h1>
        {(state === "idle" || state === "working") && (
          <>
            <p className="mt-3 text-sm text-muted">{W.leaveText}</p>
            <button type="button" onClick={leave} disabled={state === "working"} className={`${btn.base} ${btn.primary} ${btn.md} mt-6 w-full`}>
              {state === "working" && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
              {W.leaveButton}
            </button>
          </>
        )}
        {state === "done" && (
          <div className="mt-5 flex gap-3 rounded-2xl bg-primary-soft p-4 text-sm text-primary" role="status">
            <CircleCheck className="h-5 w-5 shrink-0" aria-hidden />
            <p>{W.leaveDone}</p>
          </div>
        )}
        {state === "invalid" && (
          <div className="mt-5 flex gap-3 rounded-2xl border border-border p-4 text-sm" role="alert">
            <TriangleAlert className="h-5 w-5 shrink-0 text-danger" aria-hidden />
            <p>{W.leaveInvalid}</p>
          </div>
        )}
        {(state === "done" || state === "invalid") && (
          <Link href="/" className={`${btn.base} ${btn.ghost} ${btn.md} mt-6 w-full`}>
            {W.home}
          </Link>
        )}
      </div>
    </div>
  );
}

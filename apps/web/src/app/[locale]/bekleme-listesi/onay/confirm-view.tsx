"use client";

import Link from "@/components/locale-link";
import { useEffect, useRef, useState } from "react";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { api, takeFragmentToken } from "@/lib/api";
import { useApp } from "@/components/app-provider";
import { LogoMark } from "@/components/logo";
import { btn, card } from "@/components/ui";

/**
 * Double opt-in for the waiting list (API.md §7.47). The token is read from the fragment (never sent to a server) and
 * used only on a click: mail scanners that open links must not be able to sign anyone up.
 */
export function ConfirmView() {
  const { t } = useApp();
  const W = t.waitlist;
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "working" | "done" | "invalid">("idle");
  const [leave, setLeave] = useState<{ i: string; t: string } | null>(null);
  const read = useRef(false);

  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const tk = takeFragmentToken();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tk) setToken(tk);
    else setState("invalid");
  }, []);

  async function confirm() {
    if (!token) return;
    setState("working");
    try {
      const r = await api.post<{ ok: true; leave: { i: string; t: string } | null }>("/waitlist/confirm", { token });
      setLeave(r.leave);
      setState("done");
    } catch {
      setState("invalid");
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-20">
      <div className={`${card} p-6 sm:p-8`}>
        <LogoMark className="h-11 w-11" />
        <h1 className="mt-5 text-3xl font-display font-light">{W.confirmTitle}</h1>
        {(state === "idle" || state === "working") && (
          <>
            <p className="mt-3 text-sm text-muted">{W.confirmText}</p>
            <button type="button" onClick={confirm} disabled={!token || state === "working"} className={`${btn.base} ${btn.primary} ${btn.md} mt-6 w-full`}>
              {state === "working" && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
              {W.confirmButton}
            </button>
          </>
        )}
        {state === "done" && (
          <>
            <div className="mt-5 flex gap-3 rounded-2xl bg-primary-soft p-4 text-sm text-primary" role="status">
              <CircleCheck className="h-5 w-5 shrink-0" aria-hidden />
              <p>{W.confirmDone}</p>
            </div>
            {leave && (
              <Link href={`/bekleme-listesi/cik?i=${encodeURIComponent(leave.i)}&t=${encodeURIComponent(leave.t)}`} className="mt-4 block text-center text-xs text-muted underline underline-offset-2 hover:text-text">
                {W.leaveOffer}
              </Link>
            )}
          </>
        )}
        {state === "invalid" && (
          <div className="mt-5 flex gap-3 rounded-2xl border border-border p-4 text-sm" role="alert">
            <TriangleAlert className="h-5 w-5 shrink-0 text-danger" aria-hidden />
            <p>{W.confirmInvalid}</p>
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

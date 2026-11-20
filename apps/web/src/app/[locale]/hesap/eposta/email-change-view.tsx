"use client";

import Link from "@/components/locale-link";
import { useEffect, useRef, useState } from "react";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { api, takeFragmentToken } from "@/lib/api";
import { useApp } from "@/components/app-provider";
import { LogoMark } from "@/components/logo";
import { btn, card } from "@/components/ui";

export function EmailChangeView() {
  const { t, refreshUser } = useApp();
  const [state, setState] = useState<"working" | "done" | "invalid">("working");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode double-invoke would burn the single-use token
    started.current = true;
    const token = takeFragmentToken();
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot token consume, StrictMode-guarded below
      setState("invalid");
      return;
    }
    api
      .post("/me/email/confirm", { token })
      .then(() => {
        setState("done");
        void refreshUser(); // the session survives, but the address shown everywhere updates
      })
      .catch(() => setState("invalid"));
  }, [refreshUser]);

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-20">
      <div className={`${card} p-6 sm:p-8`}>
        <LogoMark className="h-11 w-11" />
        <h1 className="mt-5 font-display text-3xl font-light">{t.emailChange.title}</h1>
        {state === "working" && (
          <p className="mt-5 flex items-center gap-2 text-sm text-muted" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {t.emailChange.working}
          </p>
        )}
        {state === "done" && (
          <>
            <div className="mt-5 flex gap-3 rounded-2xl bg-primary-soft p-4 text-sm text-primary" role="status">
              <CircleCheck className="h-5 w-5 shrink-0" aria-hidden />
              <p>{t.emailChange.done}</p>
            </div>
            <Link href="/hesap" className={`${btn.base} ${btn.primary} ${btn.md} mt-6 w-full`}>
              {t.emailChange.toAccount}
            </Link>
          </>
        )}
        {state === "invalid" && (
          <>
            <div className="mt-5 flex gap-3 rounded-2xl bg-danger-soft p-4 text-sm text-danger" role="alert">
              <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden />
              <p>{t.emailChange.invalid}</p>
            </div>
            <Link href="/hesap" className={`${btn.base} ${btn.ghost} ${btn.md} mt-6 w-full`}>
              {t.emailChange.toAccount}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

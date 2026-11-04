"use client";

import Link from "@/components/locale-link";
import { useEffect, useRef, useState } from "react";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { authApi, takeFragmentToken } from "@/lib/api";
import { useApp } from "@/components/app-provider";
import { LogoMark } from "@/components/logo";
import { btn, card } from "@/components/ui";

export function VerifyView() {
  const { t, user, refreshUser } = useApp();
  const [state, setState] = useState<"working" | "done" | "invalid">("working");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode double-invoke would burn the single-use token
    started.current = true;
    const token = takeFragmentToken();
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("invalid");
      return;
    }
    authApi
      .verifyEmail(token)
      .then(() => {
        setState("done");
        void refreshUser();
      })
      .catch(() => setState("invalid"));
  }, [refreshUser]);

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-20">
      <div className={`${card} p-6 sm:p-8`}>
        <LogoMark className="h-11 w-11" />
        <h1 className="mt-5 text-3xl font-display font-light">{t.account.verifyTitle}</h1>
        {state === "working" && (
          <p className="mt-5 flex items-center gap-2 text-sm text-muted" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {t.account.verifying}
          </p>
        )}
        {state === "done" && (
          <>
            <div className="mt-5 flex gap-3 rounded-2xl bg-primary-soft p-4 text-sm text-primary" role="status">
              <CircleCheck className="h-5 w-5 shrink-0" aria-hidden />
              <p>{t.account.verifyDone}</p>
            </div>
            <Link href="/studio" className={`${btn.base} ${btn.primary} ${btn.md} mt-6 w-full`}>
              {t.account.toStudio}
            </Link>
          </>
        )}
        {state === "invalid" && (
          <>
            <div className="mt-5 flex gap-3 rounded-2xl border border-border p-4 text-sm" role="alert">
              <TriangleAlert className="h-5 w-5 shrink-0 text-danger" aria-hidden />
              <p>{t.account.invalidLink}</p>
            </div>
            <Link href={user && !user.isGuest ? "/studio" : "/giris"} className={`${btn.base} ${btn.ghost} ${btn.md} mt-6 w-full`}>
              {user && !user.isGuest ? t.account.toStudio : t.account.toLogin}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

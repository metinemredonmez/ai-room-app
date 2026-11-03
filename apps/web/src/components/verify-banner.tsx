"use client";

import { useState } from "react";
import { MailWarning } from "lucide-react";
import { authApi } from "@/lib/api";
import { useApp } from "@/components/app-provider";

/** Shown to registered users whose e-mail address is not verified yet. */
export function VerifyBanner() {
  const { t, user } = useApp();
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  if (!user || user.isGuest || user.emailVerified) return null;

  async function resend() {
    setState("busy");
    try {
      await authApi.resendVerification();
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="border-b border-border bg-accent-soft">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-text sm:px-6">
        <MailWarning className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <span>{t.account.bannerText}</span>
        {state === "sent" ? (
          <span className="font-semibold text-primary" role="status">
            {t.account.bannerSent}
          </span>
        ) : (
          <button type="button" onClick={resend} disabled={state === "busy"} className="font-semibold text-accent underline-offset-2 hover:underline">
            {t.account.bannerResend}
          </button>
        )}
      </div>
    </div>
  );
}

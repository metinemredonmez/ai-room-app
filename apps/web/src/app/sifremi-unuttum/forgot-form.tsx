"use client";

import Link from "next/link";
import { useState } from "react";
import { LoaderCircle, MailCheck } from "lucide-react";
import { authApi } from "@/lib/api";
import { useApp } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import { LogoMark } from "@/components/logo";
import { btn, card, input, label } from "@/components/ui";

export function ForgotForm() {
  const { t } = useApp();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-20">
      <div className={`${card} p-6 sm:p-8`}>
        <LogoMark className="h-11 w-11" />
        <h1 className="mt-5 text-3xl font-display font-light">{t.account.forgotTitle}</h1>
        {sent ? (
          <div className="mt-5 flex gap-3 rounded-2xl bg-primary-soft p-4 text-sm text-primary" role="status">
            <MailCheck className="h-5 w-5 shrink-0" aria-hidden />
            <p>{t.account.forgotSent}</p>
          </div>
        ) : (
          <>
            <p className="mt-1.5 text-sm text-muted">{t.account.forgotText}</p>
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className={label}>
                  {t.auth.email}
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  className={input}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  maxLength={254}
                />
              </div>
              {error ? <ErrorNotice error={error} /> : null}
              <button type="submit" disabled={busy} className={`${btn.base} ${btn.primary} ${btn.md} w-full`}>
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
                {t.account.forgotSubmit}
              </button>
            </form>
          </>
        )}
        <Link href="/giris" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          {t.account.toLogin}
        </Link>
      </div>
    </div>
  );
}

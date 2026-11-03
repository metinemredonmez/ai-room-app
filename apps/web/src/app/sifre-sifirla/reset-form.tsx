"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { ApiError, authApi, takeFragmentToken } from "@/lib/api";
import { useApp } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import { LogoMark } from "@/components/logo";
import { btn, card, input, label } from "@/components/ui";

export function ResetForm() {
  const { t, setUser } = useApp();
  // undefined = not read yet, null = missing/invalid fragment
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    // The token only exists in the URL fragment, so it must be read on the client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(takeFragmentToken());
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError(new ApiError(400, "validation_failed", t.auth.tooShort));
    if (password !== confirm) return setError(new ApiError(400, "validation_failed", t.account.mismatch));
    setBusy(true);
    try {
      await authApi.resetPassword(token!, password);
      setUser(null); // every session was revoked server-side
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_token") setInvalid(true);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  const broken = token === null || invalid;

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-20">
      <div className={`${card} p-6 sm:p-8`}>
        <LogoMark className="h-11 w-11" />
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight">{t.account.resetTitle}</h1>
        {done ? (
          <>
            <div className="mt-5 flex gap-3 rounded-2xl bg-primary-soft p-4 text-sm text-primary" role="status">
              <CircleCheck className="h-5 w-5 shrink-0" aria-hidden />
              <p>{t.account.resetDone}</p>
            </div>
            <Link href="/giris" className={`${btn.base} ${btn.primary} ${btn.md} mt-6 w-full`}>
              {t.auth.submitLogin}
            </Link>
          </>
        ) : broken ? (
          <>
            <div className="mt-5 flex gap-3 rounded-2xl border border-border p-4 text-sm" role="alert">
              <TriangleAlert className="h-5 w-5 shrink-0 text-danger" aria-hidden />
              <p>{t.account.invalidLink}</p>
            </div>
            <Link href="/sifremi-unuttum" className={`${btn.base} ${btn.primary} ${btn.md} mt-6 w-full`}>
              {t.account.requestNew}
            </Link>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-sm text-muted">{t.account.resetText}</p>
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="password" className={label}>
                  {t.account.newPassword}
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={10}
                  maxLength={128}
                  className={input}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <p className="mt-1.5 text-xs text-muted">{t.auth.passwordHint}</p>
              </div>
              <div>
                <label htmlFor="confirm" className={label}>
                  {t.account.confirmPassword}
                </label>
                <input
                  id="confirm"
                  type="password"
                  required
                  minLength={10}
                  maxLength={128}
                  className={input}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              {error ? <ErrorNotice error={error} /> : null}
              <button type="submit" disabled={busy || token === undefined} className={`${btn.base} ${btn.primary} ${btn.md} w-full`}>
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
                {t.account.resetSubmit}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

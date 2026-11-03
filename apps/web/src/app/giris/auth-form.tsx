"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, UserRound } from "lucide-react";
import { ApiError, authApi } from "@/lib/api";
import { useApp } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import { LogoMark } from "@/components/logo";
import { btn, card, input, label } from "@/components/ui";

export function AuthForm() {
  const { t, user, setUser, refreshUser } = useApp();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"form" | "guest" | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "register" && password.length < 10) {
      setError(new ApiError(400, "validation_failed", t.auth.tooShort));
      return;
    }
    setBusy("form");
    try {
      const res = mode === "login" ? await authApi.login(email, password) : await authApi.register(email, password, name || undefined);
      setUser(res.user);
      await refreshUser();
      router.push("/studio");
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? new ApiError(401, "validation_failed", t.auth.invalid) : err);
    } finally {
      setBusy(null);
    }
  }

  async function guest() {
    setBusy("guest");
    setError(null);
    try {
      const res = await authApi.guest();
      setUser(res.user);
      router.push("/studio");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-20">
      <div className={`${card} p-6 sm:p-8`}>
        <LogoMark className="h-11 w-11" />
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight">{t.auth.title}</h1>
        <p className="mt-1.5 text-sm text-muted">{t.auth.subtitle}</p>

        <div className="mt-6 grid grid-cols-2 rounded-full bg-surface-2 p-1" role="tablist">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`rounded-full py-2 text-sm font-semibold transition ${mode === m ? "bg-surface text-text shadow-card" : "text-muted"}`}
            >
              {m === "login" ? t.auth.loginTab : t.auth.registerTab}
            </button>
          ))}
        </div>

        {mode === "register" && user?.isGuest && (
          <p className="mt-4 rounded-2xl bg-primary-soft p-3 text-sm text-primary">{t.auth.upgradeNote}</p>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "register" && (
            <div>
              <label htmlFor="name" className={label}>
                {t.auth.name}
              </label>
              <input id="name" className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
            </div>
          )}
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
          <div>
            <label htmlFor="password" className={label}>
              {t.auth.password}
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={mode === "register" ? 10 : 1}
              maxLength={200}
              className={input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
            {mode === "register" && <p className="mt-1.5 text-xs text-muted">{t.auth.passwordHint}</p>}
            {mode === "login" && (
              <Link href="/sifremi-unuttum" className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">
                {t.auth.forgotLink}
              </Link>
            )}
          </div>
          {error ? <ErrorNotice error={error} /> : null}
          <button type="submit" disabled={busy !== null} className={`${btn.base} ${btn.primary} ${btn.md} w-full`}>
            {busy === "form" && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
            {mode === "login" ? t.auth.submitLogin : t.auth.submitRegister}
          </button>
        </form>

        {!user && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-border" /> {t.common.or} <span className="h-px flex-1 bg-border" />
            </div>
            <button type="button" onClick={guest} disabled={busy !== null} className={`${btn.base} ${btn.ghost} ${btn.md} w-full`}>
              {busy === "guest" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <UserRound className="h-4 w-4" aria-hidden />}
              {t.auth.guest}
            </button>
            <p className="mt-2 text-center text-xs text-muted">{t.auth.guestNote}</p>
          </>
        )}
        <p className="mt-6 text-center text-xs text-muted">{t.auth.kvkk}</p>
      </div>
    </div>
  );
}

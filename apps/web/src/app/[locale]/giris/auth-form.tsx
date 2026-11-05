"use client";

import Link from "@/components/locale-link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Eye, EyeOff, LoaderCircle, UserRound } from "lucide-react";
import { ApiError, authApi } from "@/lib/api";
import { useApp, useFeature } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import { LogoMark } from "@/components/logo";
import { btn, input, label } from "@/components/ui";

/** A firm invitation opened before signing in (API.md §7.23) brings the user back to it afterwards. */
function hasPendingInvite() {
  try {
    return Boolean(sessionStorage.getItem("casalume.invite"));
  } catch {
    return false;
  }
}

// Giriş / kayıt: sade iki sütun. Solda form, geniş ekranda sağda gerçek bir önce/sonra görseli ve kısa tanıtım
// (metinler ana sayfanınkiyle aynı, 11 dilde hazır). Görselin kendi "yapay zekâ ile oluşturuldu" etiketi sağ altta görünür kalır.

export function AuthForm() {
  const { t, user, setUser, refreshUser, href } = useApp();
  const feature = useFeature();
  const L = t.landing;
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"form" | "guest" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const login = mode === "login";

  function switchMode(next: "login" | "register") {
    setMode(next);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!login && password.length < 10) {
      setError(new ApiError(400, "validation_failed", t.auth.tooShort));
      return;
    }
    setBusy("form");
    try {
      const res = login ? await authApi.login(email, password) : await authApi.register(email, password, name || undefined);
      setUser(res.user);
      await refreshUser();
      router.push(href(hasPendingInvite() ? "/davet" : "/studio"));
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
      router.push(href("/studio"));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-stretch lg:gap-16">
      <div className="mx-auto flex w-full max-w-sm flex-col justify-center">
        <LogoMark className="h-10 w-10" />
        <h1 className="mt-8 font-display text-4xl font-light tracking-tight">{login ? t.auth.loginTitle : t.auth.registerTitle}</h1>
        <p className="mt-2 text-sm text-muted">{login ? t.auth.subtitle : t.auth.registerSubtitle}</p>

        {!login && user?.isGuest && <p className="mt-6 rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary">{t.auth.upgradeNote}</p>}

        <form onSubmit={submit} className="mt-8 space-y-5">
          {!login && (
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
              inputMode="email"
              maxLength={254}
            />
          </div>
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <label htmlFor="password" className="text-sm font-medium text-text">
                {t.auth.password}
              </label>
              {login && (
                <Link href="/sifremi-unuttum" className="text-sm text-muted transition hover:text-primary">
                  {t.auth.forgotLink}
                </Link>
              )}
            </div>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={login ? 1 : 10}
                maxLength={200}
                className={`${input} pr-12`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={login ? "current-password" : "new-password"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-2xl text-muted transition hover:text-text"
              >
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
            </div>
            {!login && <p className="mt-1.5 text-xs text-muted">{t.auth.passwordHint}</p>}
          </div>
          {error ? <ErrorNotice error={error} /> : null}
          <button type="submit" disabled={busy !== null} className={`${btn.base} ${btn.primary} ${btn.md} w-full`}>
            {busy === "form" && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
            {login ? t.auth.submitLogin : t.auth.submitRegister}
          </button>
        </form>

        {/* API.md §7.28: no "sign up" switch while sign-up is off. */}
        {(feature("signup") || !login) && (
          <p className="mt-5 text-center text-sm text-muted">
            {login ? t.auth.noAccount : t.auth.haveAccount}{" "}
            <button type="button" onClick={() => switchMode(login ? "register" : "login")} className="font-medium text-primary hover:underline">
              {login ? t.auth.registerTab : t.auth.loginTab}
            </button>
          </p>
        )}

        {!user && feature("guest_mode") && (
          <>
            <div className="my-6 flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-border" /> {t.common.or} <span className="h-px flex-1 bg-border" />
            </div>
            <button type="button" onClick={guest} disabled={busy !== null} className={`${btn.base} ${btn.ghost} ${btn.md} w-full`}>
              {busy === "guest" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <UserRound className="h-4 w-4" aria-hidden />}
              {t.auth.guest}
            </button>
            <p className="mt-2 text-center text-xs text-muted">{t.auth.guestNote}</p>
          </>
        )}
        <p className="mt-8 text-xs leading-relaxed text-muted">{t.auth.kvkk}</p>
      </div>

      <aside className="relative hidden min-h-[560px] overflow-hidden rounded-3xl bg-surface-2 lg:block" aria-label={L.badge}>
        <img src="/landing/hero-sonra.webp" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" aria-hidden />
        <span className="absolute right-4 top-4 rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">{L.after}</span>
        <div className="absolute inset-x-0 bottom-0 p-8 pb-14 text-white">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/75">{L.badge}</p>
          <p className="mt-3 max-w-md font-display text-3xl font-light leading-tight">{L.heroTitle}</p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {L.trust.map((item: string) => (
              <li key={item} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs backdrop-blur-sm">
                <Check className="h-3.5 w-3.5" aria-hidden /> {item}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

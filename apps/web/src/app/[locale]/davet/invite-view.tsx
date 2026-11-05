"use client";

import Link from "@/components/locale-link";
import { useEffect, useRef, useState } from "react";
import { Building, CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import { btn, card } from "@/components/ui";
import { ApiError, orgsApi, takeFragmentToken, type InviteInfo } from "@/lib/api";
import { fmt } from "@/lib/i18n";

// Firma daveti (API.md §7.23). Bağlantıdaki tek kullanımlık jeton tarayıcı oturumunda tutulur: giriş ya da kayıt
// sonrası bu sayfaya dönülür (giriş formu bakar) ve davet kabul edilir. Yalnız davetin gönderildiği adresle.

export const PENDING_INVITE_KEY = "casalume.invite";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function storedToken(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_INVITE_KEY);
    return v && TOKEN.test(v) ? v : null;
  } catch {
    return null;
  }
}
function storeToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(PENDING_INVITE_KEY, token);
    else sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    /* private mode: the user can open the e-mail link again after signing in */
  }
}

export function InviteView() {
  const { t, user, userReady, refreshUser } = useApp();
  const s = t.invite;
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "accepted" | "invalid">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const tk = takeFragmentToken() ?? storedToken();
    if (!tk) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("invalid");
      return;
    }
    setToken(tk);
    storeToken(tk);
    orgsApi
      .lookupInvite(tk)
      .then((i) => {
        setInfo(i);
        if (i.status !== "pending") storeToken(null);
        setState("ready");
      })
      .catch(() => {
        storeToken(null);
        setState("invalid");
      });
  }, []);

  async function accept() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await orgsApi.acceptInvite(token);
      storeToken(null);
      setState("accepted");
      void refreshUser();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const code = error instanceof ApiError ? error.code : null;
  const registered = Boolean(user && !user.isGuest);
  const closed = info && info.status !== "pending" ? s[info.status as "expired" | "used" | "revoked"] ?? s.invalid : null;

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-20">
      <div className={`${card} p-6 sm:p-8`}>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Building className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="mt-5 font-display text-3xl font-light">{s.title}</h1>

        {(state === "loading" || !userReady) && (
          <p className="mt-5 flex items-center gap-2 text-sm text-muted" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {s.loading}
          </p>
        )}

        {state === "invalid" && <Notice tone="warn">{s.invalid}</Notice>}

        {state === "accepted" && info && (
          <>
            <Notice tone="good">{fmt(s.accepted, { org: info.orgName })}</Notice>
            <Link href="/studio" className={`${btn.base} ${btn.primary} ${btn.md} mt-6 w-full`}>
              {s.toStudio}
            </Link>
          </>
        )}

        {state === "ready" && userReady && info && (
          <>
            <p className="mt-4 text-sm">{fmt(s.invitedBy, { org: info.orgName })}</p>
            <p className="mt-1 text-sm text-muted">{fmt(s.role, { role: s.roles[info.role] ?? info.role })}</p>
            <p className="mt-1 text-sm text-muted">{fmt(s.sentTo, { email: info.email })}</p>

            {closed ? (
              <Notice tone="warn">{closed}</Notice>
            ) : !registered ? (
              <>
                <p className="mt-5 text-sm">{s.signInPrompt}</p>
                <Link href="/giris" className={`${btn.base} ${btn.primary} ${btn.md} mt-4 w-full`}>
                  {s.signIn}
                </Link>
              </>
            ) : (
              <>
                {code === "invite_email_mismatch" ? (
                  <Notice tone="warn">{fmt(s.mismatch, { email: info.email })}</Notice>
                ) : code === "email_not_verified" ? (
                  <Notice tone="warn">{s.verifyFirst}</Notice>
                ) : code === "invite_expired" || code === "invite_used" || code === "invite_revoked" ? (
                  <Notice tone="warn">{s[code.slice(7) as "expired" | "used" | "revoked"]}</Notice>
                ) : error ? (
                  <div className="mt-5">
                    <ErrorNotice error={error} />
                  </div>
                ) : null}
                <button type="button" onClick={accept} disabled={busy} className={`${btn.base} ${btn.primary} ${btn.md} mt-6 w-full`}>
                  {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
                  {s.accept}
                </button>
                {code === "invite_email_mismatch" && (
                  <Link href="/giris" className={`${btn.base} ${btn.ghost} ${btn.md} mt-3 w-full`}>
                    {s.switchAccount}
                  </Link>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Notice({ tone, children }: { tone: "good" | "warn"; children: React.ReactNode }) {
  return tone === "good" ? (
    <div className="mt-5 flex gap-3 rounded-2xl bg-primary-soft p-4 text-sm text-primary" role="status">
      <CircleCheck className="h-5 w-5 shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  ) : (
    <div className="mt-5 flex gap-3 rounded-2xl border border-border p-4 text-sm" role="alert">
      <TriangleAlert className="h-5 w-5 shrink-0 text-danger" aria-hidden />
      <p>{children}</p>
    </div>
  );
}

"use client";

import { CheckCircle2, Download, LoaderCircle, MonitorSmartphone, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Link from "@/components/locale-link";
import { useApp } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import { btn, card, input, label } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { forgetReferral, storedReferral } from "@/lib/referral";
import { LOCALE_TAGS, fmt } from "@/lib/i18n";

// Hesabım: profile, consents (KVKK), data export, KVKK m.11 requests and account deletion — the web counterpart of
// the app's Profile screen, also the place Google Play's account-deletion link leads to.

type ConsentKind = "terms" | "privacy" | "ai_processing" | "marketing";
type Consents = { current: Record<ConsentKind, { current: string; granted: boolean }> };
type RequestType = "access" | "rectification" | "erasure" | "objection" | "other";
type DataRequest = { id: string; reference: string; type: string; status: "RECEIVED" | "IN_PROGRESS" | "COMPLETED" | "REJECTED"; response: string | null; dueAt: string; receivedAt: string };
const REQUEST_TYPES: RequestType[] = ["access", "rectification", "erasure", "objection", "other"];
type LedgerKind = "daily_free" | "generation" | "refund" | "welcome" | "purchase" | "promo" | "referral" | "gift" | "adjustment" | "other";
type LedgerEntry = { id: string; delta: number; kind: LedgerKind; designId: string | null; productId: string | null; createdAt: string };
type Session = { id: string; device: string; ipPrefix: string; method: string; createdAt: string; lastUsedAt: string; current: boolean };
type LoginEntry = { ok: boolean; method: string; reason: string | null; device: string; ipPrefix: string; createdAt: string };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${card} p-6 sm:p-8`}>
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function AccountView() {
  const { t, locale, user, userReady, refreshUser, logout } = useApp();
  const p = t.profile;
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [ledgerKey, setLedgerKey] = useState(0);

  if (deleted) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden />
        <p className="mt-4 text-lg">{p.deleted}</p>
        <Link href="/" className={`${btn.base} ${btn.ghost} ${btn.md} mt-8`}>
          {t.notFound.cta}
        </Link>
      </div>
    );
  }
  if (!userReady) {
    return <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6"><LoaderCircle className="h-6 w-6 animate-spin text-muted" aria-hidden /></div>;
  }
  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <h1 className="font-display text-4xl font-light">{p.signInTitle}</h1>
        <p className="mt-3 text-muted">{p.signInBody}</p>
        <Link href="/giris" className={`${btn.base} ${btn.primary} ${btn.md} mt-8`}>
          {t.nav.login}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-light">{p.title}</h1>
      {notice && (
        <p className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary" role="status">
          {notice}
        </p>
      )}
      {error ? <ErrorNotice error={error} onRetry={() => setError(null)} /> : null}

      {user.isGuest ? (
        <Section title={p.guestTitle}>
          <p className="text-sm text-muted">{p.guestBody}</p>
          <Link href="/giris" className={`${btn.base} ${btn.primary} ${btn.md} mt-5`}>
            {p.signUp}
          </Link>
        </Section>
      ) : (
        <Profile onError={setError} onSaved={() => setNotice(p.saved)} />
      )}

      <Section title={p.plan}>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">{p.plan}</dt>
            <dd className="mt-1 font-medium">
              {user.plan}
              {user.plan === "PRO" && user.planExpiresAt ? ` · ${formatDate(user.planExpiresAt, locale)}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{p.credits}</dt>
            <dd className="mt-1 font-medium tabular-nums">{user.credits}</dd>
          </div>
          <div>
            <dt className="text-muted">{p.freeLeft}</dt>
            <dd className="mt-1 font-medium tabular-nums">{user.dailyFreeRemaining}</dd>
          </div>
        </dl>
      </Section>

      <PromoSection
        onError={setError}
        onDone={(text) => {
          setNotice(text);
          setLedgerKey((k) => k + 1);
        }}
      />
      <ReferralSection
        onError={setError}
        onDone={(text) => {
          setNotice(text);
          setLedgerKey((k) => k + 1);
        }}
      />
      <LedgerSection key={ledgerKey} onError={setError} />
      <SessionsSection
        onError={setError}
        onNotice={setNotice}
        onSignedOut={async () => {
          await logout().catch(() => undefined);
          await refreshUser().catch(() => null);
        }}
      />
      <ConsentsSection onError={setError} onSaved={() => setNotice(p.consentSaved)} />
      <DataSection onError={setError} />
      <RequestsSection onError={setError} onSent={(ref) => setNotice(fmt(p.kvkkSent, { ref }))} />
      <DeleteSection
        onError={setError}
        onDeleted={async () => {
          await logout().catch(() => undefined);
          await refreshUser().catch(() => null);
          setDeleted(true);
        }}
      />
    </div>
  );
}

/** API.md §7.29: a campaign or gift code adds credits or PRO days (verified accounts only). */
function PromoSection({ onError, onDone }: { onError: (e: unknown) => void; onDone: (text: string) => void }) {
  const { t, locale, user, refreshUser } = useApp();
  const p = t.profile;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const allowed = Boolean(user && !user.isGuest && user.emailVerified);

  async function apply() {
    setBusy(true);
    try {
      const r = await api.post<{ kind: "CREDITS" | "PRO_DAYS"; amount: number; proUntil: string | null }>("/me/promo", { code: code.trim() });
      setCode("");
      await refreshUser().catch(() => null);
      onDone(r.kind === "CREDITS" ? fmt(p.promoCredits, { n: r.amount }) : fmt(p.promoPro, { date: formatDate(r.proUntil ?? "", locale) }));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={p.promoTitle}>
      <p className="text-sm text-muted">{allowed ? p.promoBody : p.promoNeedsAccount}</p>
      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) void apply();
        }}
      >
        <label htmlFor="promo-code" className="sr-only">
          {p.promoTitle}
        </label>
        <input
          id="promo-code"
          className={`${input} font-mono uppercase sm:flex-1`}
          value={code}
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          disabled={!allowed || busy}
          placeholder={p.promoPlaceholder}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="submit" disabled={!allowed || busy || !code.trim()} className={`${btn.base} ${btn.primary} ${btn.md}`}>
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
          {p.promoApply}
        </button>
      </form>
    </Section>
  );
}

type Referral = {
  enabled: boolean;
  code: string | null;
  link: string | null;
  inviterCredits: number;
  inviteeCredits: number;
  stats: { invited: number; rewarded: number; earned: number };
  canClaim: boolean;
  claimed: { status: string; credits: number } | null;
};

/** API.md §7.30: the user's invite link and stats, and the friend's code box for new accounts. */
function ReferralSection({ onError, onDone }: { onError: (e: unknown) => void; onDone: (text: string) => void }) {
  const { t, user, refreshUser } = useApp();
  const p = t.profile;
  const [r, setR] = useState<Referral | null>(null);
  const [code, setCode] = useState(() => storedReferral() ?? "");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = useCallback(() => api.get<Referral>("/me/referral").then(setR).catch(() => setR(null)), []);
  useEffect(() => {
    void load();
  }, [load, user?.id]);

  if (!r?.enabled || user?.isGuest) return null;

  async function claim() {
    setBusy(true);
    try {
      const out = await api.post<{ credits: number }>("/me/referral/claim", { code: code.trim() });
      forgetReferral();
      setCode("");
      await refreshUser().catch(() => null);
      await load();
      onDone(fmt(p.referralClaimed, { n: out.credits }));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!r?.link) return;
    try {
      await navigator.clipboard.writeText(r.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the link stays visible to copy by hand */
    }
  }
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Section title={p.referralTitle}>
      <p className="text-sm text-muted">{fmt(p.referralBody, { invitee: r.inviteeCredits, inviter: r.inviterCredits })}</p>
      {r.link && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input readOnly aria-label={p.referralTitle} value={r.link} className={`${input} font-mono text-xs sm:flex-1`} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex gap-2">
            <button type="button" onClick={() => void copy()} className={`${btn.base} ${btn.primary} ${btn.md}`}>
              {copied ? p.referralCopied : p.referralCopy}
            </button>
            {canShare && (
              <button
                type="button"
                onClick={() => void navigator.share({ text: p.referralShareText, url: r.link! }).catch(() => undefined)}
                className={`${btn.base} ${btn.ghost} ${btn.md}`}
              >
                {p.referralShare}
              </button>
            )}
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{fmt(p.referralStats, { invited: r.stats.invited, rewarded: r.stats.rewarded, earned: r.stats.earned })}</p>
      {r.claimed && <p className="mt-2 text-xs text-primary">{p.referralJoined}</p>}
      {r.canClaim && (
        <form
          className="mt-5 border-t border-border pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) void claim();
          }}
        >
          <label htmlFor="referral-code" className={label}>
            {p.referralClaimTitle}
          </label>
          <div className="mt-1 flex flex-col gap-3 sm:flex-row">
            <input
              id="referral-code"
              className={`${input} font-mono uppercase sm:flex-1`}
              value={code}
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              placeholder={p.referralClaimPlaceholder}
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="submit" disabled={busy || !code.trim()} className={`${btn.base} ${btn.ghost} ${btn.md}`}>
              {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
              {p.referralClaimApply}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

/** API.md §7.24: the user's own credit movements, newest first, paged. */
/** API.md §7.37: signed-in devices (close one or all others) and recent sign-ins, failed attempts included. */
function SessionsSection({ onError, onNotice, onSignedOut }: { onError: (e: unknown) => void; onNotice: (text: string) => void; onSignedOut: () => Promise<void> }) {
  const { t, locale } = useApp();
  const p = t.profile;
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [logins, setLogins] = useState<LoginEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(
    () =>
      Promise.all([api.get<{ items: Session[] }>("/me/sessions"), api.get<{ items: LoginEntry[] }>("/me/logins")])
        .then(([s, l]) => {
          setSessions(s.items);
          setLogins(l.items.slice(0, 8));
        })
        .catch(onError),
    [onError],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const time = (iso: string) => new Date(iso).toLocaleString(LOCALE_TAGS[locale], { dateStyle: "medium", timeStyle: "short" });
  const reasons = p.loginsReasons as Record<string, string>;
  const methods = p.loginsMethods as Record<string, string>;

  async function close(s: Session) {
    setBusy(s.id);
    try {
      await api.del(`/me/sessions/${s.id}`);
      if (s.current) return void (await onSignedOut());
      onNotice(p.sessionsClosed);
      await load();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  async function closeOthers() {
    setBusy("others");
    try {
      const r = await api.post<{ revoked: number }>("/me/sessions/revoke-others", {});
      onNotice(fmt(p.sessionsClosedOthers, { n: String(r.revoked) }));
      await load();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title={p.sessionsTitle}>
      <p className="text-sm text-muted">{p.sessionsBody}</p>
      {sessions === null ? (
        <LoaderCircle className="mt-5 h-5 w-5 animate-spin text-muted" aria-hidden />
      ) : sessions.length === 0 ? (
        <p className="mt-5 text-sm text-muted">{p.sessionsEmpty}</p>
      ) : (
        <ul className="mt-5 divide-y divide-border">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div className="flex min-w-0 items-start gap-3">
                <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.device}
                    {s.current && <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-normal text-primary">{p.sessionsThis}</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {fmt(p.sessionsLastUsed, { time: time(s.lastUsedAt) })} · {s.ipPrefix}
                  </p>
                </div>
              </div>
              <button type="button" className={`${btn.base} ${btn.ghost} ${btn.sm} shrink-0`} disabled={busy !== null} onClick={() => void close(s)}>
                {busy === s.id ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : p.sessionsClose}
              </button>
            </li>
          ))}
        </ul>
      )}
      {sessions && sessions.length > 1 && (
        <button type="button" className={`${btn.base} ${btn.ghost} ${btn.sm} mt-4`} disabled={busy !== null} onClick={() => void closeOthers()}>
          {busy === "others" && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />} {p.sessionsCloseOthers}
        </button>
      )}
      <p className="mt-3 text-xs text-muted">{p.sessionsIpNote}</p>

      <h3 className="mt-8 text-sm font-medium">{p.loginsTitle}</h3>
      {logins === null ? null : (
        <ul className="mt-3 divide-y divide-border">
          {logins.map((l, i) => (
            <li key={`${l.createdAt}-${i}`} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className={l.ok ? "" : "font-medium text-danger"}>
                  {l.ok ? p.loginsOk : p.loginsFailed}
                  {methods[l.method] ? ` · ${methods[l.method]}` : ""}
                  {!l.ok && l.reason && reasons[l.reason] ? ` (${reasons[l.reason]})` : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {l.device} · {l.ipPrefix}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted">{time(l.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function LedgerSection({ onError }: { onError: (e: unknown) => void }) {
  const { t, locale } = useApp();
  const p = t.profile;
  const [items, setItems] = useState<LedgerEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fetchPage = useCallback((cursor: string | null) => api.get<{ items: LedgerEntry[]; nextCursor: string | null }>(`/me/credits?limit=20${cursor ? `&cursor=${cursor}` : ""}`), []);
  useEffect(() => {
    fetchPage(null)
      .then((r) => {
        setItems(r.items);
        setNext(r.nextCursor);
      })
      .catch(onError);
  }, [fetchPage, onError]);
  async function more() {
    if (!next) return;
    setBusy(true);
    try {
      const r = await fetchPage(next);
      setItems((prev) => [...(prev ?? []), ...r.items]);
      setNext(r.nextCursor);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const time = (iso: string) => new Date(iso).toLocaleString(LOCALE_TAGS[locale], { dateStyle: "medium", timeStyle: "short" });

  return (
    <Section title={p.ledgerTitle}>
      <p className="text-sm text-muted">{p.ledgerBody}</p>
      {items === null ? (
        <LoaderCircle className="mt-5 h-5 w-5 animate-spin text-muted" aria-hidden />
      ) : items.length === 0 ? (
        <p className="mt-5 text-sm text-muted">{p.ledgerEmpty}</p>
      ) : (
        <ul className="mt-5 divide-y divide-border">
          {items.map((x) => {
            const free = x.kind === "daily_free";
            return (
              <li key={x.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{p.ledgerKinds[x.kind] ?? p.ledgerKinds.other}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {time(x.createdAt)}
                    {x.designId && (
                      <>
                        {" · "}
                        <Link href={`/tasarim/${x.designId}`} className="text-primary hover:underline">
                          {p.ledgerDesign}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <span className={`shrink-0 tabular-nums font-medium ${x.delta > 0 ? "text-primary" : "text-muted"}`}>
                  {x.delta > 0 ? `+${x.delta}` : `−${Math.abs(x.delta)}`}
                  {free && <span className="ml-1 text-xs font-normal">{p.ledgerFree}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {next && (
        <button type="button" onClick={() => void more()} disabled={busy} className={`${btn.base} ${btn.ghost} ${btn.sm} mt-4`}>
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
          {p.ledgerMore}
        </button>
      )}
    </Section>
  );
}

function Profile({ onError, onSaved }: { onError: (e: unknown) => void; onSaved: () => void }) {
  const { t, user, refreshUser } = useApp();
  const p = t.profile;
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  if (!user) return null;
  async function save() {
    setSaving(true);
    try {
      await api.patch("/me", { name: name.trim() || undefined });
      await refreshUser();
      onSaved();
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className={`${card} p-6 sm:p-8`}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <span className={label}>{p.email}</span>
          <p className="text-sm">
            {user.email}{" "}
            <span className={user.emailVerified ? "text-primary" : "text-muted"}>· {user.emailVerified ? p.verified : p.notVerified}</span>
          </p>
        </div>
        <div>
          <label htmlFor="profile-name" className={label}>
            {p.name}
          </label>
          <div className="flex gap-2">
            <input id="profile-name" className={input} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" className={`${btn.base} ${btn.ghost} ${btn.md}`} onClick={save} disabled={saving || name.trim() === (user.name ?? "")}>
              {p.save}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ConsentsSection({ onError, onSaved }: { onError: (e: unknown) => void; onSaved: () => void }) {
  const { t } = useApp();
  const p = t.profile;
  const [data, setData] = useState<Consents | null>(null);
  const [busy, setBusy] = useState<ConsentKind | null>(null);
  const load = useCallback(() => api.get<Consents>("/me/consents").then(setData).catch(onError), [onError]);
  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(kind: ConsentKind) {
    if (!data) return;
    setBusy(kind);
    try {
      await api.post("/me/consents", { kind, version: data.current[kind].current, granted: !data.current[kind].granted });
      await load();
      onSaved();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  const rows: Array<{ kind: ConsentKind; title: string; hint: string; slug: string }> = [
    { kind: "ai_processing", title: p.aiConsent, hint: p.aiConsentHint, slug: "yapay-zeka" },
    { kind: "marketing", title: p.marketing, hint: p.marketingHint, slug: "pazarlama" },
  ];
  return (
    <Section title={p.privacyTitle}>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const on = data?.current[r.kind]?.granted ?? false;
          return (
            <li key={r.kind} className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.title}</p>
                <p className="mt-1 text-sm text-muted">{r.hint}</p>
                <Link href={`/yasal/${r.slug}`} className="mt-1 inline-block text-sm text-primary hover:underline">
                  {p.readText}
                </Link>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={r.title}
                disabled={!data || busy !== null}
                onClick={() => toggle(r.kind)}
                className={`${btn.base} ${on ? btn.primary : btn.ghost} ${btn.sm} min-w-20`}
              >
                {busy === r.kind ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : on ? p.on : p.off}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-5 text-sm text-muted">
        <Link href="/yasal/kvkk" className="text-primary hover:underline">
          {t.legal.names.kvkk}
        </Link>
        {" · "}
        <Link href="/yasal/kosullar" className="text-primary hover:underline">
          {t.legal.names.kosullar}
        </Link>
      </p>
    </Section>
  );
}

function DataSection({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useApp();
  const p = t.profile;
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const data = await api.get<unknown>("/me/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `casalume-verilerim-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title={p.dataTitle}>
      <p className="text-sm text-muted">{p.exportBody}</p>
      <button type="button" className={`${btn.base} ${btn.ghost} ${btn.md} mt-5`} onClick={download} disabled={busy}>
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />} {p.export}
      </button>
    </Section>
  );
}

function RequestsSection({ onError, onSent }: { onError: (e: unknown) => void; onSent: (ref: string) => void }) {
  const { t, locale } = useApp();
  const p = t.profile;
  const [items, setItems] = useState<DataRequest[]>([]);
  const [type, setType] = useState<RequestType>("access");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get<{ items: DataRequest[] }>("/me/data-requests").then((r) => setItems(r.items)).catch(onError), [onError]);
  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    setBusy(true);
    try {
      const r = await api.post<DataRequest>("/me/data-requests", { type, details: details.trim() });
      setDetails("");
      await load();
      onSent(r.reference);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title={p.kvkkTitle}>
      <p className="text-sm text-muted">{p.kvkkBody}</p>
      <div className="mt-5 grid gap-4">
        <div>
          <label htmlFor="kvkk-type" className={label}>
            {p.kvkkType}
          </label>
          <select id="kvkk-type" className={input} value={type} onChange={(e) => setType(e.target.value as RequestType)}>
            {REQUEST_TYPES.map((k) => (
              <option key={k} value={k}>
                {p.kvkkTypes[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="kvkk-details" className={label}>
            {p.kvkkDetails}
          </label>
          <textarea id="kvkk-details" className={input} rows={4} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
          <p className="mt-1 text-xs text-muted">{p.kvkkDetailsHint}</p>
        </div>
        <div>
          <button type="button" className={`${btn.base} ${btn.primary} ${btn.md}`} onClick={send} disabled={busy || details.trim().length < 10}>
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />} {p.kvkkSend}
          </button>
        </div>
      </div>
      {items.length > 0 && (
        <ul className="mt-6 divide-y divide-border border-t border-border text-sm">
          {items.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{r.reference}</span>
                <span className="text-muted">{p.kvkkStatus[r.status]}</span>
              </div>
              <p className="mt-1 text-muted">{p.kvkkTypes[r.type as RequestType] ?? r.type}</p>
              {r.status === "RECEIVED" || r.status === "IN_PROGRESS" ? (
                <p className="mt-1 text-xs text-muted">{fmt(p.kvkkDue, { date: formatDate(r.dueAt, locale) })}</p>
              ) : r.response ? (
                <p className="mt-2 whitespace-pre-line rounded-2xl bg-surface-2 px-3 py-2">{r.response}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function DeleteSection({ onError, onDeleted }: { onError: (e: unknown) => void; onDeleted: () => Promise<void> }) {
  const { t, locale } = useApp();
  const p = t.profile;
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  // Upper-cased with the page language's rules: a Turkish "sil" is "SİL", whatever the browser's own language.
  const upper = (v: string) => v.trim().toLocaleUpperCase(LOCALE_TAGS[locale]);
  const ok = upper(typed) === upper(p.deleteWord);
  async function remove() {
    setBusy(true);
    try {
      await api.del("/me");
      await onDeleted();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await onDeleted();
      else onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`${card} border-danger/40 p-6 sm:p-8`}>
      <h2 className="text-lg font-medium text-danger">{p.deleteTitle}</h2>
      <p className="mt-3 text-sm text-muted">{p.deleteBody}</p>
      <label htmlFor="delete-confirm" className={`${label} mt-5`}>
        {fmt(p.deleteConfirm, { word: p.deleteWord })}
      </label>
      <div className="flex flex-wrap gap-2">
        <input id="delete-confirm" className={`${input} max-w-60`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        <button type="button" className={`${btn.base} ${btn.md} bg-danger text-white hover:brightness-95`} onClick={remove} disabled={!ok || busy}>
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />} {p.deleteButton}
        </button>
      </div>
    </section>
  );
}

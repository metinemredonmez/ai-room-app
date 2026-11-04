"use client";

import { CheckCircle2, Download, LoaderCircle, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Link from "@/components/locale-link";
import { useApp } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import { btn, card, input, label } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { LOCALE_TAGS, fmt } from "@/lib/i18n";

// Hesabım: profile, consents (KVKK), data export, KVKK m.11 requests and account deletion — the web counterpart of
// the app's Profile screen, also the place Google Play's account-deletion link leads to.

type ConsentKind = "terms" | "privacy" | "ai_processing" | "marketing";
type Consents = { current: Record<ConsentKind, { current: string; granted: boolean }> };
type RequestType = "access" | "rectification" | "erasure" | "objection" | "other";
type DataRequest = { id: string; reference: string; type: string; status: "RECEIVED" | "IN_PROGRESS" | "COMPLETED" | "REJECTED"; response: string | null; dueAt: string; receivedAt: string };
const REQUEST_TYPES: RequestType[] = ["access", "rectification", "erasure", "objection", "other"];

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

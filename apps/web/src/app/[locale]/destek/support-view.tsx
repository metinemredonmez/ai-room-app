"use client";

import { ArrowLeft, LifeBuoy, LoaderCircle, Send } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import { btn, card, input, label } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { fmt } from "@/lib/i18n";

// Destek (API.md §7.19): the user's tickets and the conversation with the team. Opened from the footer, the account
// page or an error screen (?rid=<request id>); a reply e-mail links back here (?t=<ticket id>).

type Category = "bug" | "billing" | "account" | "design" | "idea" | "other";
type Status = "OPEN" | "ANSWERED" | "CLOSED";
type Ticket = { id: string; reference: string; category: Category; subject: string; status: Status; userUnread: boolean; lastMessageAt: string };
type Detail = Ticket & { messages: Array<{ id: string; author: "USER" | "STAFF"; body: string; createdAt: string }> };
const CATEGORIES: Category[] = ["bug", "billing", "account", "design", "idea", "other"];
const RID = /^[A-Za-z0-9-]{8,64}$/;

export function SupportView() {
  const { t, user, userReady, ensureSession } = useApp();
  const s = t.support;
  const params = useSearchParams();
  const rid = params.get("rid") && RID.test(params.get("rid")!) ? params.get("rid")! : null;
  const [openId, setOpenId] = useState<string | null>(params.get("t"));
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!user) return;
    api.get<{ items: Ticket[] }>("/me/support").then((r) => setTickets(r.items)).catch(setError);
  }, [user]);
  useEffect(() => {
    if (userReady) load();
  }, [userReady, load]);

  if (!userReady) return <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6"><LoaderCircle className="h-6 w-6 animate-spin text-muted" aria-hidden /></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-12 sm:px-6">
      <div>
        <h1 className="font-display text-4xl font-light">{s.title}</h1>
        <p className="mt-3 text-muted">{s.intro}</p>
      </div>
      {notice && (
        <p className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary" role="status">
          {notice}
        </p>
      )}
      {error ? <ErrorNotice error={error} onRetry={() => setError(null)} /> : null}
      {(!user || user.isGuest) && <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-muted">{s.guestNote}</p>}

      {openId ? (
        <Conversation
          id={openId}
          onBack={() => {
            setOpenId(null);
            load();
          }}
          onError={setError}
        />
      ) : (
        <>
          <NewTicket
            rid={rid}
            onError={setError}
            onCreated={async (ticket) => {
              setNotice(fmt(s.sent, { ref: ticket.reference }));
              setOpenId(ticket.id);
            }}
            ensureSession={ensureSession}
          />
          <section className={`${card} p-6 sm:p-8`}>
            <h2 className="text-lg font-medium">{s.myTickets}</h2>
            {user && !tickets ? (
              <LoaderCircle className="mt-4 h-5 w-5 animate-spin text-muted" aria-hidden />
            ) : !tickets?.length ? (
              <p className="mt-3 text-sm text-muted">{s.empty}</p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {tickets!.map((tk) => (
                  <li key={tk.id}>
                    <button type="button" onClick={() => setOpenId(tk.id)} className="flex w-full items-center justify-between gap-3 py-3 text-left hover:text-primary">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{tk.subject}</span>
                        <span className="text-xs text-muted">
                          {tk.reference} · {formatDate(tk.lastMessageAt)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs">
                        {tk.userUnread && <span className="rounded-full bg-primary px-2 py-0.5 text-white">{s.unread}</span>}
                        <span className="text-muted">{s.status[tk.status]}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function NewTicket({ rid, onCreated, onError, ensureSession }: { rid: string | null; onCreated: (t: Ticket) => Promise<void>; onError: (e: unknown) => void; ensureSession: () => Promise<unknown> }) {
  const { t } = useApp();
  const s = t.support;
  const [category, setCategory] = useState<Category>(rid ? "bug" : "other");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      await ensureSession(); // a first-time visitor gets a guest account, like in the studio
      const ticket = await api.post<Ticket>("/me/support", { category, subject: subject.trim(), body: body.trim(), platform: "web", ...(rid ? { requestId: rid } : {}) });
      setSubject("");
      setBody("");
      await onCreated(ticket);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`${card} p-6 sm:p-8`}>
      <h2 className="flex items-center gap-2 text-lg font-medium">
        <LifeBuoy className="h-5 w-5 text-primary" aria-hidden /> {s.newTitle}
      </h2>
      <div className="mt-5 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <div>
            <label htmlFor="support-category" className={label}>
              {s.category}
            </label>
            <select id="support-category" className={input} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {s.categories[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="support-subject" className={label}>
              {s.subject}
            </label>
            <input id="support-subject" className={input} maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="support-body" className={label}>
            {s.message}
          </label>
          <textarea id="support-body" className={input} rows={6} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
          <p className="mt-1 text-xs text-muted">{s.messageHint}</p>
          {rid && <p className="mt-1 font-mono text-xs text-muted">{fmt(s.errorRef, { id: rid })}</p>}
        </div>
        <div>
          <button type="button" className={`${btn.base} ${btn.primary} ${btn.md}`} onClick={send} disabled={busy || subject.trim().length < 3 || body.trim().length < 10}>
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} {s.send}
          </button>
        </div>
      </div>
    </section>
  );
}

function Conversation({ id, onBack, onError }: { id: string; onBack: () => void; onError: (e: unknown) => void }) {
  const { t, locale } = useApp();
  const s = t.support;
  const [d, setD] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<Detail>(`/me/support/${encodeURIComponent(id)}`).then(setD).catch(onError);
  }, [id, onError]);

  async function send() {
    setBusy(true);
    try {
      setD(await api.post<Detail>(`/me/support/${encodeURIComponent(id)}/messages`, { body: reply.trim() }));
      setReply("");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`${card} p-6 sm:p-8`}>
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {s.back}
      </button>
      {!d ? (
        <LoaderCircle className="mt-6 h-5 w-5 animate-spin text-muted" aria-hidden />
      ) : (
        <>
          <h2 className="mt-4 text-xl font-medium">{d.subject}</h2>
          <p className="mt-1 text-xs text-muted">
            {d.reference} · {s.categories[d.category]} · {s.status[d.status]}
          </p>
          <ol className="mt-6 space-y-3">
            {d.messages.map((m) => (
              <li key={m.id} className={`rounded-2xl p-4 text-sm ${m.author === "STAFF" ? "mr-8 bg-primary-soft" : "ml-8 bg-surface-2"}`}>
                <p className="mb-1 text-xs text-muted">
                  {m.author === "STAFF" ? s.team : s.you} · {formatDate(m.createdAt, locale)}
                </p>
                <p className="whitespace-pre-line">{m.body}</p>
              </li>
            ))}
          </ol>
          {d.status === "CLOSED" && <p className="mt-4 text-xs text-muted">{s.closedNote}</p>}
          <div className="mt-6">
            <label htmlFor="support-reply" className={label}>
              {s.replyLabel}
            </label>
            <textarea id="support-reply" className={input} rows={4} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} />
            <button type="button" className={`${btn.base} ${btn.primary} ${btn.md} mt-3`} onClick={send} disabled={busy || !reply.trim()}>
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} {s.replySend}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

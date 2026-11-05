"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Building, LoaderCircle, LogOut, Mail, UserMinus, X } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import { btn, card, input, label } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { fmt } from "@/lib/i18n";

// Ekip (API.md §7.23, 3. adım). Sahip: roller, sahiplik devri, sınırlar, davet, çıkarma. Yönetici: üyeleri davet eder,
// sınırlarını ayarlar, çıkarır. Üye: ekibi ve kendi hakkını görür, ayrılabilir. Son karar sunucuda (403/404).

type Role = "OWNER" | "ADMIN" | "MEMBER";
type Member = { userId: string; name: string | null; role: Role; you: boolean; email?: string | null; monthlyCap?: number | null; effectiveCap?: number | null; usedThisMonth?: number };
type Team = {
  id: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED";
  role: Role;
  credits: number | null;
  memberMonthlyCap: number | null;
  you: { monthlyCap: number | null; usedThisMonth: number; remainingThisMonth: number | null };
  members: Member[];
  invites: { id: string; email: string; role: Role; monthlyCap: number | null; expiresAt: string }[];
};

export function TeamView() {
  const { t, locale, orgs, activeOrg, refreshOrgs, setWorkspace, userReady, user } = useApp();
  const s = t.team;
  const [orgId, setOrgId] = useState<string | null>(null);
  const current = orgId ?? activeOrg?.id ?? orgs[0]?.id ?? null;
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!current) return;
    api.get<Team>(`/orgs/${current}`).then(setTeam).catch(setError);
  }, [current]);
  useEffect(() => {
    load();
  }, [load]);

  async function run(key: string, call: () => Promise<Team | void>, done?: string): Promise<boolean> {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const next = await call();
      if (next) setTeam(next);
      if (done) setNotice(done);
      void refreshOrgs();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!userReady) return <Wrap><LoaderCircle className="h-6 w-6 animate-spin text-muted" aria-hidden /></Wrap>;
  if (!user || user.isGuest || orgs.length === 0 || !current) {
    return (
      <Wrap>
        <Header title={s.title} intro={s.intro} />
        <p className="mt-6 rounded-2xl bg-surface px-4 py-3 text-sm text-muted">{s.empty}</p>
      </Wrap>
    );
  }

  const manager = team?.role === "OWNER" || team?.role === "ADMIN";
  const owner = team?.role === "OWNER";
  const path = (p = "") => `/orgs/${current}${p}`;

  return (
    <Wrap>
      <Header title={s.title} intro={s.intro} />
      {orgs.length > 1 && (
        <div className="mt-6">
          <label htmlFor="team-org" className={label}>
            {s.chooseFirm}
          </label>
          <select id="team-org" className={input} value={current} onChange={(e) => {
              setOrgId(e.target.value);
              setTeam(null);
            }}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {notice && (
        <p className="mt-6 rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary" role="status">
          {notice}
        </p>
      )}
      {error ? (
        <div className="mt-6">
          <ErrorNotice
            error={error}
            onRetry={() => {
              setError(null);
              load();
            }}
          />
        </div>
      ) : null}

      {!team ? (
        <LoaderCircle className="mt-8 h-6 w-6 animate-spin text-muted" aria-hidden />
      ) : (
        <>
          <section className={`${card} mt-6 p-6 sm:p-8`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-xl font-medium">
                  <Building className="h-5 w-5 text-primary" aria-hidden /> {team.name}
                </h2>
                <p className="mt-1 text-sm text-muted">{fmt(s.yourRole, { role: s.roles[team.role] })}</p>
              </div>
              {activeOrg?.id !== team.id && team.status === "ACTIVE" && (
                <button type="button" className={`${btn.base} ${btn.primary} ${btn.sm}`} onClick={() => setWorkspace(team.id)}>
                  {s.switchLabel}: {team.name}
                </button>
              )}
            </div>
            {team.status !== "ACTIVE" && <p className="mt-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm">{s.suspended}</p>}
            <ul className="mt-4 space-y-1 text-sm">
              <li>{team.you.remainingThisMonth === null ? s.noCap : fmt(s.allowance, { n: team.you.remainingThisMonth })}</li>
              {team.credits !== null && <li className="text-muted">{fmt(s.pool, { n: team.credits })}</li>}
            </ul>
          </section>

          <section className={`${card} mt-6 p-6 sm:p-8`}>
            <h2 className="text-lg font-medium">{s.members}</h2>
            <ul className="mt-4 divide-y divide-border">
              {team.members.map((m) => (
                <MemberRow
                  key={m.userId}
                  m={m}
                  manager={manager}
                  owner={owner}
                  busy={busy}
                  onCap={(cap) => run(`cap-${m.userId}`, () => api.patch<Team>(path(`/members/${m.userId}`), { monthlyCap: cap }))}
                  onRole={(role) => {
                    if (role === "OWNER" && !window.confirm(fmt(s.transferConfirm, { name: m.name ?? m.email ?? "" }))) return;
                    void run(`role-${m.userId}`, () => api.patch<Team>(path(`/members/${m.userId}`), { role }));
                  }}
                  onRemove={() => {
                    if (!window.confirm(fmt(s.removeConfirm, { name: m.name ?? m.email ?? "" }))) return;
                    void run(`rm-${m.userId}`, () => api.post<Team>(path(`/members/${m.userId}/remove`)));
                  }}
                />
              ))}
            </ul>
          </section>

          {manager && (
            <section className={`${card} mt-6 p-6 sm:p-8`}>
              <h2 className="text-lg font-medium">{s.invite}</h2>
              <InviteForm owner={owner} busy={busy === "invite"} onSend={(body) => run("invite", () => api.post<Team>(path("/invites"), body), s.sent)} />
              <h3 className="mt-8 text-sm font-medium">{s.pending}</h3>
              {team.invites.length === 0 ? (
                <p className="mt-2 text-sm text-muted">—</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {team.invites.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate">{i.email}</span>
                        <span className="text-xs text-muted">
                          {s.roles[i.role]} · {fmt(s.expires, { date: formatDate(i.expiresAt, locale) })}
                        </span>
                      </span>
                      <button type="button" className={`${btn.base} ${btn.subtle} ${btn.sm}`} disabled={busy !== null} onClick={() => run(`inv-${i.id}`, () => api.post<Team>(path(`/invites/${i.id}/revoke`)))}>
                        <X className="h-4 w-4" aria-hidden /> {s.revoke}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {!owner && (
            <div className="mt-6">
              <button
                type="button"
                className={`${btn.base} ${btn.ghost} ${btn.md}`}
                disabled={busy !== null}
                onClick={() => {
                  if (!window.confirm(fmt(s.leaveConfirm, { org: team.name }))) return;
                  void run("leave", async () => {
                    await api.post(path("/leave"));
                    if (activeOrg?.id === team.id) setWorkspace(null);
                    setOrgId(null);
                    setTeam(null);
                  });
                }}
              >
                <LogOut className="h-4 w-4" aria-hidden /> {s.leave}
              </button>
            </div>
          )}
        </>
      )}
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">{children}</div>;
}

function Header({ title, intro }: { title: string; intro: string }) {
  return (
    <div>
      <h1 className="font-display text-4xl font-light">{title}</h1>
      <p className="mt-3 text-muted">{intro}</p>
    </div>
  );
}

function MemberRow({
  m,
  manager,
  owner,
  busy,
  onCap,
  onRole,
  onRemove,
}: {
  m: Member;
  manager: boolean;
  owner: boolean;
  busy: string | null;
  onCap: (cap: number | null) => void;
  onRole: (role: Role) => void;
  onRemove: () => void;
}) {
  const { t } = useApp();
  const s = t.team;
  const [cap, setCap] = useState(m.monthlyCap == null ? "" : String(m.monthlyCap));
  // What this viewer may do with this row (the server decides again).
  const canCap = !m.you && m.role !== "OWNER" && (owner || (manager && m.role === "MEMBER"));
  const canRemove = canCap;
  const canRole = owner && !m.you && m.role !== "OWNER";
  const capValue = cap.trim() ? Number(cap) : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {m.name || m.email || "—"} {m.you && <span className="text-xs font-normal text-muted">({s.you})</span>}
        </span>
        <span className="text-xs text-muted">
          {m.email && m.name ? `${m.email} · ` : ""}
          {s.roles[m.role]}
          {m.usedThisMonth !== undefined && ` · ${s.usage}: ${m.usedThisMonth}${m.effectiveCap != null ? ` / ${m.effectiveCap}` : ""}`}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {canRole && (
          <select aria-label={s.role} className="h-9 rounded-full border border-border bg-surface px-3 text-sm" value={m.role} disabled={busy !== null} onChange={(e) => onRole(e.target.value as Role)}>
            <option value="MEMBER">{s.roles.MEMBER}</option>
            <option value="ADMIN">{s.roles.ADMIN}</option>
            <option value="OWNER">{s.transfer}</option>
          </select>
        )}
        {canCap && (
          <>
            <input aria-label={s.cap} type="number" min={1} max={100000} className="h-9 w-24 rounded-full border border-border bg-surface px-3 text-sm" value={cap} placeholder={s.capDefault} onChange={(e) => setCap(e.target.value)} />
            {capValue !== (m.monthlyCap ?? null) && (
              <button type="button" className={`${btn.base} ${btn.ghost} ${btn.sm}`} disabled={busy !== null} onClick={() => onCap(capValue)}>
                {busy === `cap-${m.userId}` && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />} {s.save}
              </button>
            )}
          </>
        )}
        {canRemove && (
          <button type="button" className={`${btn.base} ${btn.subtle} ${btn.sm}`} disabled={busy !== null} onClick={onRemove} aria-label={s.remove}>
            <UserMinus className="h-4 w-4" aria-hidden />
          </button>
        )}
      </span>
    </li>
  );
}

function InviteForm({ owner, busy, onSend }: { owner: boolean; busy: boolean; onSend: (body: { email: string; role: "ADMIN" | "MEMBER"; monthlyCap: number | null }) => Promise<boolean> }) {
  const { t } = useApp();
  const s = t.team;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [cap, setCap] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!(await onSend({ email: email.trim(), role, monthlyCap: cap.trim() ? Number(cap) : null }))) return;
    setEmail("");
    setCap("");
  }
  return (
    <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-[1fr_9rem_8rem]">
      <div>
        <label htmlFor="inv-email" className={label}>
          {s.email}
        </label>
        <input id="inv-email" type="email" required maxLength={254} className={input} value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label htmlFor="inv-role" className={label}>
          {s.role}
        </label>
        <select id="inv-role" className={input} value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "MEMBER")} disabled={!owner}>
          <option value="MEMBER">{s.roles.MEMBER}</option>
          {owner && <option value="ADMIN">{s.roles.ADMIN}</option>}
        </select>
      </div>
      <div>
        <label htmlFor="inv-cap" className={label}>
          {s.cap}
        </label>
        <input id="inv-cap" type="number" min={1} max={100000} className={input} value={cap} placeholder={s.capDefault} onChange={(e) => setCap(e.target.value)} />
      </div>
      <div className="sm:col-span-3">
        <button type="submit" className={`${btn.base} ${btn.primary} ${btn.md}`} disabled={busy || !email.trim()}>
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />} {s.send}
        </button>
      </div>
    </form>
  );
}

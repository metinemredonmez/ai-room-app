"use client";

import { ArrowLeft, Coins, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, Table, Textarea, td, th } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtInt } from "@/lib/format";
import type { AdminMe, AdminOrgDetail, AdminOrgMember, OrgRole } from "@/lib/types";

// Firma ayrıntısı (API.md §7.23). Her değişiklik üstteki gerekçeyle denetim kaydına yazılır. Sahiplik yalnız devirle
// değişir: bir üyeye "Sahip" verilince eski sahip "Yönetici" olur.

const ROLE: Record<OrgRole, string> = { OWNER: "Sahip", ADMIN: "Yönetici", MEMBER: "Üye" };
const ledgerLabel = (reason: string) =>
  reason.startsWith("admin: ") ? `Ekip: ${reason.slice(7)}` : ({ generation: "Tasarım", refund: "İade (tasarım tamamlanamadı)" } as Record<string, string>)[reason] ?? reason;

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useApi<AdminOrgDetail>(id ? `/orgs/${encodeURIComponent(id)}` : null);
  const me = useApi<AdminMe>("/me");
  const { toast, confirm } = useFeedback();
  const org = detail.data;
  const canEdit = Boolean(me.data && ["ADMIN", "SUPER_ADMIN"].includes(me.data.role));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const why = reason.trim();
  const ready = why.length >= 3;

  async function run(key: string, call: () => Promise<AdminOrgDetail>, done: string) {
    setBusy(key);
    try {
      const next = await call();
      detail.setData(() => next);
      toast("success", done);
      return true;
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem başarısız.");
      return false;
    } finally {
      setBusy(null);
    }
  }
  const path = (p = "") => `/orgs/${encodeURIComponent(id)}${p}`;

  if (detail.error && !org) return <ErrorState message={detail.error.message} onRetry={detail.reload} />;
  if (!org) return <Spinner />;
  const emailOf = (userId: string | null) => (userId ? (org.members.find((m) => m.userId === userId)?.email ?? `${userId.slice(0, 8)}…`) : "—");

  return (
    <>
      <Link href="/orgs" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Firmalar
      </Link>
      <PageHeader
        title={org.name}
        description={`Açılış ${fmtDate(org.createdAt)} · ${fmtInt(org.members.length)} üye${org.owner ? ` · sahip ${org.owner.email ?? "—"}` : ""}`}
        actions={<Badge tone={org.status === "ACTIVE" ? "good" : "warn"}>{org.status === "ACTIVE" ? "Etkin" : "Askıda"}</Badge>}
      />
      {!org.owner && <p className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Firmanın sahibi yok (hesabını silmiş olabilir). Bir üyeye “Sahip” rolü ver.</p>}

      {canEdit && (
        <Card className="mb-4">
          <Field label="İşlem gerekçesi" htmlFor="org-why" hint="Bu sayfadaki her değişiklik bu gerekçeyle denetim kaydına yazılır (en az 3 karakter).">
            <Input id="org-why" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Örn. fatura 2026/31 ödendi" />
          </Field>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <CreditsCard org={org} canEdit={canEdit} ready={ready} busy={busy} onSubmit={(delta) => run("credits", () => api(path("/credits"), { method: "POST", body: { delta, reason: why } }), "Kredi güncellendi.")} />
        <InfoCard
          org={org}
          canEdit={canEdit}
          ready={ready}
          busy={busy}
          onSave={(body) => run("info", () => api(path(), { method: "PATCH", body: { ...body, reason: why } }), "Firma bilgisi kaydedildi.")}
          onToggle={async () => {
            const suspending = org.status === "ACTIVE";
            const ok = await confirm({
              title: suspending ? "Firma askıya alınsın mı?" : "Firma yeniden etkinleştirilsin mi?",
              description: suspending ? "Üyeler firma alanında tasarım üretemez; kişisel hesapları etkilenmez." : "Üyeler firma alanını yeniden kullanabilir.",
              confirmLabel: suspending ? "Askıya al" : "Etkinleştir",
              destructive: suspending,
            });
            if (ok) await run("status", () => api(path(), { method: "PATCH", body: { status: suspending ? "SUSPENDED" : "ACTIVE", reason: why } }), suspending ? "Firma askıya alındı." : "Firma etkin.");
          }}
        />
      </div>

      <Card title={`Üyeler (${fmtInt(org.members.length)})`} className="mt-4">
        {org.members.length === 0 ? (
          <EmptyState title="Üye yok" />
        ) : (
          <Table
            head={
              <tr>
                <th className={th}>Kişi</th>
                <th className={th}>Rol</th>
                <th className={th}>Aylık sınır</th>
                <th className={`${th} text-right`}>Bu ay</th>
                <th className={th}>Katıldı</th>
                <th className={th} />
              </tr>
            }
          >
            {org.members.map((m) => (
              <MemberRow
                key={m.userId}
                m={m}
                canEdit={canEdit}
                ready={ready}
                busy={busy}
                onRole={async (role) => {
                  if (role === "OWNER") {
                    const ok = await confirm({ title: "Sahiplik devredilsin mi?", description: `${m.email ?? "Bu üye"} firmanın sahibi olur; mevcut sahip yönetici olur.`, confirmLabel: "Devret" });
                    if (!ok) return;
                  }
                  await run(`role-${m.userId}`, () => api(path(`/members/${m.userId}`), { method: "PATCH", body: { role, reason: why } }), "Rol güncellendi.");
                }}
                onCap={(monthlyCap) => run(`cap-${m.userId}`, () => api(path(`/members/${m.userId}`), { method: "PATCH", body: { monthlyCap, reason: why } }), "Sınır güncellendi.")}
                onRemove={async () => {
                  const ok = await confirm({ title: "Üye çıkarılsın mı?", description: `${m.email ?? "Bu kişi"} firma alanına erişemez; kişisel hesabı kalır.`, confirmLabel: "Çıkar", destructive: true });
                  if (ok) await run(`rm-${m.userId}`, () => api(path(`/members/${m.userId}/remove`), { method: "POST", body: { reason: why } }), "Üye çıkarıldı.");
                }}
              />
            ))}
          </Table>
        )}
        {canEdit && <AddMember ready={ready} busy={busy} onAdd={(body) => run("add", () => api(path("/members"), { method: "POST", body: { ...body, reason: why } }), "Üye eklendi.")} />}
      </Card>

      <Card title="Kredi hareketleri" className="mt-4">
        {org.ledger.length === 0 ? (
          <EmptyState title="Hareket yok" />
        ) : (
          <Table
            head={
              <tr>
                <th className={th}>Tarih</th>
                <th className={`${th} text-right`}>Değişim</th>
                <th className={th}>Neden</th>
                <th className={th}>Üye</th>
              </tr>
            }
          >
            {org.ledger.map((l) => (
              <tr key={l.id}>
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDateTime(l.createdAt)}</td>
                <td className={`${td} text-right font-medium tabular ${l.delta < 0 ? "text-danger" : "text-good"}`}>
                  {l.delta > 0 ? "+" : ""}
                  {fmtInt(l.delta)}
                </td>
                <td className={td}>{ledgerLabel(l.reason)}</td>
                <td className={`${td} text-sm text-muted-foreground`}>{emailOf(l.userId)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function CreditsCard({ org, canEdit, ready, busy, onSubmit }: { org: AdminOrgDetail; canEdit: boolean; ready: boolean; busy: string | null; onSubmit: (delta: number) => Promise<boolean> }) {
  const [delta, setDelta] = useState("");
  const n = Number(delta);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onSubmit(n)) setDelta("");
  }
  return (
    <Card title="Kredi havuzu">
      <p className="flex items-baseline gap-2">
        <Coins className="h-5 w-5 self-center text-primary" aria-hidden />
        <span className="text-3xl font-semibold tabular text-fg">{fmtInt(org.credits)}</span>
        <span className="text-sm text-muted-foreground">kredi · üyeler firma alanında bundan harcar</span>
      </p>
      {canEdit && (
        <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-2">
          <Field label="Ekle / düş" htmlFor="org-delta" hint="Eksi sayı düşer; bakiye eksiye inemez.">
            <Input id="org-delta" type="number" min={-1000000} max={1000000} value={delta} onChange={(e) => setDelta(e.target.value)} className="w-40" placeholder="Örn. 500" />
          </Field>
          <Button type="submit" variant="primary" loading={busy === "credits"} disabled={!ready || !Number.isInteger(n) || n === 0}>
            Uygula
          </Button>
        </form>
      )}
    </Card>
  );
}

function InfoCard({
  org,
  canEdit,
  ready,
  busy,
  onSave,
  onToggle,
}: {
  org: AdminOrgDetail;
  canEdit: boolean;
  ready: boolean;
  busy: string | null;
  onSave: (body: { name?: string; memberMonthlyCap?: number | null; note?: string | null }) => Promise<boolean>;
  onToggle: () => Promise<void>;
}) {
  const [name, setName] = useState(org.name);
  const [cap, setCap] = useState(org.memberMonthlyCap === null ? "" : String(org.memberMonthlyCap));
  const [note, setNote] = useState(org.note ?? "");
  const capValue = cap.trim() ? Number(cap) : null;
  const changes = {
    ...(name.trim() !== org.name ? { name: name.trim() } : {}),
    ...(capValue !== org.memberMonthlyCap ? { memberMonthlyCap: capValue } : {}),
    ...((note.trim() || null) !== org.note ? { note: note.trim() || null } : {}),
  };
  const dirty = Object.keys(changes).length > 0;
  return (
    <Card
      title="Firma bilgisi"
      actions={
        canEdit && (
          <Button size="sm" variant={org.status === "ACTIVE" ? "danger" : "secondary"} onClick={onToggle} loading={busy === "status"} disabled={!ready}>
            {org.status === "ACTIVE" ? "Askıya al" : "Etkinleştir"}
          </Button>
        )
      }
    >
      <fieldset disabled={!canEdit} className="grid gap-3">
        <Field label="Ad" htmlFor="org-name-edit">
          <Input id="org-name-edit" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Üye başı aylık sınır" htmlFor="org-cap-edit" hint="Boş = sınırsız; özel sınırı olan üyeye o uygulanır.">
          <Input id="org-cap-edit" type="number" min={1} max={100000} value={cap} onChange={(e) => setCap(e.target.value)} />
        </Field>
        <Field label="İç not" htmlFor="org-note-edit" hint="Yalnız ekip görür.">
          <Textarea id="org-note-edit" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </fieldset>
      {canEdit && (
        <div className="mt-3 flex justify-end">
          <Button variant="primary" onClick={() => onSave(changes)} loading={busy === "info"} disabled={!dirty || !ready || name.trim().length < 2}>
            Kaydet
          </Button>
        </div>
      )}
    </Card>
  );
}

function MemberRow({
  m,
  canEdit,
  ready,
  busy,
  onRole,
  onCap,
  onRemove,
}: {
  m: AdminOrgMember;
  canEdit: boolean;
  ready: boolean;
  busy: string | null;
  onRole: (role: OrgRole) => Promise<void>;
  onCap: (cap: number | null) => Promise<boolean>;
  onRemove: () => Promise<void>;
}) {
  const [cap, setCap] = useState(m.monthlyCap === null ? "" : String(m.monthlyCap));
  const capValue = cap.trim() ? Number(cap) : null;
  const over = m.effectiveCap !== null && m.usedThisMonth >= m.effectiveCap;
  return (
    <tr>
      <td className={td}>
        <Link href={`/users/${m.userId}`} className="text-primary hover:underline">
          {m.email ?? m.name ?? `${m.userId.slice(0, 8)}…`}
        </Link>
        {m.userStatus !== "ACTIVE" && <span className="ml-2 text-xs text-danger">engelli</span>}
      </td>
      <td className={td}>
        {canEdit && m.role !== "OWNER" ? (
          <Select aria-label="Rol" value={m.role} disabled={!ready || busy !== null} onChange={(e) => onRole(e.target.value as OrgRole)} className="w-32">
            {(["MEMBER", "ADMIN", "OWNER"] as const).map((r) => (
              <option key={r} value={r}>
                {ROLE[r]}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone={m.role === "OWNER" ? "primary" : "neutral"}>{ROLE[m.role]}</Badge>
        )}
      </td>
      <td className={td}>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <Input aria-label="Aylık sınır" type="number" min={1} max={100000} value={cap} onChange={(e) => setCap(e.target.value)} placeholder={m.effectiveCap === null ? "sınırsız" : `firma: ${m.effectiveCap}`} className="w-28" />
            {capValue !== m.monthlyCap && (
              <Button size="sm" onClick={() => onCap(capValue)} disabled={!ready} loading={busy === `cap-${m.userId}`}>
                Kaydet
              </Button>
            )}
          </div>
        ) : (
          <span className="text-sm">{m.effectiveCap === null ? "Sınırsız" : fmtInt(m.effectiveCap)}</span>
        )}
      </td>
      <td className={`${td} text-right tabular ${over ? "text-warn" : ""}`}>
        {fmtInt(m.usedThisMonth)}
        {m.effectiveCap !== null && <span className="text-muted-foreground"> / {fmtInt(m.effectiveCap)}</span>}
      </td>
      <td className={`${td} whitespace-nowrap text-xs text-muted-foreground`}>{fmtDate(m.joinedAt)}</td>
      <td className={`${td} text-right`}>
        {canEdit && m.role !== "OWNER" && (
          <Button size="sm" variant="ghost" className="text-danger" onClick={onRemove} disabled={!ready} loading={busy === `rm-${m.userId}`} aria-label="Üyeyi çıkar">
            <UserMinus className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </td>
    </tr>
  );
}

function AddMember({ ready, busy, onAdd }: { ready: boolean; busy: string | null; onAdd: (body: { email: string; role: "ADMIN" | "MEMBER"; monthlyCap: number | null }) => Promise<boolean> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [cap, setCap] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onAdd({ email: email.trim(), role, monthlyCap: cap.trim() ? Number(cap) : null })) {
      setEmail("");
      setCap("");
    }
  }
  return (
    <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
      <Field label="Üye ekle (e-posta)" htmlFor="add-email" hint="Kayıtlı ve e-postası doğrulanmış kullanıcı. E-postayla davet sonraki adımda gelecek.">
        <Input id="add-email" type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="w-72" />
      </Field>
      <Field label="Rol" htmlFor="add-role">
        <Select id="add-role" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "MEMBER")} className="w-32">
          <option value="MEMBER">Üye</option>
          <option value="ADMIN">Yönetici</option>
        </Select>
      </Field>
      <Field label="Aylık sınır" htmlFor="add-cap">
        <Input id="add-cap" type="number" min={1} max={100000} value={cap} onChange={(e) => setCap(e.target.value)} placeholder="varsayılan" className="w-36" />
      </Field>
      <Button type="submit" variant="primary" loading={busy === "add"} disabled={!ready || !email.trim()}>
        <UserPlus className="h-4 w-4" aria-hidden /> Ekle
      </Button>
    </form>
  );
}

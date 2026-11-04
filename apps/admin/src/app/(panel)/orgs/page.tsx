"use client";

import { Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadMore, PageHeader, Spinner, Table, Textarea, td, th } from "@/components/common";
import { api, ApiError, useApi, usePaged } from "@/lib/api";
import { fmtDate, fmtInt } from "@/lib/format";
import type { AdminMe, AdminOrg, AdminOrgDetail, OrgStatus } from "@/lib/types";

// Firmalar (API.md §7.23): mimarlık ofisi, mağaza, emlak ve otel gibi kurumsal müşteriler. Firmayı ve kredisini
// yönetici açar (fatura dışarıda kesilir); sahibi kayıtlı ve doğrulanmış bir Casalume kullanıcısıdır.

const STATUS: Record<OrgStatus, { label: string; tone: "good" | "warn" }> = {
  ACTIVE: { label: "Etkin", tone: "good" },
  SUSPENDED: { label: "Askıda", tone: "warn" },
};

export default function OrgsPage() {
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<OrgStatus | "all">("all");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);
  const me = useApi<AdminMe>("/me");
  const canEdit = me.data && ["ADMIN", "SUPER_ADMIN"].includes(me.data.role);
  const list = usePaged<AdminOrg>("/orgs", { q: q || undefined, status: status === "all" ? undefined : status });

  return (
    <>
      <PageHeader
        title="Firmalar"
        description="Kurumsal hesaplar: ortak kredi havuzu, üyeler ve roller. Firma ve kredi buradan tanımlanır; fatura dışarıda kesilir."
        actions={
          canEdit && !creating ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Firma oluştur
            </Button>
          ) : undefined
        }
      />
      {creating && <CreateOrg onClose={() => setCreating(false)} />}
      <Card
        title={
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative block w-72 max-w-full">
              <span className="sr-only">Firma ara</span>
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Firma adı ya da sahibin e-postası" className="pl-8" maxLength={100} />
            </label>
            {(["all", "ACTIVE", "SUSPENDED"] as const).map((s) => (
              <Button key={s} size="sm" variant={s === status ? "primary" : "secondary"} onClick={() => setStatus(s)} aria-pressed={s === status}>
                {s === "all" ? "Tümü" : STATUS[s].label}
              </Button>
            ))}
          </div>
        }
      >
        {list.error && list.items.length === 0 ? (
          <ErrorState message={list.error.message} onRetry={list.reload} />
        ) : list.loading && list.items.length === 0 ? (
          <Spinner />
        ) : list.items.length === 0 ? (
          <EmptyState title="Firma yok" description={q ? "Aramayla eşleşen firma bulunamadı." : "İlk kurumsal müşteriyi “Firma oluştur” ile ekle."} />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th className={th}>Firma</th>
                  <th className={th}>Sahip</th>
                  <th className={`${th} text-right`}>Üye</th>
                  <th className={`${th} text-right`}>Kredi</th>
                  <th className={th}>Durum</th>
                  <th className={th}>Açılış</th>
                </tr>
              }
            >
              {list.items.map((o) => (
                <tr key={o.id} className="hover:bg-surface-2">
                  <td className={td}>
                    <Link href={`/orgs/${o.id}`} className="font-medium text-fg hover:text-primary hover:underline">
                      {o.name}
                    </Link>
                  </td>
                  <td className={`${td} text-sm text-muted-foreground`}>{o.ownerEmail ?? <span className="text-warn">Sahip yok</span>}</td>
                  <td className={`${td} text-right tabular`}>{fmtInt(o.members)}</td>
                  <td className={`${td} text-right tabular`}>{fmtInt(o.credits)}</td>
                  <td className={td}>
                    <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                  </td>
                  <td className={`${td} whitespace-nowrap text-xs text-muted-foreground`}>{fmtDate(o.createdAt)}</td>
                </tr>
              ))}
            </Table>
            <LoadMore hasMore={Boolean(list.nextCursor)} loading={list.loadingMore} onClick={list.loadMore} />
          </>
        )}
      </Card>
    </>
  );
}

function CreateOrg({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [f, setF] = useState({ name: "", ownerEmail: "", credits: "0", cap: "", note: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const org = await api<AdminOrgDetail>("/orgs", {
        method: "POST",
        body: {
          name: f.name.trim(),
          ownerEmail: f.ownerEmail.trim(),
          credits: Number(f.credits) || 0,
          memberMonthlyCap: f.cap.trim() ? Number(f.cap) : null,
          note: f.note.trim() || null,
          reason: f.reason.trim(),
        },
      });
      toast("success", "Firma oluşturuldu.");
      router.push(`/orgs/${org.id}`);
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Yeni firma"
      className="mb-4"
      actions={
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Kapat">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      }
    >
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Field label="Firma adı" htmlFor="org-name">
          <Input id="org-name" required minLength={2} maxLength={80} value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Sahibin e-postası" htmlFor="org-owner" hint="Kişi önce Casalume'de hesap açıp e-postasını doğrulamış olmalı.">
          <Input id="org-owner" type="email" required maxLength={254} value={f.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} />
        </Field>
        <Field label="Başlangıç kredisi" htmlFor="org-credits" hint="Firmanın ortak havuzu; üyeler firma alanında bundan harcar.">
          <Input id="org-credits" type="number" min={0} max={1000000} value={f.credits} onChange={(e) => set("credits", e.target.value)} />
        </Field>
        <Field label="Üye başı aylık sınır" htmlFor="org-cap" hint="Boş = sınırsız. Üyeye ayrıca özel sınır verilebilir.">
          <Input id="org-cap" type="number" min={1} max={100000} value={f.cap} onChange={(e) => set("cap", e.target.value)} />
        </Field>
        <Field label="İç not" htmlFor="org-note" hint="Yalnız ekip görür (sözleşme, fatura no).">
          <Textarea id="org-note" rows={2} maxLength={500} value={f.note} onChange={(e) => set("note", e.target.value)} />
        </Field>
        <Field label="Gerekçe" htmlFor="org-reason" hint="Denetim kaydına yazılır.">
          <Input id="org-reason" required minLength={3} maxLength={200} value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Örn. 2026/14 sözleşme" />
        </Field>
        <div className="flex justify-end gap-2 md:col-span-2">
          <Button type="button" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={f.name.trim().length < 2 || !f.ownerEmail.trim() || f.reason.trim().length < 3}>
            Oluştur
          </Button>
        </div>
      </form>
    </Card>
  );
}

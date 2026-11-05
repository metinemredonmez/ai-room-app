"use client";

import { Copy, Pause, Play, Plus } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Spinner, Table, td, th } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import type { AdminMe, PartnerRow } from "@/lib/types";

// Ortaklar (API.md §7.33): influencer, mimar ya da mağaza için kısa bağlantı (casalume.app/p/ad). Ziyaret sayılır,
// bağlantıdan gelip 24 saat içinde hesap açan kişi o ortağa yazılır; sonra kayıt, doğrulama, ilk tasarım, ödeme ve net
// gelir izlenir. Komisyon yalnız rapor içindir (ödeme sistem dışında). Kitleye ödül gerekiyorsa promosyon kodu verilir.

const slugify = (v: string) =>
  v.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (a: number, b: number) => (b > 0 ? `%${Math.round((a / b) * 100)}` : "—");

export default function PartnersPage() {
  const me = useApi<AdminMe>("/me");
  const list = useApi<{ items: PartnerRow[] }>("/partners");
  const canEdit = me.data ? ["ADMIN", "SUPER_ADMIN"].includes(me.data.role) : false;
  return (
    <>
      <PageHeader
        title="Ortaklar"
        description="Influencer, mimar ya da mağaza için kısa bağlantı. Bağlantıdan gelen ziyaret, kayıt, ilk tasarım, ödeme ve net gelir burada görünür. Kitleye ödül vermek için ayrıca promosyon kodu tanımla."
      />
      {canEdit && <CreatePartner onCreated={list.reload} />}
      <Card title="Ortaklar ve sonuçlar" className="mt-4">
        {list.error && !list.data ? (
          <ErrorState message={list.error.message} onRetry={list.reload} />
        ) : !list.data ? (
          <Spinner />
        ) : list.data.items.length === 0 ? (
          <EmptyState title="Henüz ortak yok" description="Yukarıdan bir bağlantı oluştur ve ortağınla paylaş." />
        ) : (
          <Table
            head={
              <tr>
                <th className={th}>Ortak</th>
                <th className={`${th} text-right`}>Ziyaret (30 g / toplam)</th>
                <th className={`${th} text-right`}>Kayıt</th>
                <th className={`${th} text-right`}>Doğrulanan</th>
                <th className={`${th} text-right`}>Tasarım yapan</th>
                <th className={`${th} text-right`}>Ödeyen</th>
                <th className={`${th} text-right`}>Net gelir</th>
                <th className={`${th} text-right`}>Komisyon</th>
                <th className={th} />
              </tr>
            }
          >
            {list.data.items.map((p) => (
              <Row key={p.id} p={p} canEdit={canEdit} onChanged={list.reload} />
            ))}
          </Table>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Gelir RevenueCat’in canlı ortam USD tutarlarıdır (iadeler düşülür). Kayıt oranı ziyarete, ödeyen oranı kayda göre. Komisyon tahminidir: net gelir × oran.
        </p>
      </Card>
    </>
  );
}

function Row({ p, canEdit, onChanged }: { p: PartnerRow; canEdit: boolean; onChanged: () => void }) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(p.link);
      toast("success", "Bağlantı kopyalandı.");
    } catch {
      toast("error", p.link);
    }
  }
  async function toggle() {
    const reason = window.prompt(p.active ? "Neden durduruluyor? (denetim kaydına yazılır)" : "Neden yeniden açılıyor? (denetim kaydına yazılır)");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await api(`/partners/${p.id}`, { method: "PATCH", body: { active: !p.active, reason: reason.trim() } });
      onChanged();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <tr>
      <td className={td}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg">{p.name}</span>
          {!p.active && <Badge tone="neutral">Durduruldu</Badge>}
        </div>
        <button type="button" onClick={() => void copy()} className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-primary hover:underline" title="Bağlantıyı kopyala">
          <Copy className="h-3 w-3" aria-hidden /> /p/{p.slug}
        </button>
        {p.note && <p className="text-[11px] text-muted-foreground">{p.note}</p>}
      </td>
      <td className={`${td} text-right tabular-nums`}>
        {fmtInt(p.visits30)} / {fmtInt(p.visits)}
      </td>
      <td className={`${td} text-right tabular-nums`}>
        {fmtInt(p.signups)} <span className="text-[11px] text-muted-foreground">{pct(p.signups, p.visits)}</span>
      </td>
      <td className={`${td} text-right tabular-nums`}>{fmtInt(p.verified)}</td>
      <td className={`${td} text-right tabular-nums`}>{fmtInt(p.designers)}</td>
      <td className={`${td} text-right tabular-nums`}>
        {fmtInt(p.payers)} <span className="text-[11px] text-muted-foreground">{pct(p.payers, p.signups)}</span>
      </td>
      <td className={`${td} text-right tabular-nums`}>{usd(p.revenueUsd)}</td>
      <td className={`${td} text-right tabular-nums`}>
        {usd(p.commissionUsd)} <span className="text-[11px] text-muted-foreground">%{p.commissionPct}</span>
      </td>
      <td className={`${td} text-right`}>
        {canEdit && (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void toggle()}>
            {p.active ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />} {p.active ? "Durdur" : "Sürdür"}
          </Button>
        )}
      </td>
    </tr>
  );
}

function CreatePartner({ onCreated }: { onCreated: () => void }) {
  const { toast } = useFeedback();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [commission, setCommission] = useState("0");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const shownSlug = slugTouched ? slug : slugify(name);

  async function create() {
    setBusy(true);
    try {
      const out = await api<{ link: string }>("/partners", {
        method: "POST",
        body: { name: name.trim(), slug: shownSlug, commissionPct: Number(commission), note: note.trim() || null, reason: reason.trim() },
      });
      try {
        await navigator.clipboard.writeText(out.link);
      } catch {
        /* the link is in the list */
      }
      toast("success", `Oluşturuldu ve kopyalandı: ${out.link}`);
      setName("");
      setSlug("");
      setSlugTouched(false);
      setCommission("0");
      setNote("");
      setReason("");
      onCreated();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={<span className="flex items-center gap-2"><Plus className="h-4 w-4" aria-hidden /> Yeni ortak bağlantısı</span>}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Ad" htmlFor="p-name" hint="Ör. @ayse.dekor (Instagram)">
          <Input id="p-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Bağlantı adı" htmlFor="p-slug" hint={`casalume.app/p/${shownSlug || "…"}`}>
          <Input id="p-slug" value={shownSlug} maxLength={40} className="font-mono text-xs" onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} />
        </Field>
        <Field label="Komisyon (%0–50)" htmlFor="p-commission" hint="Yalnız rapor için">
          <Input id="p-commission" type="number" min={0} max={50} value={commission} onChange={(e) => setCommission(e.target.value)} />
        </Field>
        <Field label="Not (isteğe bağlı)" htmlFor="p-note">
          <Input id="p-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Ör. KASIM2026 koduyla birlikte" />
        </Field>
      </div>
      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <Field label="Gerekçe" htmlFor="p-reason" hint="Denetim kaydına yazılır (en az 3 karakter).">
            <Input id="p-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <Button variant="primary" loading={busy} disabled={name.trim().length < 2 || shownSlug.length < 3 || reason.trim().length < 3} onClick={() => void create()}>
          Oluştur ve kopyala
        </Button>
      </div>
    </Card>
  );
}

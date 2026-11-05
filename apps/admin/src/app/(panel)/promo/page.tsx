"use client";

import { Download, Gift, Pause, Play, Plus, Users } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadMore, PageHeader, Select, Spinner, Table, td, th } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { AdminMe, PromoBatch, PromoCode, PromoKind, PromoList, PromoRedemptions } from "@/lib/types";

// Promosyon ve hediye kodları (API.md §7.29). Kampanya kodu (ör. YAZ2026): çok kişi, kişi başı bir kez. Hediye kodları:
// tek kullanımlık, toplu üretilir ve yalnız üretildiği anda görünür (CSV indir). Kod kredi ya da PRO günü verir; yalnız
// e-postası doğrulanmış hesaplar kullanır. Her işlem gerekçe ister ve denetlenir.

const KIND: Record<PromoKind, { label: string; unit: string }> = { CREDITS: { label: "Kredi", unit: "kredi" }, PRO_DAYS: { label: "PRO günü", unit: "gün PRO" } };
const iso = (local: string) => (local ? new Date(local).toISOString() : null);

function state(c: PromoCode): { tone: "good" | "neutral" | "danger" | "warn"; text: string } {
  if (!c.active) return { tone: "neutral", text: "Durduruldu" };
  if (c.maxRedemptions !== null && c.redeemed >= c.maxRedemptions) return { tone: "warn", text: "Tükendi" };
  if (c.endsAt && new Date(c.endsAt) <= new Date()) return { tone: "danger", text: "Süresi doldu" };
  if (c.startsAt && new Date(c.startsAt) > new Date()) return { tone: "neutral", text: "Başlamadı" };
  return { tone: "good", text: "Kullanılabilir" };
}

export default function PromoPage() {
  const me = useApi<AdminMe>("/me");
  const [campaign, setCampaign] = useState("");
  const [q, setQ] = useState("");
  const list = useApi<PromoList>("/promo", { campaign: campaign || undefined, q: q || undefined });
  const [extra, setExtra] = useState<{ after: string; items: PromoCode[] } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const canEdit = me.data ? ["ADMIN", "SUPER_ADMIN"].includes(me.data.role) : false;
  const items = [...(list.data?.items ?? []), ...(extra?.items ?? [])];
  const next = extra ? extra.after : list.data?.nextCursor;

  async function loadMore() {
    if (!next) return;
    setMoreBusy(true);
    try {
      const r = await api<PromoList>(`/promo?limit=50&cursor=${next}${campaign ? `&campaign=${encodeURIComponent(campaign)}` : ""}`);
      setExtra((e) => ({ after: r.nextCursor ?? "", items: [...(e?.items ?? []), ...r.items] }));
    } finally {
      setMoreBusy(false);
    }
  }
  const reload = () => {
    setExtra(null);
    list.reload();
  };

  return (
    <>
      <PageHeader
        title="Promosyon kodları"
        description="Kampanya kodu (ör. YAZ2026) herkes için, kişi başı bir kez. Hediye kodları tek kullanımlık ve toplu üretilir. Kod kredi ya da PRO günü verir; yalnız e-postası doğrulanmış hesaplar kullanabilir."
      />
      {canEdit && (
        <div className="mb-4 grid gap-4 xl:grid-cols-2">
          <CreateShared onCreated={reload} />
          <CreateBatch onCreated={reload} />
        </div>
      )}
      <Card
        title="Kodlar"
        actions={
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Kampanya" value={campaign} onChange={(e) => { setCampaign(e.target.value); setExtra(null); }} className="h-8 w-48 text-xs">
              <option value="">Bütün kampanyalar</option>
              {(list.data?.campaigns ?? []).map((c) => (
                <option key={c.campaign} value={c.campaign}>
                  {c.campaign} · {fmtInt(c.codes)} kod · {fmtInt(c.redeemed)} kullanım
                </option>
              ))}
            </Select>
            <Input aria-label="Ara" placeholder="Kampanya adı ya da tam kod" value={q} onChange={(e) => { setQ(e.target.value); setExtra(null); }} className="h-8 w-56 text-xs" />
          </div>
        }
      >
        {list.error && !list.data ? (
          <ErrorState message={list.error.message} onRetry={list.reload} />
        ) : !list.data ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="Kod yok" description="Kampanya kodu oluştur ya da hediye kodu üret." />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th className={th}>Kod</th>
                  <th className={th}>Kampanya</th>
                  <th className={th}>Verir</th>
                  <th className={th}>Kullanım</th>
                  <th className={th}>Geçerlilik</th>
                  <th className={th}>Durum</th>
                  <th className={th} />
                </tr>
              }
            >
              {items.map((c) => (
                <Row key={c.id} c={c} canEdit={canEdit} onChanged={reload} />
              ))}
            </Table>
            <LoadMore hasMore={Boolean(next)} loading={moreBusy} onClick={() => void loadMore()} />
          </>
        )}
      </Card>
    </>
  );
}

function Row({ c, canEdit, onChanged }: { c: PromoCode; canEdit: boolean; onChanged: () => void }) {
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<PromoRedemptions | null>(null);
  const [busy, setBusy] = useState(false);
  const s = state(c);

  async function toggle() {
    const reason = window.prompt(c.active ? "Neden durduruluyor? (denetim kaydına yazılır)" : "Neden yeniden açılıyor? (denetim kaydına yazılır)");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await api(`/promo/${c.id}`, { method: "PATCH", body: { active: !c.active, reason: reason.trim() } });
      toast("success", c.active ? "Kod durduruldu." : "Kod yeniden açıldı.");
      onChanged();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }
  async function showWho() {
    setOpen((o) => !o);
    if (!who) setWho(await api<PromoRedemptions>(`/promo/${c.id}/redemptions`).catch(() => null));
  }

  return (
    <>
      <tr>
        <td className={`${td} font-mono text-xs`}>{c.display}</td>
        <td className={td}>{c.campaign}</td>
        <td className={td}>
          {fmtInt(c.amount)} {KIND[c.kind].unit}
          {c.newUsersOnly && <span className="ml-1 text-xs text-muted-foreground">· yeni üyeler</span>}
        </td>
        <td className={`${td} tabular-nums`}>
          {fmtInt(c.redeemed)}
          {c.maxRedemptions !== null ? ` / ${fmtInt(c.maxRedemptions)}` : " / sınırsız"}
        </td>
        <td className={`${td} text-xs text-muted-foreground`}>
          {c.startsAt ? fmtDateTime(c.startsAt) : "hemen"} → {c.endsAt ? fmtDateTime(c.endsAt) : "süresiz"}
        </td>
        <td className={td}>
          <Badge tone={s.tone}>{s.text}</Badge>
        </td>
        <td className={`${td} whitespace-nowrap text-right`}>
          <Button size="sm" variant="ghost" onClick={() => void showWho()} disabled={c.redeemed === 0}>
            <Users className="h-3.5 w-3.5" aria-hidden /> Kullananlar
          </Button>
          {canEdit && (
            <Button size="sm" variant="ghost" loading={busy} onClick={() => void toggle()}>
              {c.active ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />} {c.active ? "Durdur" : "Sürdür"}
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className={`${td} bg-surface-2`}>
            {!who ? (
              <Spinner />
            ) : who.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">Henüz kullanan yok.</p>
            ) : (
              <ul className="grid gap-1 text-xs sm:grid-cols-2">
                {who.items.map((r) => (
                  <li key={r.id}>
                    {fmtDateTime(r.createdAt)} · {r.user ? (r.user.email ?? r.user.name ?? r.user.id) : "silinmiş hesap"}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function CommonFields({ v, set }: { v: Draft; set: (p: Partial<Draft>) => void }) {
  return (
    <>
      <Field label="Kampanya adı" htmlFor={`${v.kindId}-campaign`} hint="Kodları gruplamak ve raporlamak için">
        <Input id={`${v.kindId}-campaign`} value={v.campaign} maxLength={80} onChange={(e) => set({ campaign: e.target.value })} placeholder="Örn. Yaz 2026 / Koçtaş kartı" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ne verir" htmlFor={`${v.kindId}-kind`}>
          <Select id={`${v.kindId}-kind`} value={v.kind} onChange={(e) => set({ kind: e.target.value as PromoKind })}>
            <option value="CREDITS">Kredi</option>
            <option value="PRO_DAYS">PRO günü</option>
          </Select>
        </Field>
        <Field label={v.kind === "CREDITS" ? "Kredi (1–500)" : "Gün (1–365)"} htmlFor={`${v.kindId}-amount`}>
          <Input id={`${v.kindId}-amount`} type="number" min={1} max={v.kind === "CREDITS" ? 500 : 365} value={v.amount} onChange={(e) => set({ amount: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Başlangıç (boş: hemen)" htmlFor={`${v.kindId}-start`}>
          <Input id={`${v.kindId}-start`} type="datetime-local" value={v.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
        </Field>
        <Field label="Bitiş (boş: süresiz)" htmlFor={`${v.kindId}-end`}>
          <Input id={`${v.kindId}-end`} type="datetime-local" value={v.endsAt} onChange={(e) => set({ endsAt: e.target.value })} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" aria-label="Yalnız yeni üyeler" checked={v.newUsersOnly} onChange={(e) => set({ newUsersOnly: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" />
        Yalnız yeni üyeler (kod oluşturulduktan sonra açılan hesaplar)
      </label>
      <Field label="Gerekçe" htmlFor={`${v.kindId}-reason`} hint="Denetim kaydına yazılır (en az 3 karakter).">
        <Input id={`${v.kindId}-reason`} value={v.reason} maxLength={200} onChange={(e) => set({ reason: e.target.value })} />
      </Field>
    </>
  );
}

type Draft = { kindId: string; campaign: string; kind: PromoKind; amount: string; startsAt: string; endsAt: string; newUsersOnly: boolean; reason: string };
const blank = (kindId: string): Draft => ({ kindId, campaign: "", kind: "CREDITS", amount: "5", startsAt: "", endsAt: "", newUsersOnly: false, reason: "" });
const payload = (d: Draft) => ({ campaign: d.campaign.trim(), kind: d.kind, amount: Number(d.amount), startsAt: iso(d.startsAt), endsAt: iso(d.endsAt), newUsersOnly: d.newUsersOnly, reason: d.reason.trim() });

function CreateShared({ onCreated }: { onCreated: () => void }) {
  const { toast } = useFeedback();
  const [d, setD] = useState<Draft>(blank("shared"));
  const [code, setCode] = useState("");
  const [max, setMax] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  async function create() {
    setBusy(true);
    try {
      const c = await api<PromoCode>("/promo", { method: "POST", body: { ...payload(d), code, maxRedemptions: max ? Number(max) : null } });
      toast("success", `${c.display} oluşturuldu.`);
      setD(blank("shared"));
      setCode("");
      setMax("");
      onCreated();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title={<span className="flex items-center gap-2"><Plus className="h-4 w-4" aria-hidden /> Kampanya kodu</span>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kod (6–32 harf ve rakam)" htmlFor="shared-code" hint="Büyük-küçük harf, boşluk, tire fark etmez">
            <Input id="shared-code" value={code} maxLength={40} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="YAZ2026" className="font-mono" />
          </Field>
          <Field label="Toplam kullanım sınırı" htmlFor="shared-max" hint="Boş: sınırsız (kişi başı yine bir kez)">
            <Input id="shared-max" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} />
          </Field>
        </div>
        <CommonFields v={d} set={set} />
        <Button variant="primary" loading={busy} disabled={code.trim().length < 6 || d.campaign.trim().length < 2 || d.reason.trim().length < 3} onClick={() => void create()}>
          Oluştur
        </Button>
      </div>
    </Card>
  );
}

function CreateBatch({ onCreated }: { onCreated: () => void }) {
  const { toast, confirm } = useFeedback();
  const [d, setD] = useState<Draft>(blank("batch"));
  const [count, setCount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<PromoBatch | null>(null);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  function download(b: PromoBatch) {
    const csv = ["kod,kampanya,verir", ...b.codes.map((c) => `${c},"${b.campaign.replace(/"/g, '""')}",${b.amount} ${KIND[b.kind].unit}`)].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `casalume-hediye-kodlari-${b.campaign.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function create() {
    setBusy(true);
    try {
      const b = await api<PromoBatch>("/promo/batch", { method: "POST", body: { ...payload(d), count: Number(count) } });
      setMade(b);
      download(b);
      setD(blank("batch"));
      onCreated();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Üretilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function closeCodes() {
    if (await confirm({ title: "Kodlar kapanıyor", description: "Bu kodlar bir daha gösterilemez. CSV dosyasını indirdiğinden emin misin?", confirmLabel: "Kapat" })) setMade(null);
  }

  return (
    <Card title={<span className="flex items-center gap-2"><Gift className="h-4 w-4" aria-hidden /> Hediye kodları (tek kullanımlık)</span>}>
      {made ? (
        <div className="flex flex-col gap-3">
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
            {fmtInt(made.codes.length)} kod üretildi ve CSV olarak indirildi. Kodlar yalnız şimdi görünür; sistemde okunur hâlde saklanmaz.
          </p>
          <pre className="max-h-48 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">{made.codes.join("\n")}</pre>
          <div className="flex gap-2">
            <Button onClick={() => download(made)}>
              <Download className="h-4 w-4" aria-hidden /> CSV&apos;yi yeniden indir
            </Button>
            <Button variant="ghost" onClick={() => void closeCodes()}>
              Kapat
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Kaç kod (1–1000)" htmlFor="batch-count">
            <Input id="batch-count" type="number" min={1} max={1000} value={count} onChange={(e) => setCount(e.target.value)} />
          </Field>
          <CommonFields v={d} set={set} />
          <Button variant="primary" loading={busy} disabled={d.campaign.trim().length < 2 || d.reason.trim().length < 3 || !(Number(count) >= 1)} onClick={() => void create()}>
            Üret ve CSV indir
          </Button>
        </div>
      )}
    </Card>
  );
}

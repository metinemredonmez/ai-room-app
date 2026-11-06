"use client";

import { CalendarClock, X } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, Table, td, th } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { AdminMe, PriceScheduleItem, PriceScheduleStatus, PriceSchedules, PriceTarget } from "@/lib/types";

// Planlı fiyat değişikliği (API.md §7.36): bir aracın kredi bedelini ya da bir paketin verdiği krediyi belli bir
// zamanda değiştirmek, istenirse belli bir zamanda eski hâline döndürmek. Değişiklik kataloğun kendisine yazılır;
// geri dönüş, arada elle yapılmış bir değişikliğe dokunmaz. Mağaza fiyatları App Store / Play'den değişir.

const STATUS: Record<PriceScheduleStatus, { label: string; tone: "neutral" | "good" | "danger" | "warn" | "primary" }> = {
  SCHEDULED: { label: "Planlandı", tone: "primary" },
  ACTIVE: { label: "Sürüyor", tone: "good" },
  DONE: { label: "Bitti", tone: "neutral" },
  CANCELLED: { label: "İptal", tone: "neutral" },
  FAILED: { label: "Uygulanamadı", tone: "danger" },
};
const unit = (kind: "tool" | "pack") => (kind === "tool" ? "kredi / tasarım" : "kredi verir");

export default function PriceSchedulesPage() {
  const list = useApi<PriceSchedules>("/price-schedules");
  const me = useApi<AdminMe>("/me");
  const canEdit = me.data ? ["ADMIN", "SUPER_ADMIN"].includes(me.data.role) : false;
  return (
    <>
      <PageHeader
        title="Planlı fiyatlar"
        description="Bir aracın kredi bedelini ya da bir paketin verdiği krediyi ileri bir tarihte değiştir; bitiş verirsen o saatte kendiliğinden eski hâline döner (kampanya). Değişiklik bir dakika içinde uygulanır ve Ürün kataloğu / Planlar sayfalarında görünür. Mağazadaki TL fiyatı App Store Connect ve Play Console'dan değişir."
      />
      {list.error && !list.data ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : !list.data ? (
        <Spinner />
      ) : (
        <>
          {canEdit && <NewPlan targets={list.data.targets} onCreated={list.reload} />}
          <Card title="Planlar" className="mt-4">
            {list.data.items.length === 0 ? (
              <EmptyState title="Henüz plan yok" description="Yukarıdan bir fiyat değişikliği planla." />
            ) : (
              <Table
                head={
                  <tr>
                    <th className={th}>Ne</th>
                    <th className={th}>Değişiklik</th>
                    <th className={th}>Ne zaman</th>
                    <th className={th}>Durum</th>
                    <th className={th}>Gerekçe</th>
                    <th className={th} />
                  </tr>
                }
              >
                {list.data.items.map((s) => (
                  <Row key={s.id} s={s} canEdit={canEdit} onChanged={list.reload} />
                ))}
              </Table>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function Row({ s, canEdit, onChanged }: { s: PriceScheduleItem; canEdit: boolean; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const open = s.status === "SCHEDULED" || s.status === "ACTIVE";

  async function cancel() {
    const running = s.status === "ACTIVE";
    const ok = await confirm({
      title: running ? "Şimdi bitirilsin mi?" : "Plan iptal edilsin mi?",
      description: running ? `${s.label} eski değerine (${s.previousValue ?? "?"}) döner; arada elle değiştirildiyse dokunulmaz.` : `${s.label} için plan hiç uygulanmaz.`,
      confirmLabel: running ? "Şimdi bitir" : "İptal et",
      destructive: true,
    });
    if (!ok) return;
    const reason = window.prompt("Neden? (denetim kaydına yazılır)");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await api(`/price-schedules/${s.id}/cancel`, { method: "POST", body: { reason: reason.trim() } });
      onChanged();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className={td}>
        <div className="font-medium text-fg">{s.label}</div>
        <div className="text-[11px] text-muted-foreground">
          {s.kind === "tool" ? "Araç" : "Paket"} · <span className="font-mono">{s.key}</span>
          {s.current !== null && ` · şu an ${s.current}`}
        </div>
      </td>
      <td className={`${td} whitespace-nowrap tabular-nums`}>
        {s.previousValue ?? "…"} → <span className="font-medium text-fg">{s.value}</span> <span className="text-[11px] text-muted-foreground">{unit(s.kind)}</span>
      </td>
      <td className={`${td} whitespace-nowrap text-xs`}>
        {fmtDateTime(s.startsAt)}
        <div className="text-muted-foreground">{s.endsAt ? `→ ${fmtDateTime(s.endsAt)}` : "kalıcı"}</div>
      </td>
      <td className={td}>
        <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
        {s.outcome && <div className="mt-1 max-w-56 text-[11px] text-muted-foreground">{s.outcome}</div>}
      </td>
      <td className={`${td} max-w-60 text-xs`}>
        {s.note}
        {s.createdBy && <div className="text-[11px] text-muted-foreground">{s.createdBy}</div>}
      </td>
      <td className={`${td} text-right`}>
        {canEdit && open && (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void cancel()}>
            <X className="h-3.5 w-3.5" aria-hidden /> {s.status === "ACTIVE" ? "Şimdi bitir" : "İptal"}
          </Button>
        )}
      </td>
    </tr>
  );
}

/** datetime-local value (browser time) → ISO; empty stays empty. */
const toIso = (v: string) => (v ? new Date(v).toISOString() : "");

function NewPlan({ targets, onCreated }: { targets: PriceTarget[]; onCreated: () => void }) {
  const { toast } = useFeedback();
  const [target, setTarget] = useState(targets[0] ? `${targets[0].kind}:${targets[0].key}` : "");
  const [value, setValue] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const t = targets.find((x) => `${x.kind}:${x.key}` === target);
  const n = Number(value);
  const valueOk = !!t && Number.isInteger(n) && n >= 1 && n <= t.max;

  async function create() {
    if (!t) return;
    setBusy(true);
    try {
      await api("/price-schedules", {
        method: "POST",
        body: { kind: t.kind, key: t.key, value: n, startsAt: toIso(startsAt) || new Date().toISOString(), endsAt: toIso(endsAt) || null, reason: reason.trim() },
      });
      toast("success", startsAt ? "Planlandı." : "Planlandı; bir dakika içinde uygulanır.");
      setValue("");
      setStartsAt("");
      setEndsAt("");
      setReason("");
      onCreated();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Planlanamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4" aria-hidden /> Yeni plan</span>}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Ne değişecek" htmlFor="ps-target" hint={t ? `Şu an: ${t.value} ${unit(t.kind)}${t.active ? "" : " (kapalı)"}` : undefined}>
          <Select id="ps-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            <optgroup label="Araç (tasarım başına kredi)">
              {targets.filter((x) => x.kind === "tool").map((x) => (
                <option key={x.key} value={`tool:${x.key}`}>{x.label}</option>
              ))}
            </optgroup>
            <optgroup label="Paket (verdiği kredi)">
              {targets.filter((x) => x.kind === "pack").map((x) => (
                <option key={x.key} value={`pack:${x.key}`}>{x.label}</option>
              ))}
            </optgroup>
          </Select>
        </Field>
        <Field label={t ? `Yeni değer (1–${t.max})` : "Yeni değer"} htmlFor="ps-value">
          <Input id="ps-value" type="number" inputMode="numeric" min={1} max={t?.max} value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Başlangıç (boş: hemen)" htmlFor="ps-start">
          <Input id="ps-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label="Bitiş (boş: kalıcı)" htmlFor="ps-end" hint="Bitişte eski değere döner.">
          <Input id="ps-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <Field label="Gerekçe" htmlFor="ps-reason" hint="Denetim kaydına yazılır (en az 3 karakter).">
            <Input id="ps-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Örn. Kasım kampanyası: Sanal mobilya 1 kredi" />
          </Field>
        </div>
        <Button variant="primary" loading={busy} disabled={!valueOk || reason.trim().length < 3} onClick={() => void create()}>
          Planla
        </Button>
      </div>
    </Card>
  );
}

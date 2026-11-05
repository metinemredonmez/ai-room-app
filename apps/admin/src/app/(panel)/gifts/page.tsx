"use client";

import { Eye, Gift } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, Table, td, th } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { AdminMe, GiftCampaign, GiftPreview, GiftSegment } from "@/lib/types";

// Toplu hediye (API.md §7.32): bir gruba kredi ve push bildirimi. Yalnız doğrulanmış, aktif, gerçek kullanıcılar
// (personel ve misafir yok). Önce önizle, sonra gönder; aynı kampanyada kimse iki kez almaz, aynı hediye 10 dakika
// içinde ikinci kez gönderilemez. Gönderim gerekçe ister ve denetlenir.

const SEGMENT: Record<GiftSegment, { label: string; days: string | null }> = {
  inactive: { label: "Uzun süredir girmeyenler (geri dönüş)", days: "En az kaç gündür girmemiş" },
  new: { label: "Yeni katılanlar", days: "Son kaç günde katılmış" },
  pro: { label: "PRO aboneler (teşekkür)", days: null },
  all: { label: "Doğrulanmış bütün kullanıcılar", days: null },
};

export default function GiftsPage() {
  const me = useApi<AdminMe>("/me");
  const history = useApi<{ items: GiftCampaign[] }>("/gifts");
  const canSend = me.data ? ["ADMIN", "SUPER_ADMIN"].includes(me.data.role) : false;
  return (
    <>
      <PageHeader
        title="Toplu hediye"
        description="Bir gruba hediye kredi ve bildirim gönder: geri dönüş, teşekkür ya da hoş geldin. Yalnız e-postası doğrulanmış gerçek kullanıcılar; personel ve misafir hesapları hariç."
      />
      <Composer canSend={canSend} onSent={history.reload} />
      <Card title="Geçmiş" className="mt-4">
        {history.error && !history.data ? (
          <ErrorState message={history.error.message} onRetry={history.reload} />
        ) : !history.data ? (
          <Spinner />
        ) : history.data.items.length === 0 ? (
          <EmptyState title="Henüz toplu hediye yok" />
        ) : (
          <Table
            head={
              <tr>
                <th className={th}>Tarih</th>
                <th className={th}>Grup</th>
                <th className={th}>Kredi</th>
                <th className={th}>Alan</th>
                <th className={th}>Bildirim</th>
                <th className={th}>Gönderen</th>
              </tr>
            }
          >
            {history.data.items.map((c) => (
              <tr key={c.id}>
                <td className={`${td} whitespace-nowrap text-xs`}>{fmtDateTime(c.createdAt)}</td>
                <td className={td}>
                  {SEGMENT[c.segment]?.label ?? c.segment}
                  {c.days !== null && <span className="text-xs text-muted-foreground"> · {fmtInt(c.days)} gün</span>}
                  {c.message && <p className="text-[11px] text-muted-foreground">“{c.message}”</p>}
                </td>
                <td className={`${td} tabular-nums`}>+{fmtInt(c.credits)}</td>
                <td className={`${td} tabular-nums`}>
                  {fmtInt(c.recipients)} {c.status !== "SENT" && <Badge tone={c.status === "FAILED" ? "danger" : "neutral"}>{c.status === "FAILED" ? "Yarıda kaldı" : "Gönderiliyor"}</Badge>}
                </td>
                <td className={`${td} tabular-nums`}>{fmtInt(c.pushed)}</td>
                <td className={`${td} text-xs`}>{c.createdBy ?? "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function Composer({ canSend, onSent }: { canSend: boolean; onSent: () => void }) {
  const { toast, confirm } = useFeedback();
  const [segment, setSegment] = useState<GiftSegment>("inactive");
  const [days, setDays] = useState("30");
  const [credits, setCredits] = useState("3");
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<GiftPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const needsDays = SEGMENT[segment].days !== null;
  const body = { segment, days: needsDays ? Number(days) : null };

  async function doPreview() {
    setBusy("preview");
    try {
      setPreview(await api<GiftPreview>("/gifts/preview", { method: "POST", body }));
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Önizlenemedi.");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!preview) return;
    const n = Number(credits);
    const ok = await confirm({
      title: `${fmtInt(preview.count)} kişiye ${fmtInt(n)} kredi gönderilsin mi?`,
      description: `Toplam ${fmtInt(preview.count * n)} kredi. ${fmtInt(preview.withPush)} kişiye push bildirimi gider. Geri alınamaz.`,
      confirmLabel: "Gönder",
    });
    if (!ok) return;
    setBusy("send");
    try {
      const out = await api<{ id: string; recipients: number }>("/gifts", {
        method: "POST",
        body: { ...body, credits: n, message: message.trim(), reason: reason.trim(), expected: preview.count },
      });
      toast("success", `${fmtInt(out.recipients)} kişiye hediye gönderildi; bildirimler arka planda gidiyor.`);
      setPreview(null);
      setMessage("");
      setReason("");
      onSent();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Gönderilemedi.");
    } finally {
      setBusy(null);
    }
  }

  const reset = () => setPreview(null);
  return (
    <Card title={<span className="flex items-center gap-2"><Gift className="h-4 w-4" aria-hidden /> Yeni toplu hediye</span>}>
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <Field label="Grup" htmlFor="g-segment">
            <Select id="g-segment" value={segment} onChange={(e) => { setSegment(e.target.value as GiftSegment); reset(); }}>
              {(Object.keys(SEGMENT) as GiftSegment[]).map((k) => (
                <option key={k} value={k}>
                  {SEGMENT[k].label}
                </option>
              ))}
            </Select>
          </Field>
          {needsDays && (
            <Field label={SEGMENT[segment].days!} htmlFor="g-days" hint="1–365 gün">
              <Input id="g-days" type="number" min={1} max={365} value={days} onChange={(e) => { setDays(e.target.value); reset(); }} />
            </Field>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void doPreview()} loading={busy === "preview"} disabled={needsDays && !(Number(days) >= 1)}>
            <Eye className="h-4 w-4" aria-hidden /> Önizle
          </Button>
          {preview && (
            <p className="text-sm">
              <span className="font-semibold">{fmtInt(preview.count)}</span> kişi · <span className="text-muted-foreground">{fmtInt(preview.withPush)} kişide uygulama bildirimi açık</span>
              {preview.count > preview.max && <span className="ml-2 text-danger">En çok {fmtInt(preview.max)} kişi; grubu daralt.</span>}
            </p>
          )}
        </div>
        {canSend && preview && preview.count > 0 && preview.count <= preview.max && (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <div className="grid gap-3 md:grid-cols-[8rem_1fr]">
              <Field label="Kredi (1–100)" htmlFor="g-credits">
                <Input id="g-credits" type="number" min={1} max={100} value={credits} onChange={(e) => setCredits(e.target.value)} />
              </Field>
              <Field label="Bildirim metni (isteğe bağlı)" htmlFor="g-message" hint={`Boşsa “Seni özledik! … hediye kredi” · ${message.length}/140`}>
                <Input id="g-message" maxLength={140} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ör. Yeni stiller geldi, bu krediler senden!" />
              </Field>
            </div>
            <Field label="Gerekçe (iç not)" htmlFor="g-reason" hint="Denetim kaydına yazılır (en az 3 karakter).">
              <Input id="g-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ör. kasım geri dönüş kampanyası" />
            </Field>
            <Button variant="primary" loading={busy === "send"} disabled={!(Number(credits) >= 1 && Number(credits) <= 100) || reason.trim().length < 3} onClick={() => void send()}>
              <Gift className="h-4 w-4" aria-hidden /> {fmtInt(preview.count)} kişiye gönder
            </Button>
          </div>
        )}
        {!canSend && <p className="text-xs text-muted-foreground">Önizleyebilirsin; göndermek için yönetici rolü gerekir.</p>}
      </div>
    </Card>
  );
}

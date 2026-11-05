"use client";

import { Ban, Save } from "lucide-react";
import { useState } from "react";
import { StatTile } from "@/components/charts";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, Table, td, th } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { AdminMe, ReferralItem, ReferralSettings, ReferralState } from "@/lib/types";

// Davet programı (API.md §7.30). Davet edilen kodu girince kredi alır; davet eden, arkadaşı ilk tasarımını yapınca ve
// aylık sınır içinde. Bir e-posta kimliği bir kez davet edilebilir. Program kapalı başlar. Şüpheli bekleyen davet
// reddedilebilir (davet eden ödül almaz). Her değişiklik gerekçe ister ve denetlenir.

const STATUS: Record<ReferralItem["status"], { tone: "good" | "neutral" | "danger"; text: string }> = {
  PENDING: { tone: "neutral", text: "İlk tasarım bekleniyor" },
  REWARDED: { tone: "good", text: "Ödül verildi" },
  REJECTED: { tone: "danger", text: "Ödül yok" },
};

export default function ReferralsPage() {
  const me = useApi<AdminMe>("/me");
  const [status, setStatus] = useState("");
  const state = useApi<ReferralState>("/referrals", { status: status || undefined });
  const s = state.data;
  const canEdit = me.data ? ["ADMIN", "SUPER_ADMIN"].includes(me.data.role) : false;
  return (
    <>
      <PageHeader
        title="Davet programı"
        description="Davet edilen, kodu girince kredi alır. Davet eden, arkadaşı ilk tasarımını yapınca kazanır (aylık sınırla); böylece sahte kayıt kredi kazandırmaz. Bir e-posta yalnız bir kez davet edilebilir."
      />
      {state.error && !s ? (
        <ErrorState message={state.error.message} onRetry={state.reload} />
      ) : !s ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Son 30 gün: davetle katılan" value={s.stats.claims30} />
            <StatTile label="Son 30 gün: ödül verilen" value={s.stats.rewarded30} />
            <StatTile label="Son 30 gün: dağıtılan kredi" value={s.stats.credits30} />
            <StatTile label="İlk tasarım bekleyen" value={s.stats.pending} />
          </div>
          <SettingsCard key={s.version ?? "default"} state={s} canEdit={canEdit} onSaved={(n) => state.setData(() => n)} onReload={state.reload} />
          {s.top.length > 0 && (
            <Card title="En çok davet edenler (ödüllü)">
              <ol className="grid gap-1 text-sm sm:grid-cols-2">
                {s.top.map((t, i) => (
                  <li key={t.userId ?? i} className="flex justify-between gap-3">
                    <span className="truncate">{t.email ?? "silinmiş hesap"}</span>
                    <span className="tabular-nums text-muted-foreground">{fmtInt(t.rewarded)}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          <Card
            title="Son davetler"
            actions={
              <Select aria-label="Durum" value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-52 text-xs">
                <option value="">Hepsi</option>
                <option value="PENDING">İlk tasarım bekleniyor</option>
                <option value="REWARDED">Ödül verildi</option>
                <option value="REJECTED">Ödül yok</option>
              </Select>
            }
          >
            {s.items.length === 0 ? (
              <EmptyState title="Henüz davet yok" description={s.settings.enabled ? "Kullanıcılar Hesabım sayfasındaki bağlantıyla davet eder." : "Program kapalı; yukarıdan aç."} />
            ) : (
              <Table
                head={
                  <tr>
                    <th className={th}>Tarih</th>
                    <th className={th}>Davet eden</th>
                    <th className={th}>Davet edilen</th>
                    <th className={th}>Kredi</th>
                    <th className={th}>Durum</th>
                    <th className={th} />
                  </tr>
                }
              >
                {s.items.map((r) => (
                  <ItemRow key={r.id} r={r} canEdit={canEdit} onChanged={(n) => state.setData(() => n)} />
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function ItemRow({ r, canEdit, onChanged }: { r: ReferralItem; canEdit: boolean; onChanged: (s: ReferralState) => void }) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  async function reject() {
    const reason = window.prompt("Neden reddediliyor? Davet eden ödül almaz; davet edilenin kredisi kalır. (denetim kaydına yazılır)");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      onChanged(await api<ReferralState>(`/referrals/${r.id}/reject`, { method: "POST", body: { reason: reason.trim() } }));
      toast("success", "Davet reddedildi.");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Reddedilemedi.");
    } finally {
      setBusy(false);
    }
  }
  const st = STATUS[r.status];
  return (
    <tr>
      <td className={`${td} whitespace-nowrap text-xs`}>{fmtDateTime(r.createdAt)}</td>
      <td className={td}>{r.inviter?.email ?? "silinmiş hesap"}</td>
      <td className={td}>{r.invitee?.email ?? "silinmiş hesap"}</td>
      <td className={`${td} whitespace-nowrap text-xs tabular-nums`}>
        +{r.inviteeCredits} / +{r.inviterCredits}
      </td>
      <td className={td}>
        <Badge tone={st.tone}>{st.text}</Badge>
        {r.rejectReason && <p className="mt-0.5 text-[11px] text-muted-foreground">{r.rejectReason}</p>}
      </td>
      <td className={`${td} text-right`}>
        {canEdit && r.status === "PENDING" && (
          <Button size="sm" variant="ghost" className="text-danger" loading={busy} onClick={() => void reject()}>
            <Ban className="h-3.5 w-3.5" aria-hidden /> Reddet
          </Button>
        )}
      </td>
    </tr>
  );
}

function SettingsCard({ state, canEdit, onSaved, onReload }: { state: ReferralState; canEdit: boolean; onSaved: (s: ReferralState) => void; onReload: () => void }) {
  const { toast, confirm } = useFeedback();
  const [v, setV] = useState<ReferralSettings>(state.settings);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(state.settings);
  const num = (k: keyof Omit<ReferralSettings, "enabled">) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: Number(e.target.value) }));

  async function save() {
    if (v.enabled && !state.settings.enabled) {
      const ok = await confirm({
        title: "Davet programı açılıyor",
        description: `Davet edilen ${v.inviteeCredits} kredi, davet eden arkadaşının ilk tasarımında ${v.inviterCredits} kredi alır (ayda en çok ${v.monthlyCap} ödül).`,
        confirmLabel: "Aç",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const out = await api<ReferralState>("/referrals/settings", { method: "PATCH", body: { settings: v, reason: reason.trim(), version: state.version } });
      setReason("");
      onSaved(out);
      toast("success", "Kaydedildi; en geç 15 saniyede geçerli olur.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (await confirm({ title: "Ayar bu arada değişti", description: "Başka biri kaydetmiş. Güncel hâli yüklensin mi?", confirmLabel: "Yükle" })) onReload();
      } else toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Ayarlar">
      <fieldset disabled={!canEdit} className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" aria-label="Davet programı açık" checked={v.enabled} onChange={(e) => setV((x) => ({ ...x, enabled: e.target.checked }))} className="h-4 w-4 accent-[var(--primary)]" />
          Program açık {state.settings.enabled ? <Badge tone="good">Yayında</Badge> : <Badge tone="neutral">Kapalı</Badge>}
        </label>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Davet edene (kredi)" htmlFor="r-inviter" hint="Arkadaşın ilk tasarımında, 1–50">
            <Input id="r-inviter" type="number" min={1} max={50} value={v.inviterCredits} onChange={num("inviterCredits")} />
          </Field>
          <Field label="Davet edilene (kredi)" htmlFor="r-invitee" hint="Kodu girince, 0–50">
            <Input id="r-invitee" type="number" min={0} max={50} value={v.inviteeCredits} onChange={num("inviteeCredits")} />
          </Field>
          <Field label="Aylık ödül sınırı" htmlFor="r-cap" hint="Davet eden başına, 1–100">
            <Input id="r-cap" type="number" min={1} max={100} value={v.monthlyCap} onChange={num("monthlyCap")} />
          </Field>
          <Field label="Kod girme süresi (gün)" htmlFor="r-days" hint="Kayıttan sonra, 1–60">
            <Input id="r-days" type="number" min={1} max={60} value={v.claimDays} onChange={num("claimDays")} />
          </Field>
        </div>
        {canEdit && (
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <Field label="Gerekçe" htmlFor="r-reason" hint="Denetim kaydına yazılır (en az 3 karakter).">
                <Input id="r-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Örn. kasım kampanyası için açıldı" />
              </Field>
            </div>
            <Button variant="primary" loading={busy} disabled={!dirty || reason.trim().length < 3} onClick={() => void save()}>
              <Save className="h-4 w-4" aria-hidden /> Kaydet
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {state.updatedAt ? `Son kayıt: ${fmtDateTime(state.updatedAt)}${state.updatedBy ? ` · ${state.updatedBy}` : ""}.` : "Henüz kaydedilmedi: program kapalı."}
        </p>
      </fieldset>
    </Card>
  );
}

"use client";

import { CheckCheck, Save, Send } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Spinner, Table, Textarea, td, th } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { AdminMe, AlertSettings, AlertsState, ErrorGroupRow } from "@/lib/types";

// Uyarılar ve hatalar (API.md §7.41): Sentry yerine kendi hata alarmımız ve kurucu uyarıları. Hatalar parmak iziyle
// gruplanır (kişisel veri maskelenir); yeni ya da yeniden açılan hata hemen, süren hata en çok “tekrar aralığında” bir
// e-posta gönderir. Saatte en çok 20 uyarı. SUPPORT görür; ADMIN ayarlar, dener ve çözüldü işaretler.

const KIND_LABEL: Record<string, string> = { error: "Hata", job: "Zamanlı iş", purchase: "Satın alma", disk: "Disk", budget: "AI bütçesi", test: "Deneme" };

export default function AlertsPage() {
  const state = useApi<AlertsState>("/alerts");
  const me = useApi<AdminMe>("/me");
  const s = state.data;
  const canEdit = me.data ? ["ADMIN", "SUPER_ADMIN"].includes(me.data.role) : false;
  return (
    <>
      <PageHeader
        title="Uyarılar ve hatalar"
        description="Beklenmeyen hatalar (API, web ve uygulama), zamanlı iş hataları, satın almalar, disk doluluğu ve AI bütçesi için e-posta uyarıları. Hatalar burada gruplanır; kişisel veri (e-posta, IP, token) maskelenir."
      />
      {state.error && !s ? (
        <ErrorState message={state.error.message} onRetry={state.reload} />
      ) : !s || !me.data ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-4">
          <Errors errors={s.errors} canEdit={canEdit} onChanged={state.reload} />
          <div className="grid gap-4 xl:grid-cols-2">
            <Settings key={s.version ?? "default"} state={s} canEdit={canEdit} onSaved={(n) => state.setData(() => n)} onReload={state.reload} />
            <Card title="Son uyarılar">
              {s.recent.length === 0 ? (
                <EmptyState title="Henüz uyarı gönderilmedi" />
              ) : (
                <ul className="flex flex-col divide-y divide-line text-sm">
                  {s.recent.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <Badge tone={a.kind === "error" || a.kind === "job" ? "danger" : a.kind === "purchase" ? "good" : "neutral"}>{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                        <span className="ml-2 break-words">{a.subject.replace(/^\[Casalume\]\s*/, "")}</span>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(a.createdAt)} · {a.sentTo} kişi</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function Errors({ errors, canEdit, onChanged }: { errors: ErrorGroupRow[]; canEdit: boolean; onChanged: () => void }) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const open = errors.filter((e) => !e.resolvedAt);

  async function resolve(id: string) {
    setBusy(id);
    try {
      await api(`/alerts/errors/${id}/resolve`, { method: "POST" });
      toast("success", "Çözüldü olarak işaretlendi; yeniden görülürse uyarı gelir.");
      onChanged();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Yapılamadı.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title={`Hatalar · ${open.length} açık`}>
      {errors.length === 0 ? (
        <EmptyState title="Kayıtlı hata yok" description="Beklenmeyen bir hata olunca burada görünür ve e-posta gelir." />
      ) : (
        <Table head={<tr><th className={th}>Hata</th><th className={th}>Yer</th><th className={`${th} text-right`}>Sayı</th><th className={th}>Son görülme</th><th className={th} /></tr>}>
          {errors.map((e) => (
            <tr key={e.id} className={e.resolvedAt ? "opacity-60" : ""}>
              <td className={`${td} max-w-md`}>
                <div className="flex items-center gap-1.5">
                  <Badge tone={e.kind === "job" || e.kind === "client" ? "warn" : "danger"}>{e.kind === "job" ? "İş" : e.kind === "http" ? "API" : e.kind === "client" ? "İstemci" : "Diğer"}</Badge>
                  <span className="font-medium text-fg">{e.name}</span>
                  {e.resolvedAt && <Badge tone="neutral">Çözüldü</Badge>}
                </div>
                <div className="mt-0.5 break-words font-mono text-[11px] text-muted-foreground">{e.message}</div>
              </td>
              <td className={`${td} max-w-xs break-words font-mono text-[11px]`}>{e.location}</td>
              <td className={`${td} text-right tabular-nums`}>{fmtInt(e.count)}</td>
              <td className={`${td} whitespace-nowrap text-xs`}>
                {fmtDateTime(e.lastSeen)}
                {e.lastRequestId && <div className="font-mono text-[10px] text-muted-foreground" title="İstek kimliği (loglarda aranır)">{e.lastRequestId}</div>}
              </td>
              <td className={`${td} text-right`}>
                {canEdit && !e.resolvedAt && (
                  <Button size="sm" variant="ghost" loading={busy === e.id} onClick={() => void resolve(e.id)}>
                    <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Çözüldü
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function Toggle({ label, checked, disabled, onChange, children }: { label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
        {label}
      </label>
      {children}
    </div>
  );
}

function Settings({ state, canEdit, onSaved, onReload }: { state: AlertsState; canEdit: boolean; onSaved: (s: AlertsState) => void; onReload: () => void }) {
  const { toast, confirm } = useFeedback();
  const [s, setS] = useState<AlertSettings>(state.settings);
  const [extra, setExtra] = useState(state.settings.extraRecipients.join(", "));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const next: AlertSettings = { ...s, extraRecipients: extra.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) };
  const dirty = JSON.stringify(next) !== JSON.stringify(state.settings);
  const num = (v: string) => (v === "" ? 0 : Math.trunc(Number(v)));

  async function save() {
    setBusy("save");
    try {
      const out = await api<AlertsState>("/alerts", { method: "PATCH", body: { settings: next, reason: reason.trim(), version: state.version } });
      setReason("");
      onSaved(out);
      toast("success", "Kaydedildi.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (await confirm({ title: "Ayar bu arada değişti", description: "Güncel hâli yüklensin mi?", confirmLabel: "Yükle" })) onReload();
      } else toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const out = await api<{ sent: number; reason: string }>("/alerts/test", { method: "POST" });
      toast(out.sent > 0 ? "success" : "error", out.sent > 0 ? `Deneme uyarısı ${out.sent} adrese gönderildi.` : out.reason === "capped" ? "Saatlik uyarı sınırı dolu." : "Alıcı yok.");
      onReload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Gönderilemedi.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Ayarlar" actions={canEdit ? <Button size="sm" variant="ghost" loading={busy === "test"} disabled={busy !== null || dirty} onClick={() => void test()}><Send className="h-3.5 w-3.5" aria-hidden /> Deneme gönder</Button> : undefined}>
      <p className="text-xs text-muted-foreground">Alıcılar şu an: {state.recipients.length ? state.recipients.join(", ") : "kimse"}.</p>
      <div className="mt-2 flex flex-col divide-y divide-line">
        <Toggle label="Bütün SUPER_ADMIN'lere gönder" checked={s.superAdmins} disabled={!canEdit} onChange={(v) => setS({ ...s, superAdmins: v })} />
        <Toggle label="Beklenmeyen hatalar" checked={s.errors.enabled} disabled={!canEdit} onChange={(v) => setS({ ...s, errors: { ...s.errors, enabled: v } })}>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            sürerse en çok
            <Input type="number" min={15} max={1440} className="h-8 w-20" value={String(s.errors.repeatMinutes)} disabled={!canEdit} onChange={(e) => setS({ ...s, errors: { ...s.errors, repeatMinutes: num(e.target.value) } })} />
            dakikada bir
          </label>
        </Toggle>
        <Toggle label="Zamanlı iş hataları" checked={s.jobs.enabled} disabled={!canEdit} onChange={(v) => setS({ ...s, jobs: { enabled: v } })} />
        <Toggle label="İstemci hataları (web ve uygulama)" checked={s.clients.enabled} disabled={!canEdit} onChange={(v) => setS({ ...s, clients: { enabled: v } })} />
        <Toggle label="Satın almalar (yalnız canlı ortam)" checked={s.purchases.enabled} disabled={!canEdit} onChange={(v) => setS({ ...s, purchases: { enabled: v } })} />
        <Toggle label="Disk doluluğu" checked={s.disk.enabled} disabled={!canEdit} onChange={(v) => setS({ ...s, disk: { ...s.disk, enabled: v } })}>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            eşik %
            <Input type="number" min={50} max={99} className="h-8 w-20" value={String(s.disk.thresholdPct)} disabled={!canEdit} onChange={(e) => setS({ ...s, disk: { ...s.disk, thresholdPct: num(e.target.value) } })} />
          </label>
        </Toggle>
        <Toggle label="AI bütçesi (%80 ve aşım; günde bir kez)" checked={s.budget.enabled} disabled={!canEdit} onChange={(v) => setS({ ...s, budget: { enabled: v } })} />
      </div>
      <div className="mt-3">
        <Field label="Ek alıcılar (en çok 5, virgülle)" htmlFor="alerts-extra">
          <Textarea id="alerts-extra" rows={2} value={extra} disabled={!canEdit} onChange={(e) => setExtra(e.target.value)} placeholder="ops@ornek.com" />
        </Field>
      </div>
      {canEdit && (
        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <Field label="Değişiklik gerekçesi" htmlFor="alerts-reason">
              <Input id="alerts-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <Button variant="primary" loading={busy === "save"} disabled={!dirty || reason.trim().length < 3 || busy !== null} onClick={() => void save()}>
            <Save className="h-4 w-4" aria-hidden /> Kaydet
          </Button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Saatte en çok 20 uyarı gider. {state.updatedAt ? `Son kayıt: ${fmtDateTime(state.updatedAt)}${state.updatedBy ? ` · ${state.updatedBy}` : ""}.` : "Varsayılan ayarlar kullanılıyor."}
      </p>
    </Card>
  );
}

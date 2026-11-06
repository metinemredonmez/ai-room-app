"use client";

import { CheckCircle2, Clock, Loader2, Play, RotateCw, XCircle } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, Table, td, th } from "@/components/common";
import { StatTile } from "@/components/charts";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { AdminMe, JobRun, JobSchedule, JobsOverview } from "@/lib/types";

const JOB_LABELS: Record<string, { label: string; schedule: string }> = {
  "reconcile-designs": { label: "Takılan tasarımları toparla", schedule: "Her dakika" },
  "broadcasts-due": { label: "Zamanı gelen toplu gönderimler", schedule: "Her dakika" },
  "price-schedules": { label: "Planlı fiyat değişiklikleri", schedule: "Her dakika" },
  retention: { label: "Saklama süresi temizliği (KVKK)", schedule: "Her gün 03:30" },
  loyalty: { label: "Sadakat: yıldönümü ve geri dönüş", schedule: "Her gün 11:00" },
  "kvkk-deadlines": { label: "KVKK başvuru süreleri özeti", schedule: "Her gün 09:00" },
  "weekly-report": { label: "Haftalık rapor e-postası", schedule: "Pazartesi 09:00" },
};

function duration(run: JobRun): string {
  if (!run.finishedAt) return "—";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} sn`;
}

function details(run: JobRun): string {
  const entries = Object.entries(run.details ?? {});
  if (!entries.length) return "—";
  return entries.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ").slice(0, 240);
}

function StatusBadge({ status }: { status: JobRun["status"] }) {
  if (status === "ok") return <Badge tone="good" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>Başarılı</Badge>;
  if (status === "error") return <Badge tone="danger" icon={<XCircle className="h-3.5 w-3.5" />}>Hata</Badge>;
  return <Badge tone="warn" icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}>Çalışıyor</Badge>;
}

export default function JobsPage() {
  const res = useApi<JobsOverview>("/jobs", { limit: 100 });
  const s = res.data;
  const lastError = s?.items.find((r) => r.status === "error");
  return (
    <>
      <PageHeader
        title="Zamanlı işler"
        description="Tasarım kuyruğu ve bakım işlerinin son çalışmaları (sessiz arızaları görmek için)"
        actions={
          <Button onClick={res.reload} loading={res.loading && Boolean(s)}>
            <RotateCw className="h-4 w-4" aria-hidden /> Yenile
          </Button>
        }
      />
      {res.error && !s ? (
        <ErrorState message={res.error.message} onRetry={res.reload} />
      ) : !s ? (
        <Spinner />
      ) : (
        <div className={`flex flex-col gap-4 ${res.loading ? "opacity-60" : ""}`}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Kuyrukta bekleyen" value={s.queue.waiting} note="Tasarım işi" />
            <StatTile label="İşleniyor" value={s.queue.active} />
            <StatTile label="Yeniden denenecek" value={s.queue.delayed} note="Geçici AI hatası" />
            <StatTile label="Başarısız (son kayıtlar)" value={s.queue.failed} note="Kredisi iade edildi" />
          </div>
          <Schedules schedules={s.schedules ?? []} onRan={res.reload} />
          {lastError && (
            <p className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
              Son hata: {JOB_LABELS[lastError.name]?.label ?? lastError.name} — {fmtDateTime(lastError.startedAt)} · {details(lastError)}
            </p>
          )}
          <Card title="Son çalışmalar">
            {s.items.length === 0 ? (
              <EmptyState title="Henüz çalışma yok" description="İşler ilk dakika içinde çalışmaya başlar." />
            ) : (
              <Table
                head={
                  <tr>
                    <th className={th}>İş</th>
                    <th className={th}>Durum</th>
                    <th className={th}>Başlangıç</th>
                    <th className={th}>Süre</th>
                    <th className={th}>Sonuç</th>
                  </tr>
                }
              >
                {s.items.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>
                      <span className="text-fg">{JOB_LABELS[r.name]?.label ?? r.name}</span>
                      <span className="block text-xs text-muted-foreground">{JOB_LABELS[r.name]?.schedule ?? r.name}</span>
                    </td>
                    <td className={td}><StatusBadge status={r.status} /></td>
                    <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDateTime(r.startedAt)}</td>
                    <td className={`${td} tabular`}>{duration(r)}</td>
                    <td className={`${td} max-w-md break-all font-mono text-[11px] text-muted-foreground`}>{details(r)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

/** API.md §7.42: every scheduler with its next run, its last result and a late flag; listed jobs run from here. */
function Schedules({ schedules, onRan }: { schedules: JobSchedule[]; onRan: () => void }) {
  const me = useApi<AdminMe>("/me");
  const canRun = me.data ? ["ADMIN", "SUPER_ADMIN"].includes(me.data.role) : false;
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const late = schedules.filter((x) => x.late);

  async function run(name: string) {
    const label = JOB_LABELS[name]?.label ?? name;
    const ok = await confirm({ title: `“${label}” şimdi çalışsın mı?`, description: "İş kuyruğa alınır ve birkaç saniye içinde çalışır; tekrarı zararsızdır. Sonucu aşağıdaki listede görürsün.", confirmLabel: "Çalıştır" });
    if (!ok) return;
    const reason = window.prompt("Neden? (denetim kaydına yazılır)");
    if (!reason || reason.trim().length < 3) return;
    setBusy(name);
    try {
      await api(`/jobs/${encodeURIComponent(name)}/run`, { method: "POST", body: { reason: reason.trim() } });
      toast("success", "Kuyruğa alındı.");
      setTimeout(onRan, 3000);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Çalıştırılamadı.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Zamanlama">
      {late.length > 0 && (
        <p className="mb-3 rounded-xl border border-danger/40 bg-danger-soft px-4 py-2 text-sm text-danger">
          Gecikmiş iş: {late.map((x) => JOB_LABELS[x.name]?.label ?? x.name).join(", ")}. İşçi durmuş ya da takılmış olabilir; kurucuya uyarı gider.
        </p>
      )}
      {schedules.length === 0 ? (
        <EmptyState title="Zamanlama bilgisi yok" description="İşçi kapalıysa (WORKER_ENABLED) burada iş görünmez." />
      ) : (
        <Table head={<tr><th className={th}>İş</th><th className={th}>Sonraki çalışma</th><th className={th}>Son çalışma</th><th className={th} /></tr>}>
          {schedules.map((x) => (
            <tr key={x.name}>
              <td className={td}>
                <span className="text-fg">{JOB_LABELS[x.name]?.label ?? x.name}</span>
                <span className="block text-xs text-muted-foreground">{JOB_LABELS[x.name]?.schedule ?? (x.every ? `${Math.round(x.every / 1000)} sn'de bir` : x.pattern)}</span>
              </td>
              <td className={`${td} whitespace-nowrap text-xs`}>
                {x.next ? fmtDateTime(x.next) : "—"}
                {x.late && <Badge tone="danger" icon={<Clock className="h-3 w-3" />}>Gecikti</Badge>}
              </td>
              <td className={`${td} whitespace-nowrap text-xs text-muted-foreground`}>
                {x.lastRun ? <>{fmtDateTime(x.lastRun.startedAt)} · <StatusBadge status={x.lastRun.status as JobRun["status"]} /></> : "Kayıt yok"}
              </td>
              <td className={`${td} text-right`}>
                {canRun && x.runnable && (
                  <Button size="sm" variant="ghost" loading={busy === x.name} onClick={() => void run(x.name)}>
                    <Play className="h-3.5 w-3.5" aria-hidden /> Şimdi çalıştır
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">Her dakikalık işlerin çoğu yalnız bir şey yaptığında “Son çalışmalar” listesine yazılır.</p>
    </Card>
  );
}

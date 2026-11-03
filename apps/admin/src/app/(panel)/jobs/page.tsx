"use client";

import { CheckCircle2, Loader2, RotateCw, XCircle } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, Table, td, th } from "@/components/common";
import { StatTile } from "@/components/charts";
import { useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { JobRun, JobsOverview } from "@/lib/types";

const JOB_LABELS: Record<string, { label: string; schedule: string }> = {
  "reconcile-designs": { label: "Takılan tasarımları toparla", schedule: "Her dakika" },
  retention: { label: "Saklama süresi temizliği (KVKK)", schedule: "Her gün 03:30" },
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

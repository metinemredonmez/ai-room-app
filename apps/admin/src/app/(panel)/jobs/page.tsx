"use client";

import { AlertTriangle, CheckCircle2, Clock, Hourglass, Loader2, Play, RotateCw, Timer, Workflow, XCircle } from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorState, PageHeader, Spinner } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { ReasonDialog } from "@/components/reason-dialog";
import { Section } from "@/components/section";
import { badgeTone, StatCard } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { atLeast, type AdminMe, type JobRun, type JobSchedule, type JobsOverview } from "@/lib/types";

// Zamanlı işler (API.md §7.42): tasarım kuyruğu, her zamanlayıcının sonraki ve son çalışması, son çalışmaların
// sonucu. Listelenen işler (tekrarı zararsız olanlar) ADMIN tarafından gerekçeyle şimdi çalıştırılabilir.

const JOB_LABELS: Record<string, { label: string; schedule: string }> = {
  "reconcile-designs": { label: "Takılan tasarımları toparla", schedule: "Her dakika" },
  "broadcasts-due": { label: "Zamanı gelen toplu gönderimler", schedule: "Her dakika" },
  "price-schedules": { label: "Planlı fiyat değişiklikleri", schedule: "Her dakika" },
  lifecycle: { label: "Yaşam döngüsü e-postaları", schedule: "Her saat :20" },
  retention: { label: "Saklama süresi temizliği (KVKK)", schedule: "Her gün 03:30" },
  loyalty: { label: "Sadakat: yıldönümü ve geri dönüş", schedule: "Her gün 11:00" },
  "kvkk-deadlines": { label: "KVKK başvuru süreleri özeti", schedule: "Her gün 09:00" },
  "weekly-report": { label: "Haftalık rapor e-postası", schedule: "Pazartesi 09:00" },
};
const label = (name: string) => JOB_LABELS[name]?.label ?? name;

function duration(run: JobRun): string {
  if (!run.finishedAt) return "—";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} sn`;
}

function details(run: JobRun): string {
  const entries = Object.entries(run.details ?? {});
  if (!entries.length) return "—";
  return entries
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
    .slice(0, 240);
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ok")
    return (
      <Badge className={badgeTone.good}>
        <CheckCircle2 aria-hidden /> Başarılı
      </Badge>
    );
  if (status === "error")
    return (
      <Badge className={badgeTone.danger}>
        <XCircle aria-hidden /> Hata
      </Badge>
    );
  return (
    <Badge className={badgeTone.warn}>
      <Loader2 className="animate-spin" aria-hidden /> Çalışıyor
    </Badge>
  );
}

export default function JobsPage() {
  const res = useApi<JobsOverview>("/jobs", { limit: 100 });
  const [onlyErrors, setOnlyErrors] = useState(false);
  const s = res.data;
  const lastError = s?.items.find((r) => r.status === "error");
  const runs = s ? (onlyErrors ? s.items.filter((r) => r.status === "error") : s.items) : [];

  return (
    <>
      <PageHeader
        title="Zamanlı işler"
        description="Tasarım kuyruğu ve bakım işlerinin son çalışmaları; sessiz arızaları görmek için."
        actions={
          <Button variant="outline" onClick={res.reload} disabled={res.loading && Boolean(s)}>
            {res.loading && s ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />} Yenile
          </Button>
        }
      />
      {res.error && !s ? (
        <ErrorState message={res.error.message} onRetry={res.reload} />
      ) : !s ? (
        <Spinner />
      ) : (
        <div className={`flex flex-col gap-5 ${res.loading ? "opacity-60 transition-opacity" : ""}`}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Hourglass} label="Kuyrukta bekleyen" value={fmtInt(s.queue.waiting)} note="Tasarım işi" />
            <StatCard icon={Workflow} label="İşleniyor" value={fmtInt(s.queue.active)} tone="good" note="Şu an AI servisinde" />
            <StatCard icon={Timer} label="Yeniden denenecek" value={fmtInt(s.queue.delayed)} tone={s.queue.delayed ? "warn" : "neutral"} note="Geçici AI hatası" />
            <StatCard icon={XCircle} label="Başarısız" value={fmtInt(s.queue.failed)} tone={s.queue.failed ? "danger" : "neutral"} note="Son kayıtlar · kredisi iade edildi" />
          </div>

          {lastError && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                <span className="font-medium">Son hata: {label(lastError.name)}</span> · {fmtDateTime(lastError.startedAt)} · {details(lastError)}
              </span>
            </div>
          )}

          <Schedules schedules={s.schedules ?? []} onRan={res.reload} />

          <Section
            title="Son çalışmalar"
            description="Her dakikalık işlerin çoğu yalnız bir şey yaptığında buraya yazılır."
            flush
            action={
              <ToggleGroup type="single" variant="outline" size="sm" value={onlyErrors ? "errors" : "all"} onValueChange={(v) => v && setOnlyErrors(v === "errors")} aria-label="Süzgeç">
                <ToggleGroupItem value="all" className="px-3">
                  Tümü
                </ToggleGroupItem>
                <ToggleGroupItem value="errors" className="px-3">
                  Hatalı
                </ToggleGroupItem>
              </ToggleGroup>
            }
          >
            {runs.length === 0 ? (
              <EmptyState title={onlyErrors ? "Hatalı çalışma yok" : "Henüz çalışma yok"} description={onlyErrors ? undefined : "İşler ilk dakika içinde çalışmaya başlar."} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">İş</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>Başlangıç</TableHead>
                    <TableHead>Süre</TableHead>
                    <TableHead className="pr-6">Sonuç</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-6">
                        <span className="block">{label(r.name)}</span>
                        <span className="block text-xs text-muted-foreground">{JOB_LABELS[r.name]?.schedule ?? r.name}</span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.startedAt)}</TableCell>
                      <TableCell className="tabular">{duration(r)}</TableCell>
                      <TableCell className="max-w-md pr-6 font-mono text-[11px] whitespace-normal break-all text-muted-foreground">{details(r)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </div>
      )}
    </>
  );
}

/** API.md §7.42: every scheduler with its next run, its last result and a late flag; listed jobs run from here. */
function Schedules({ schedules, onRan }: { schedules: JobSchedule[]; onRan: () => void }) {
  const me = useApi<AdminMe>("/me");
  const canRun = atLeast(me.data?.role, "ADMIN");
  const { toast } = useFeedback();
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const late = schedules.filter((x) => x.late);

  async function run(name: string, reason: string) {
    setBusy(true);
    try {
      await api(`/jobs/${encodeURIComponent(name)}/run`, { method: "POST", body: { reason } });
      toast("success", "Kuyruğa alındı; sonuç birkaç saniye içinde aşağıda görünür.");
      setAsking(null);
      setTimeout(onRan, 3000);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Çalıştırılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Zamanlama" description="Her zamanlayıcının sonraki ve son çalışması" flush>
      {late.length > 0 && (
        <p role="alert" className="mx-6 my-4 rounded-xl border border-danger/40 bg-danger-soft px-4 py-2 text-sm text-danger">
          Gecikmiş iş: {late.map((x) => label(x.name)).join(", ")}. İşçi durmuş ya da takılmış olabilir; kurucuya uyarı gider.
        </p>
      )}
      {schedules.length === 0 ? (
        <EmptyState title="Zamanlama bilgisi yok" description="İşçi kapalıysa (WORKER_ENABLED) burada iş görünmez." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">İş</TableHead>
              <TableHead>Sonraki çalışma</TableHead>
              <TableHead>Son çalışma</TableHead>
              <TableHead className="pr-6" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules.map((x) => (
              <TableRow key={x.name}>
                <TableCell className="pl-6">
                  <span className="block">{label(x.name)}</span>
                  <span className="block text-xs text-muted-foreground">{JOB_LABELS[x.name]?.schedule ?? (x.every ? `${Math.round(x.every / 1000)} sn'de bir` : x.pattern)}</span>
                </TableCell>
                <TableCell className="text-xs">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {x.next ? fmtDateTime(x.next) : "—"}
                    {x.late && (
                      <Badge className={badgeTone.danger}>
                        <Clock aria-hidden /> Gecikti
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {x.lastRun ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {fmtDateTime(x.lastRun.startedAt)} <StatusBadge status={x.lastRun.status} />
                    </span>
                  ) : (
                    "Kayıt yok"
                  )}
                </TableCell>
                <TableCell className="pr-6 text-right">
                  {canRun && x.runnable && (
                    <Button size="sm" variant="outline" onClick={() => setAsking(x.name)}>
                      <Play aria-hidden /> Şimdi çalıştır
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {asking && (
        <ReasonDialog
          title={`“${label(asking)}” şimdi çalışsın mı?`}
          description="İş kuyruğa alınır ve birkaç saniye içinde çalışır; tekrarı zararsızdır."
          confirmLabel="Çalıştır"
          busy={busy}
          onConfirm={(r) => void run(asking, r)}
          onClose={() => setAsking(null)}
        />
      )}
    </Section>
  );
}

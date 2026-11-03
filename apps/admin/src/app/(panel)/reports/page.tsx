"use client";

import { ArrowRight, Flag } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, LoadMore, PageHeader, Spinner, Textarea, Thumb } from "@/components/common";
import { api, ApiError, usePaged } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { ContentReport, ReportStatus } from "@/lib/types";

const REASONS: Record<ContentReport["reason"], string> = {
  inappropriate: "Uygunsuz",
  offensive: "Saldırgan",
  copyright: "Telif",
  privacy: "Gizlilik",
  other: "Diğer",
};
const STATUS: Record<ReportStatus, { label: string; tone: "warn" | "good" | "neutral" }> = {
  OPEN: { label: "Açık", tone: "warn" },
  RESOLVED: { label: "Çözüldü", tone: "good" },
  DISMISSED: { label: "Reddedildi", tone: "neutral" },
};

function ReportRow({ report, onDone }: { report: ContentReport; onDone: (id: string) => void }) {
  const { toast, confirm } = useFeedback();
  const [resolution, setResolution] = useState("");
  const [unfeature, setUnfeature] = useState(report.design.featured);
  const [deleteDesign, setDeleteDesign] = useState(false);
  const [busy, setBusy] = useState<"RESOLVED" | "DISMISSED" | null>(null);
  const d = report.design;

  async function submit(status: "RESOLVED" | "DISMISSED") {
    if (resolution.trim().length < 3) {
      toast("error", "Karar notu en az 3 karakter olmalı.");
      return;
    }
    if (deleteDesign && status === "RESOLVED") {
      const ok = await confirm({ title: "Tasarım silinsin mi?", description: "Tasarım ve tüm sonuç görselleri kalıcı olarak silinir.", confirmLabel: "Sil", destructive: true });
      if (!ok) return;
    }
    setBusy(status);
    try {
      await api(`/reports/${report.id}`, {
        method: "PATCH",
        body: { status, resolution: resolution.trim(), unfeature: status === "RESOLVED" && unfeature, deleteDesign: status === "RESOLVED" && deleteDesign },
      });
      toast("success", status === "RESOLVED" ? "Bildirim çözüldü." : "Bildirim reddedildi.");
      onDone(report.id);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="grid gap-4 border-b border-line py-4 last:border-b-0 lg:grid-cols-[260px_1fr]">
      <div className="flex items-center gap-2">
        <Thumb src={d.input.url} alt="Önce" className="h-20 w-24" />
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Thumb src={d.results[0]?.url} alt="Sonra" className="h-20 w-24" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="danger" icon={<Flag className="h-3.5 w-3.5" />}>{REASONS[report.reason]}</Badge>
          <Badge tone={STATUS[report.status].tone}>{STATUS[report.status].label}</Badge>
          {d.featured && <Badge tone="primary">İlham galerisinde</Badge>}
          <span className="text-xs text-muted-foreground">{fmtDateTime(report.createdAt)}</span>
        </div>
        <p className="text-sm text-fg">{d.title}</p>
        {/* User text is rendered as plain text only (WEB-01). */}
        {report.note && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg">“{report.note}”</p>}
        {report.status === "OPEN" ? (
          <div className="flex flex-col gap-2">
            <Textarea rows={2} maxLength={500} placeholder="Karar notu (denetim kaydına yazılır)" value={resolution} onChange={(e) => setResolution(e.target.value)} aria-label="Karar notu" />
            <div className="flex flex-wrap items-center gap-4 text-sm">
              {d.featured && (
                <label className="flex items-center gap-2"><input type="checkbox" checked={unfeature} onChange={(e) => setUnfeature(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" /> Galeriden kaldır</label>
              )}
              <label className="flex items-center gap-2"><input type="checkbox" checked={deleteDesign} onChange={(e) => setDeleteDesign(e.target.checked)} className="h-4 w-4 accent-[var(--danger)]" /> Tasarımı sil</label>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => submit("DISMISSED")} loading={busy === "DISMISSED"} disabled={busy !== null}>Reddet</Button>
                <Button variant={deleteDesign ? "danger" : "primary"} onClick={() => submit("RESOLVED")} loading={busy === "RESOLVED"} disabled={busy !== null}>Çöz</Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Karar: {report.resolution ?? "—"} · {fmtDateTime(report.resolvedAt)}</p>
        )}
      </div>
    </li>
  );
}

export default function ReportsPage() {
  const [status, setStatus] = useState<ReportStatus>("OPEN");
  const list = usePaged<ContentReport>("/reports", { status });
  return (
    <>
      <PageHeader
        title="İçerik bildirimleri"
        description="Kullanıcıların bildirdiği yapay zekâ çıktıları (Google Play üretken AI politikası)"
        actions={
          <div className="flex gap-1">
            {(Object.keys(STATUS) as ReportStatus[]).map((s) => (
              <Button key={s} size="sm" variant={s === status ? "primary" : "secondary"} onClick={() => setStatus(s)} aria-pressed={s === status}>
                {STATUS[s].label}
              </Button>
            ))}
          </div>
        }
      />
      <Card>
        {list.error && list.items.length === 0 ? (
          <ErrorState message={list.error.message} onRetry={list.reload} />
        ) : list.loading && list.items.length === 0 ? (
          <Spinner />
        ) : list.items.length === 0 ? (
          <EmptyState title="Bildirim yok" description={status === "OPEN" ? "Bekleyen bildirim yok." : "Bu durumda kayıt yok."} />
        ) : (
          <>
            <ul>
              {list.items.map((r) => (
                <ReportRow key={r.id} report={r} onDone={(id) => list.setItems((items) => items.filter((x) => x.id !== id))} />
              ))}
            </ul>
            <LoadMore hasMore={Boolean(list.nextCursor)} loading={list.loadingMore} onClick={list.loadMore} />
          </>
        )}
      </Card>
    </>
  );
}

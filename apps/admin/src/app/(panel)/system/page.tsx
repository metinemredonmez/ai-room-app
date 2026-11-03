"use client";

import { CheckCircle2, RotateCw, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Button, ErrorState, PageHeader, Spinner } from "@/components/common";
import { useApi } from "@/lib/api";
import type { SystemStatus } from "@/lib/types";

function Health({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-good">
      <CheckCircle2 className="h-4 w-4" aria-hidden /> Çalışıyor
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-danger">
      <XCircle className="h-4 w-4" aria-hidden /> Erişilemiyor
    </span>
  );
}

function Tile({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-fg">{title}</h2>
      <div className="flex flex-col gap-2 text-sm">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-fg">{value}</span>
    </div>
  );
}

export default function SystemPage() {
  const sys = useApi<SystemStatus>("/system");
  const s = sys.data;
  return (
    <>
      <PageHeader
        title="Sistem"
        description="Servislerin anlık durumu"
        actions={
          <Button onClick={sys.reload} loading={sys.loading && Boolean(s)}>
            <RotateCw className="h-4 w-4" aria-hidden /> Yenile
          </Button>
        }
      />
      {sys.error && !s ? (
        <ErrorState message={sys.error.message} onRetry={sys.reload} />
      ) : !s ? (
        <Spinner />
      ) : (
        <div className={`grid gap-4 md:grid-cols-2 xl:grid-cols-4 ${sys.loading ? "opacity-60" : ""}`}>
          <Tile title="AI servisi">
            <Row label="Durum" value={<Health ok={s.ai.status === "ok"} />} />
            <Row label="Görsel sağlayıcı" value={<span className="font-mono text-xs">{s.ai.provider || "—"}</span>} />
            <Row label="AI sohbet (Claude)" value={s.ai.chatEnabled ? "Açık" : "Demo modu"} />
            <Row label="Gecikme" value={<span className="tabular">{s.ai.latencyMs === null ? "—" : `${Math.round(s.ai.latencyMs)} ms`}</span>} />
          </Tile>
          <Tile title="Veritabanı (PostgreSQL)">
            <Row label="Durum" value={<Health ok={s.db === "ok"} />} />
          </Tile>
          <Tile title="Önbellek (Redis)">
            <Row label="Durum" value={<Health ok={s.redis === "ok"} />} />
          </Tile>
          <Tile title="Backend">
            <Row label="Sürüm" value={<span className="font-mono text-xs">{s.version}</span>} />
          </Tile>
        </div>
      )}
    </>
  );
}

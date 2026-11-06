"use client";

import { Bot, CheckCircle2, Database, Loader2, MemoryStick, RotateCw, Server, XCircle, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { ErrorState, PageHeader, Spinner } from "@/components/common";
import { badgeTone } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApi } from "@/lib/api";
import type { SystemStatus } from "@/lib/types";

// Sistem: servislerin anlık durumu; sayfa açıkken 30 saniyede bir yenilenir.

const REFRESH_MS = 30_000;

function Health({ ok }: { ok: boolean }) {
  return ok ? (
    <Badge className={badgeTone.good}>
      <CheckCircle2 aria-hidden /> Çalışıyor
    </Badge>
  ) : (
    <Badge className={badgeTone.danger}>
      <XCircle aria-hidden /> Erişilemiyor
    </Badge>
  );
}

function Service({ icon: Icon, title, description, ok, children }: { icon: LucideIcon; title: string; description: string; ok: boolean | null; children?: ReactNode }) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${ok === false ? badgeTone.danger : badgeTone.primary}`}>
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
        </div>
        {ok !== null && (
          <CardAction>
            <Health ok={ok} />
          </CardAction>
        )}
      </CardHeader>
      {children && <CardContent className="grid gap-2 text-sm">{children}</CardContent>}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t pt-2 first:border-t-0 first:pt-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

export default function SystemPage() {
  const sys = useApi<SystemStatus>("/system");
  const s = sys.data;
  const { reload } = sys;
  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  const down = s ? [s.ai.status !== "ok" && "AI servisi", s.db !== "ok" && "Veritabanı", s.redis !== "ok" && "Önbellek"].filter(Boolean) : [];

  return (
    <>
      <PageHeader
        title="Sistem"
        description="Servislerin anlık durumu; sayfa açıkken 30 saniyede bir yenilenir. Zamanlanmış işler ve kuyruk için Zamanlı işler."
        actions={
          <Button variant="outline" onClick={reload} disabled={sys.loading && Boolean(s)}>
            {sys.loading && s ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />} Yenile
          </Button>
        }
      />
      {sys.error && !s ? (
        <ErrorState message={sys.error.message} onRetry={reload} />
      ) : !s ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-5">
          <div
            role="status"
            className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm ${down.length ? "border-danger/40 bg-danger-soft text-danger" : "border-good/30 bg-good-soft text-good"}`}
          >
            {down.length ? <XCircle className="size-5 shrink-0" aria-hidden /> : <CheckCircle2 className="size-5 shrink-0" aria-hidden />}
            <span className="font-medium">{down.length ? `Erişilemeyen: ${down.join(", ")}` : "Bütün servisler çalışıyor"}</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Service icon={Bot} title="AI servisi" description="Görsel üretim ve tasarım sohbeti" ok={s.ai.status === "ok"}>
              <Row label="Görsel sağlayıcı" value={<span className="font-mono text-xs">{s.ai.provider || "—"}</span>} />
              <Row label="AI sohbet (Claude)" value={s.ai.chatEnabled ? "Açık" : "Demo modu"} />
              <Row label="Gecikme" value={<span className="tabular">{s.ai.latencyMs === null ? "—" : `${Math.round(s.ai.latencyMs)} ms`}</span>} />
              <Row
                label="Model seçimi"
                value={
                  <Link href="/ai-engine" className="text-primary hover:underline">
                    AI motoru
                  </Link>
                }
              />
            </Service>
            <Service icon={Database} title="Veritabanı" description="PostgreSQL: hesaplar, tasarımlar, ayarlar" ok={s.db === "ok"} />
            <Service icon={MemoryStick} title="Önbellek ve kuyruk" description="Redis: hız sınırları ve iş kuyruğu" ok={s.redis === "ok"}>
              <Row
                label="Kuyruk"
                value={
                  <Link href="/jobs" className="text-primary hover:underline">
                    Zamanlı işler
                  </Link>
                }
              />
            </Service>
            <Service icon={Server} title="Backend" description="API sunucusu" ok={null}>
              <Row label="Sürüm" value={<span className="font-mono text-xs">{s.version}</span>} />
            </Service>
          </div>
        </div>
      )}
    </>
  );
}

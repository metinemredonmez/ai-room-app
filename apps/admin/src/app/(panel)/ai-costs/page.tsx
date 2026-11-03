"use client";

import { AlertTriangle, CheckCircle2, OctagonAlert } from "lucide-react";
import { useState } from "react";
import { DailyLineChart } from "@/components/charts";
import { Badge, Button, Card, ErrorState, PageHeader, Spinner, Table, td, th } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import type { AiUsageStats, BrakeMode, BudgetState } from "@/lib/types";

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: v < 1 ? 3 : 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`;
const usdAxis = (v: number) => `$${Number(v.toPrecision(3))}`;

const KIND_LABELS: Record<string, string> = { generate: "Görsel üretim", analyze: "Alışveriş/bütçe analizi", chat: "Tasarım sohbeti", describe: "Referans stil" };
const BRAKE_LABELS: Record<BrakeMode, string> = { off: "Fren kapalı", free_single_variant: "Ücretsize tek varyant", free_paused: "Ücretsiz üretim durur" };

function BudgetBadge({ state }: { state: BudgetState }) {
  if (state === "exceeded") return <Badge tone="danger" icon={<OctagonAlert className="h-3.5 w-3.5" />}>Bütçe aşıldı</Badge>;
  if (state === "warning") return <Badge tone="warn" icon={<AlertTriangle className="h-3.5 w-3.5" />}>%80 üzeri</Badge>;
  return <Badge tone="good" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>Normal</Badge>;
}

export default function AiCostsPage() {
  const [days, setDays] = useState(30);
  const res = useApi<AiUsageStats>("/ai/usage", { days });
  const s = res.data;
  const budget = s?.budget;
  const pct = budget && budget.dailyBudgetUsd > 0 ? Math.min(100, (budget.spentTodayUsd / budget.dailyBudgetUsd) * 100) : null;

  return (
    <>
      <PageHeader
        title="AI maliyeti"
        description="Her AI çağrısının sağlayıcı, model ve tahmini USD maliyeti (AI servisi raporlar, backend kaydeder)"
        actions={
          <div className="flex gap-1">
            {[7, 30, 90].map((d) => (
              <Button key={d} size="sm" variant={d === days ? "primary" : "secondary"} onClick={() => setDays(d)} aria-pressed={d === days}>
                Son {d} gün
              </Button>
            ))}
          </div>
        }
      />
      {res.error && !s ? (
        <ErrorState message={res.error.message} onRetry={res.reload} />
      ) : !s || !budget ? (
        <Spinner />
      ) : (
        <div className={`flex flex-col gap-4 ${res.loading ? "opacity-60" : ""}`}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-line bg-surface px-4 py-3">
              <p className="text-xs text-muted">Bugünkü harcama</p>
              <p className="mt-1 text-2xl font-semibold text-fg tabular">{usd(s.today.costUsd)}</p>
              <p className="mt-0.5 text-xs text-muted">{fmtInt(s.today.calls)} çağrı · {fmtInt(s.today.images)} görsel</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface px-4 py-3 xl:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted">Günlük bütçe</p>
                <BudgetBadge state={budget.state} />
              </div>
              <p className="mt-1 text-2xl font-semibold text-fg tabular">
                {budget.dailyBudgetUsd > 0 ? `${usd(budget.spentTodayUsd)} / ${usd(budget.dailyBudgetUsd)}` : "Sınırsız"}
              </p>
              {pct !== null && (
                <div className="mt-2 h-2 w-full rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Bütçe kullanımı">
                  <div
                    className={`h-2 rounded-full ${budget.state === "exceeded" ? "bg-danger" : budget.state === "warning" ? "bg-warn" : "bg-primary"}`}
                    style={{ width: `${Math.max(2, pct)}%` }}
                  />
                </div>
              )}
              <p className="mt-1 text-xs text-muted">Aşılınca: {BRAKE_LABELS[budget.brakeMode]} · Ayarlardan değiştirilir</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface px-4 py-3">
              <p className="text-xs text-muted">Dönem toplamı</p>
              <p className="mt-1 text-2xl font-semibold text-fg tabular">{usd(s.daily.reduce((t, d) => t + d.costUsd, 0))}</p>
              <p className="mt-0.5 text-xs text-muted">{fmtInt(s.daily.reduce((t, d) => t + d.calls, 0))} çağrı · son {days} gün</p>
            </div>
          </div>

          <DailyLineChart
            title="Günlük AI maliyeti"
            subtitle="USD, İstanbul saatine göre gün"
            ariaLabel="Günlük AI maliyeti çizgi grafiği"
            valueLabel="USD"
            columnLabel="Maliyet"
            data={s.daily.map((d) => ({ date: d.date, value: d.costUsd }))}
            format={usd}
            axisFormat={usdAxis}
            minStep={0.001}
          />

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Sağlayıcı ve modele göre">
              {s.byProvider.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">Bu aralıkta çağrı yok.</p>
              ) : (
                <Table head={<tr><th className={th}>Sağlayıcı</th><th className={th}>Model</th><th className={`${th} text-right`}>Çağrı</th><th className={`${th} text-right`}>Maliyet</th></tr>}>
                  {s.byProvider.map((p) => (
                    <tr key={`${p.provider}-${p.model}`}>
                      <td className={td}>{p.provider}</td>
                      <td className={`${td} font-mono text-xs`}>{p.model}</td>
                      <td className={`${td} text-right tabular`}>{fmtInt(p.calls)}</td>
                      <td className={`${td} text-right tabular`}>{usd(p.costUsd)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card title="İşe göre">
              {s.byKind.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">Bu aralıkta çağrı yok.</p>
              ) : (
                <Table head={<tr><th className={th}>İş</th><th className={`${th} text-right`}>Çağrı</th><th className={`${th} text-right`}>Maliyet</th><th className={`${th} text-right`}>Çağrı başı</th></tr>}>
                  {s.byKind.map((k) => (
                    <tr key={k.kind}>
                      <td className={td}>{KIND_LABELS[k.kind] ?? k.kind}</td>
                      <td className={`${td} text-right tabular`}>{fmtInt(k.calls)}</td>
                      <td className={`${td} text-right tabular`}>{usd(k.costUsd)}</td>
                      <td className={`${td} text-right tabular`}>{k.calls ? usd(k.costUsd / k.calls) : "—"}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>
          <p className="text-xs text-muted">
            Maliyetler tahminidir: görsel başı fiyatlar ve Claude token fiyatları AI servisinin ortam değişkenlerinden okunur (mock ve demo yanıtları $0).
          </p>
        </div>
      )}
    </>
  );
}

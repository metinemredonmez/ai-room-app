"use client";

import { AlertTriangle, CheckCircle2, CircleDollarSign, Images, OctagonAlert, Sigma, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DailyLineChart } from "@/components/charts";
import { ErrorState, PageHeader, Spinner } from "@/components/common";
import { Section } from "@/components/section";
import { badgeTone, StatCard } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useApi } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import type { AiUsageStats, BrakeMode, BudgetState } from "@/lib/types";

// AI maliyeti: her AI çağrısının sağlayıcı, model ve tahmini USD maliyeti (AI servisi raporlar, backend kaydeder).

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: v < 1 ? 3 : 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`;
const usdAxis = (v: number) => `$${Number(v.toPrecision(3))}`;

const KIND_LABELS: Record<string, string> = { generate: "Görsel üretim", analyze: "Alışveriş/bütçe analizi", chat: "Tasarım sohbeti", describe: "Referans stil" };
const BRAKE_LABELS: Record<BrakeMode, string> = { off: "Fren kapalı", free_single_variant: "Ücretsize tek varyant", free_paused: "Ücretsiz üretim durur" };
const RANGES = ["7", "30", "90"] as const;

function BudgetBadge({ state }: { state: BudgetState }) {
  if (state === "exceeded")
    return (
      <Badge className={badgeTone.danger}>
        <OctagonAlert aria-hidden /> Bütçe aşıldı
      </Badge>
    );
  if (state === "warning")
    return (
      <Badge className={badgeTone.warn}>
        <AlertTriangle aria-hidden /> %80 üzeri
      </Badge>
    );
  return (
    <Badge className={badgeTone.good}>
      <CheckCircle2 aria-hidden /> Normal
    </Badge>
  );
}

function Empty() {
  return <p className="px-6 py-8 text-center text-sm text-muted-foreground">Bu aralıkta çağrı yok.</p>;
}

export default function AiCostsPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>("30");
  const res = useApi<AiUsageStats>("/ai/usage", { days });
  const s = res.data;
  const budget = s?.budget;
  const pct = budget && budget.dailyBudgetUsd > 0 ? Math.min(100, (budget.spentTodayUsd / budget.dailyBudgetUsd) * 100) : null;
  const periodCost = s ? s.daily.reduce((t, d) => t + d.costUsd, 0) : 0;
  const periodCalls = s ? s.daily.reduce((t, d) => t + d.calls, 0) : 0;

  return (
    <>
      <PageHeader
        title="AI maliyeti"
        description="Her AI çağrısının sağlayıcı, model ve tahmini USD maliyeti. Günlük bütçe ve fren Ayarlar’dan değiştirilir."
        actions={
          <ToggleGroup type="single" variant="outline" size="sm" value={days} onValueChange={(v) => v && setDays(v as typeof days)} aria-label="Dönem">
            {RANGES.map((d) => (
              <ToggleGroupItem key={d} value={d} className="px-3">
                Son {d} gün
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />
      {res.error && !s ? (
        <ErrorState message={res.error.message} onRetry={res.reload} />
      ) : !s || !budget ? (
        <Spinner />
      ) : (
        <div className={`flex flex-col gap-5 ${res.loading ? "opacity-60 transition-opacity" : ""}`}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={CircleDollarSign} label="Bugünkü harcama" value={usd(s.today.costUsd)} note={`${fmtInt(s.today.calls)} çağrı · ${fmtInt(s.today.images)} görsel`} />
            <Card className="gap-3 xl:col-span-2">
              <CardHeader>
                <CardDescription>Günlük bütçe</CardDescription>
                <CardAction>
                  <BudgetBadge state={budget.state} />
                </CardAction>
                <CardTitle className="tabular text-3xl font-semibold">{budget.dailyBudgetUsd > 0 ? `${usd(budget.spentTodayUsd)} / ${usd(budget.dailyBudgetUsd)}` : "Sınırsız"}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {pct !== null && (
                  <div className="h-2 w-full rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Bütçe kullanımı">
                    <div className={`h-2 rounded-full ${budget.state === "exceeded" ? "bg-danger" : budget.state === "warning" ? "bg-warn" : "bg-primary"}`} style={{ width: `${Math.max(2, pct)}%` }} />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Aşılınca: {BRAKE_LABELS[budget.brakeMode]} ·{" "}
                  <Link href="/settings" className="text-primary hover:underline">
                    Ayarlar
                  </Link>
                </p>
              </CardContent>
            </Card>
            <StatCard icon={Sigma} label="Dönem toplamı" value={usd(periodCost)} tone="neutral" note={`${fmtInt(periodCalls)} çağrı · son ${days} gün`} />
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

          <div className="grid gap-5 xl:grid-cols-2">
            <Section title="Sağlayıcı ve modele göre" flush action={<Wallet className="size-4 text-muted-foreground" aria-hidden />}>
              {s.byProvider.length === 0 ? (
                <Empty />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Sağlayıcı</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Çağrı</TableHead>
                      <TableHead className="pr-6 text-right">Maliyet</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="tabular">
                    {s.byProvider.map((p) => (
                      <TableRow key={`${p.provider}-${p.model}`}>
                        <TableCell className="pl-6">{p.provider}</TableCell>
                        <TableCell className="font-mono text-xs">{p.model}</TableCell>
                        <TableCell className="text-right">{fmtInt(p.calls)}</TableCell>
                        <TableCell className="pr-6 text-right">{usd(p.costUsd)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
            <Section title="İşe göre" flush action={<Images className="size-4 text-muted-foreground" aria-hidden />}>
              {s.byKind.length === 0 ? (
                <Empty />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">İş</TableHead>
                      <TableHead className="text-right">Çağrı</TableHead>
                      <TableHead className="text-right">Maliyet</TableHead>
                      <TableHead className="pr-6 text-right">Çağrı başı</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="tabular">
                    {s.byKind.map((k) => (
                      <TableRow key={k.kind}>
                        <TableCell className="pl-6">{KIND_LABELS[k.kind] ?? k.kind}</TableCell>
                        <TableCell className="text-right">{fmtInt(k.calls)}</TableCell>
                        <TableCell className="text-right">{usd(k.costUsd)}</TableCell>
                        <TableCell className="pr-6 text-right">{k.calls ? usd(k.costUsd / k.calls) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
          </div>
          <p className="text-xs text-muted-foreground">
            Maliyetler tahminidir: görsel başı fiyatlar ve Claude token fiyatları AI servisinin ortam değişkenlerinden okunur (mock ve demo yanıtları $0).
          </p>
        </div>
      )}
    </>
  );
}

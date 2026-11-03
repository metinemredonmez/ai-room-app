"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { BarList, DailyDesignsChart, NewUsersChart, StatTile } from "@/components/charts";
import { ErrorState, PageHeader, Spinner } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtInt, toolLabel } from "@/lib/format";
import type { AdminStats, AdminStyle } from "@/lib/types";

const RANGES = [
  { days: 7, label: "Son 7 gün" },
  { days: 30, label: "Son 30 gün" },
  { days: 90, label: "Son 90 gün" },
] as const;

export default function DashboardPage() {
  const [days, setDays] = useState<number>(30);
  const stats = useApi<AdminStats>("/stats", { days });
  const styles = useApi<AdminStyle[]>("/styles");
  const styleName = (id: string) => styles.data?.find((s) => s.id === id)?.nameTr ?? id;
  const t = stats.data?.totals;

  return (
    <>
      <PageHeader title="Gösterge paneli" description="Kullanım, üretim ve kullanıcı özetleri" />

      <div className="mb-5 flex flex-wrap gap-1.5" role="group" aria-label="Tarih aralığı">
        {RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            onClick={() => setDays(r.days)}
            aria-pressed={days === r.days}
            className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm ${
              days === r.days ? "border-primary bg-primary-soft font-semibold text-primary" : "border-line bg-surface text-fg hover:bg-surface-2"
            }`}
          >
            {days === r.days && <Check className="h-4 w-4" strokeWidth={3} aria-hidden />}
            {r.label}
          </button>
        ))}
      </div>

      {stats.error && !stats.data ? (
        <ErrorState message={stats.error.message} onRetry={stats.reload} />
      ) : !stats.data ? (
        <Spinner />
      ) : (
        <div className={`flex flex-col gap-5 transition-opacity ${stats.loading ? "opacity-60" : ""}`}>
          {t && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <StatTile label="Toplam kullanıcı" value={t.users} note={`${fmtInt(t.registered)} kayıtlı · ${fmtInt(t.guests)} misafir`} />
              <StatTile label="PRO abone" value={t.pro} />
              <StatTile label="Toplam tasarım" value={t.designs} />
              <StatTile label="Bugünkü tasarım" value={t.designsToday} note={`${fmtInt(t.failedToday)} başarısız`} />
              <StatTile label="Bugün harcanan hak" value={t.creditsSpentToday} />
              <StatTile label="Ürün/bütçe analizi" value={t.analyses} />
            </div>
          )}
          <div className="grid gap-5 xl:grid-cols-2">
            <DailyDesignsChart data={stats.data.daily} />
            <NewUsersChart data={stats.data.daily} />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <BarList
              title="Araçlara göre tasarımlar"
              subtitle={`Son ${days} gün`}
              rows={stats.data.byTool.map((r) => ({ key: r.tool, label: toolLabel(r.tool), value: r.count }))}
            />
            <BarList
              title="Stillere göre tasarımlar"
              subtitle={`Son ${days} gün`}
              rows={stats.data.byStyle.map((r) => ({ key: r.styleId, label: styleName(r.styleId), value: r.count }))}
            />
          </div>
        </div>
      )}
    </>
  );
}

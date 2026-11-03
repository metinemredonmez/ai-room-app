"use client";

import { RotateCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, LoadMore, PageHeader, Spinner, Table, td, th } from "@/components/common";
import { api, ApiError, usePaged } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { BillingEvent, BillingEventStatus } from "@/lib/types";

const STATUS: Record<BillingEventStatus | "all", { label: string; tone: "good" | "warn" | "danger" | "neutral" | "primary" }> = {
  all: { label: "Tümü", tone: "neutral" },
  unmatched: { label: "Eşleşmeyen", tone: "warn" },
  failed: { label: "Başarısız", tone: "danger" },
  queued: { label: "Kuyrukta", tone: "primary" },
  processed: { label: "İşlendi", tone: "good" },
  ignored: { label: "Yok sayıldı", tone: "neutral" },
};

export default function BillingEventsPage() {
  const { toast } = useFeedback();
  const [status, setStatus] = useState<BillingEventStatus | "all">("all");
  const list = usePaged<BillingEvent>("/billing/events", { status: status === "all" ? undefined : status });
  const [retrying, setRetrying] = useState<string | null>(null);

  async function retry(id: string) {
    setRetrying(id);
    try {
      const r = await api<{ status: BillingEventStatus }>(`/billing/events/${encodeURIComponent(id)}/retry`, { method: "POST" });
      toast(r.status === "processed" ? "success" : "error", `Yeniden işlendi: ${STATUS[r.status]?.label ?? r.status}`);
      list.reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlenemedi.");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Ödeme olayları"
        description="RevenueCat webhook kutusu — imzası doğrulanmış her olay bir kez kaydedilir ve kuyrukta işlenir"
        actions={
          <div className="flex flex-wrap gap-1">
            {(Object.keys(STATUS) as (BillingEventStatus | "all")[]).map((s) => (
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
          <EmptyState title="Olay yok" description="Mağaza satın alımları ve yenilemeler burada görünür." />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th className={th}>Alındı</th>
                  <th className={th}>Olay</th>
                  <th className={th}>Durum</th>
                  <th className={th}>Kullanıcı</th>
                  <th className={th}>Ürün / mağaza</th>
                  <th className={th} />
                </tr>
              }
            >
              {list.items.map((e) => (
                <tr key={e.id}>
                  <td className={`${td} whitespace-nowrap text-muted-foreground`}>{fmtDateTime(e.receivedAt)}</td>
                  <td className={`${td} font-mono text-xs`}>{e.type}</td>
                  <td className={td}>
                    <Badge tone={STATUS[e.status]?.tone ?? "neutral"}>{STATUS[e.status]?.label ?? e.status}</Badge>
                    {e.error && <span className="mt-1 block max-w-xs break-all text-[11px] text-danger">{e.error}</span>}
                  </td>
                  <td className={td}>
                    {e.userId ? (
                      <Link href={`/users/${e.userId}`} className="font-mono text-xs text-primary hover:underline">{e.userId.slice(0, 8)}…</Link>
                    ) : (
                      <span className="font-mono text-[11px] text-muted-foreground">{e.appUserId ?? "—"}</span>
                    )}
                  </td>
                  <td className={`${td} text-xs`}>
                    <span className="font-mono">{e.productId ?? "—"}</span>
                    <span className="block text-muted-foreground">{[e.store, e.environment].filter(Boolean).join(" · ") || "—"}</span>
                  </td>
                  <td className={`${td} text-right`}>
                    {(e.status === "unmatched" || e.status === "failed") && (
                      <Button size="sm" onClick={() => retry(e.id)} loading={retrying === e.id}>
                        <RotateCw className="h-3.5 w-3.5" aria-hidden /> Yeniden işle
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <LoadMore hasMore={Boolean(list.nextCursor)} loading={list.loadingMore} onClick={list.loadMore} />
          </>
        )}
      </Card>
    </>
  );
}

"use client";

import { AlertTriangle, CircleCheck, Hourglass, Loader2, RotateCw, Unlink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState, LoadMore, PageHeader, Spinner } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { badgeTone, StatCard } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, ApiError, useApi, usePaged } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { atLeast, type AdminMe, type BillingEvent, type BillingEventStatus } from "@/lib/types";

// Ödeme olayları: RevenueCat webhook kutusu. İmzası doğrulanan her olay bir kez kaydedilir ve kuyrukta işlenir;
// eşleşmeyen ya da başarısız olan ADMIN tarafından yeniden işlenebilir.

const STATUS: Record<BillingEventStatus, { label: string; className: string }> = {
  unmatched: { label: "Eşleşmeyen", className: badgeTone.warn },
  failed: { label: "Başarısız", className: badgeTone.danger },
  queued: { label: "Kuyrukta", className: badgeTone.primary },
  processed: { label: "İşlendi", className: badgeTone.good },
  ignored: { label: "Yok sayıldı", className: badgeTone.neutral },
};
const ORDER: (BillingEventStatus | "all")[] = ["all", "unmatched", "failed", "queued", "processed", "ignored"];
const STORES: Record<string, string> = { APP_STORE: "App Store", PLAY_STORE: "Google Play", MAC_APP_STORE: "Mac App Store", STRIPE: "Stripe", PROMOTIONAL: "Promosyon", AMAZON: "Amazon" };

export default function BillingEventsPage() {
  const { toast } = useFeedback();
  const me = useApi<AdminMe>("/me");
  const canRetry = atLeast(me.data?.role, "ADMIN");
  const [status, setStatus] = useState<BillingEventStatus | "all">("all");
  const list = usePaged<BillingEvent>("/billing/events", { status: status === "all" ? undefined : status });
  // Counts come with the first page of the unfiltered list, so the chips do not move while a filter is on.
  const totals = useApi<{ counts: Partial<Record<BillingEventStatus, number>> | null }>("/billing/events", { limit: 1 });
  const counts = totals.data?.counts ?? null;
  const total = counts ? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) : null;
  const [retrying, setRetrying] = useState<string | null>(null);

  async function retry(id: string) {
    setRetrying(id);
    try {
      const r = await api<{ status: BillingEventStatus }>(`/billing/events/${encodeURIComponent(id)}/retry`, { method: "POST" });
      toast(r.status === "processed" ? "success" : "error", `Yeniden işlendi: ${STATUS[r.status]?.label ?? r.status}`);
      list.reload();
      totals.reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlenemedi.");
    } finally {
      setRetrying(null);
    }
  }

  const n = (s: BillingEventStatus) => (counts ? fmtInt(counts[s] ?? 0) : null);

  return (
    <>
      <PageHeader title="Ödeme olayları" description="RevenueCat’ten gelen satın alma, yenileme ve iptal olayları. İmzası doğrulanan her olay bir kez kaydedilir ve kuyrukta işlenir." />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CircleCheck} label="İşlenen" value={n("processed")} tone="good" note={total !== null ? `Toplam ${fmtInt(total)} olay` : undefined} />
        <StatCard icon={Unlink} label="Eşleşmeyen" value={n("unmatched")} tone={counts?.unmatched ? "warn" : "neutral"} note="Kullanıcısı bulunamayan olay" />
        <StatCard icon={AlertTriangle} label="Başarısız" value={n("failed")} tone={counts?.failed ? "danger" : "neutral"} note="Yeniden işlenebilir" />
        <StatCard icon={Hourglass} label="Kuyrukta" value={n("queued")} tone="primary" note="Birkaç saniye içinde işlenir" />
      </div>

      <ToggleGroup type="single" variant="outline" size="sm" value={status} onValueChange={(v) => v && setStatus(v as BillingEventStatus | "all")} aria-label="Durum süzgeci" className="mb-4 flex-wrap">
        {ORDER.map((s) => (
          <ToggleGroupItem key={s} value={s} className="gap-1.5 px-3">
            {s === "all" ? "Tümü" : STATUS[s].label}
            {counts && <span className="tabular text-muted-foreground">{s === "all" ? fmtInt(total ?? 0) : fmtInt(counts[s] ?? 0)}</span>}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {list.error && list.items.length === 0 ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : list.loading && list.items.length === 0 ? (
        <Spinner />
      ) : list.items.length === 0 ? (
        <EmptyState title="Olay yok" description="Mağaza satın alımları ve yenilemeler burada görünür." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Alındı</TableHead>
                <TableHead>Olay</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Kullanıcı</TableHead>
                <TableHead>Ürün / mağaza</TableHead>
                <TableHead className="pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.items.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-6 whitespace-nowrap text-muted-foreground">{fmtDateTime(e.receivedAt)}</TableCell>
                  <TableCell className="font-mono text-xs">{e.type}</TableCell>
                  <TableCell className="whitespace-normal">
                    <Badge className={STATUS[e.status]?.className ?? badgeTone.neutral}>{STATUS[e.status]?.label ?? e.status}</Badge>
                    {e.error && <span className="mt-1 block max-w-xs text-[11px] break-all text-danger">{e.error}</span>}
                  </TableCell>
                  <TableCell>
                    {e.userId ? (
                      <Link href={`/users/${e.userId}`} className="font-mono text-xs text-primary hover:underline">
                        {e.userId.slice(0, 8)}…
                      </Link>
                    ) : (
                      <span className="font-mono text-[11px] text-muted-foreground">{e.appUserId ?? "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="font-mono">{e.productId ?? "—"}</span>
                    <span className="block text-muted-foreground">
                      {[e.store ? (STORES[e.store] ?? e.store) : null, e.environment === "SANDBOX" ? "Deneme ortamı" : e.environment].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    {canRetry && (e.status === "unmatched" || e.status === "failed") && (
                      <Button size="sm" variant="outline" onClick={() => retry(e.id)} disabled={retrying === e.id}>
                        {retrying === e.id ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />} Yeniden işle
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <LoadMore hasMore={Boolean(list.nextCursor)} loading={list.loadingMore} onClick={list.loadMore} />
    </>
  );
}

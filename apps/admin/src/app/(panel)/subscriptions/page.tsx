"use client";

import { RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadMore, PageHeader, Spinner, Table, td, th } from "@/components/common";
import { api, ApiError, useApi, usePaged } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { AdminMe, AdminSubscription, BillingEnv, PlanCatalogState, SubscriptionFilter } from "@/lib/types";

// Abonelikler (API.md §7.21): RevenueCat'ten eşitlenen abonelik durumları. "Ödedim ama Pro olmadım" diyen kullanıcı
// burada aranır; ADMIN, aboneyi RevenueCat ile yeniden eşitleyebilir (REST anahtarı tanımlıysa).

type Tone = "good" | "warn" | "danger" | "neutral" | "primary";
const FILTERS: { id: SubscriptionFilter | "all"; label: string }[] = [
  { id: "all", label: "Tümü" },
  { id: "active", label: "Aktif" },
  { id: "trial", label: "Deneme" },
  { id: "cancelled", label: "İptal etti" },
  { id: "grace", label: "Ek süre" },
  { id: "billing_issue", label: "Ödeme sorunu" },
  { id: "expired", label: "Süresi doldu" },
];
const STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Aktif", tone: "good" },
  cancelled: { label: "İptal etti", tone: "warn" },
  grace: { label: "Ek süre", tone: "warn" },
  billing_issue: { label: "Ödeme sorunu", tone: "danger" },
  expired: { label: "Süresi doldu", tone: "neutral" },
};
const STORES: Record<string, string> = { APP_STORE: "App Store", PLAY_STORE: "Google Play", MAC_APP_STORE: "Mac App Store", STRIPE: "Stripe", PROMOTIONAL: "Promosyon", AMAZON: "Amazon" };
const PERIOD: Record<string, string> = { TRIAL: "Deneme", INTRO: "Tanıtım fiyatı", NORMAL: "Normal", PREPAID: "Ön ödemeli" };

export default function SubscriptionsPage() {
  const { toast } = useFeedback();
  const [filter, setFilter] = useState<SubscriptionFilter | "all">("all");
  const [env, setEnv] = useState<BillingEnv>("PRODUCTION");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const me = useApi<AdminMe>("/me");
  const catalog = useApi<PlanCatalogState>("/billing/catalog");
  const counts = useApi<{ counts: Record<SubscriptionFilter, number> }>("/subscriptions", { env, limit: 1 });
  const list = usePaged<AdminSubscription>("/subscriptions", { env, status: filter === "all" ? undefined : filter, q: q || undefined });
  const [syncing, setSyncing] = useState<string | null>(null);
  const canSync = me.data && ["ADMIN", "SUPER_ADMIN"].includes(me.data.role);
  const restOn = catalog.data?.revenuecatRest ?? false;
  const total = counts.data ? Object.values(counts.data.counts).reduce((a, b) => a + b, 0) : null;

  async function sync(userId: string) {
    setSyncing(userId);
    try {
      const r = await api<{ subscription: AdminSubscription | null }>(`/subscriptions/${encodeURIComponent(userId)}/sync`, { method: "POST" });
      toast("success", r.subscription ? `Eşitlendi: ${STATUS[r.subscription.status]?.label ?? r.subscription.status}` : "Eşitlendi: RevenueCat'te abonelik yok.");
      list.reload();
      counts.reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Eşitlenemedi.");
    } finally {
      setSyncing(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Abonelikler"
        description="Mağaza aboneliklerinin son durumu (RevenueCat). Kullanıcıyı e-postasıyla ya da kimliğiyle ara."
        actions={
          <div className="flex gap-1">
            {(["PRODUCTION", "SANDBOX"] as const).map((e) => (
              <Button key={e} size="sm" variant={e === env ? "primary" : "secondary"} onClick={() => setEnv(e)} aria-pressed={e === env}>
                {e === "PRODUCTION" ? "Canlı" : "Test (sandbox)"}
              </Button>
            ))}
          </div>
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Durum">
          {FILTERS.map((f) => {
            const n = f.id === "all" ? total : counts.data?.counts[f.id];
            return (
              <Button key={f.id} size="sm" variant={f.id === filter ? "primary" : "secondary"} onClick={() => setFilter(f.id)} aria-pressed={f.id === filter}>
                {f.label}
                <span className="tabular opacity-70">{n ?? "…"}</span>
              </Button>
            );
          })}
        </div>
        <label className="relative w-full lg:w-72">
          <span className="sr-only">E-posta ya da kullanıcı kimliği</span>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="E-posta ya da kullanıcı kimliği" className="pl-8" maxLength={100} />
        </label>
      </div>
      {canSync && catalog.data && !restOn && (
        <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
          RevenueCat REST anahtarı tanımlı değil; abonelikler yalnız webhook ile güncellenir ve elle eşitleme kapalıdır.
        </p>
      )}
      <Card>
        {list.error && list.items.length === 0 ? (
          <ErrorState message={list.error.message} onRetry={list.reload} />
        ) : list.loading && list.items.length === 0 ? (
          <Spinner />
        ) : list.items.length === 0 ? (
          <EmptyState title="Abonelik yok" description={q ? "Aramayla eşleşen abone bulunamadı." : "Mağazadan ilk satın alma geldiğinde burada görünür."} />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th className={th}>Kullanıcı</th>
                  <th className={th}>Durum</th>
                  <th className={th}>Bitiş</th>
                  <th className={th}>Ürün / mağaza</th>
                  <th className={th}>Güncellendi</th>
                  <th className={th} />
                </tr>
              }
            >
              {list.items.map((s) => {
                const st = s.periodType === "TRIAL" && s.status !== "expired" ? { label: "Deneme", tone: "primary" as Tone } : (STATUS[s.status] ?? { label: s.status, tone: "neutral" as Tone });
                return (
                  <tr key={s.id}>
                    <td className={td}>
                      <Link href={`/users/${s.userId}`} className="text-primary hover:underline">
                        {s.email ?? (s.isGuest ? "Misafir" : "—")}
                      </Link>
                      <span className="block font-mono text-[11px] text-muted-foreground">{s.userId.slice(0, 8)}…</span>
                    </td>
                    <td className={td}>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <span className="mt-1 block text-[11px] text-muted-foreground">{s.access ? "Erişimi var" : "Erişimi yok"}</span>
                    </td>
                    <td className={`${td} whitespace-nowrap text-xs`}>
                      {fmtDateTime(s.expiresAt)}
                      {s.gracePeriodExpiresAt && <span className="block text-muted-foreground">Ek süre: {fmtDateTime(s.gracePeriodExpiresAt)}</span>}
                    </td>
                    <td className={`${td} text-xs`}>
                      <span className="font-mono">{s.productId ?? "—"}</span>
                      <span className="block text-muted-foreground">
                        {[s.store ? (STORES[s.store] ?? s.store) : null, s.periodType ? (PERIOD[s.periodType] ?? s.periodType) : null].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </td>
                    <td className={`${td} whitespace-nowrap text-xs text-muted-foreground`}>{fmtDateTime(s.updatedAt)}</td>
                    <td className={`${td} text-right`}>
                      {canSync && (
                        <Button size="sm" onClick={() => sync(s.userId)} loading={syncing === s.userId} disabled={!restOn} title={restOn ? "RevenueCat'ten yeniden oku" : "RevenueCat REST anahtarı tanımlı değil"}>
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Eşitle
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <LoadMore hasMore={Boolean(list.nextCursor)} loading={list.loadingMore} onClick={list.loadMore} />
          </>
        )}
      </Card>
    </>
  );
}

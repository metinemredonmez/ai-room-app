"use client";

import { Loader2, Mail, RefreshCw } from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { StatusBadge, useDrafts } from "@/components/marketing";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { WeekNumbers, WeeklyReport } from "@/lib/types";

// Pazarlama → Haftalık rapor (API.md §7.18): every Monday 09:00 the numbers of the last 7 days go to the
// SUPER_ADMIN addresses with Claude's short reading; reports can also be made by hand here.

const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? "—" : "yeni") : `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%`);

const ROWS: Array<[string, (w: WeekNumbers) => number, ((n: number) => string)?]> = [
  ["Yeni kayıtlı kullanıcı", (w) => w.users.registered],
  ["Yeni misafir", (w) => w.users.guests],
  ["Aktif kullanıcı", (w) => w.users.active],
  ["Tasarım (başarılı)", (w) => w.designs.succeeded],
  ["Tasarım (hatalı)", (w) => w.designs.failed],
  ["Yeni abonelik", (w) => w.store.subscriptionsStarted],
  ["Yenileme", (w) => w.store.renewals],
  ["İptal", (w) => w.store.cancellations],
  ["Kredi paketi", (w) => w.store.creditPacks],
  ["AI maliyeti", (w) => w.ai.costUsd, (n) => `$${n.toFixed(2)}`],
  ["Hatalı zamanlı iş", (w) => w.ops.jobErrors],
  ["Gönderilen toplu ileti", (w) => w.ops.broadcastsSent],
];

export default function ReportPage() {
  const list = useDrafts<WeeklyReport>("report");
  const { toast } = useFeedback();
  const [busy, setBusy] = useState<"make" | "send" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const items = list.items;
  const open = items.find((d) => d.id === openId) ?? items.find((d) => d.output) ?? null;

  async function run(send: boolean) {
    setBusy(send ? "send" : "make");
    try {
      await api("/marketing/report", { method: "POST", body: { send } });
      toast("success", send ? "Rapor hazırlanıyor; bitince e-postayla gelecek." : "Rapor hazırlanıyor.");
      list.reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Oluşturulamadı.");
    } finally {
      setBusy(null);
    }
  }

  const r = open?.output;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Haftalık rapor"
        description="Her pazartesi 09:00'da son 7 günün sayıları, bir önceki haftayla karşılaştırmalı ve kısa bir yapay zekâ yorumuyla SUPER_ADMIN adreslerine gider. Kişisel veri içermez."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => run(false)} disabled={busy !== null}>
              {busy === "make" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Şimdi oluştur
            </Button>
            <Button onClick={() => run(true)} disabled={busy !== null}>
              {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />} Oluştur ve e-postala
            </Button>
          </div>
        }
      />
      {list.error && !list.data ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton className="h-96 w-full" />
      ) : !items.length ? (
        <Card className="p-0">
          <EmptyState title="Henüz rapor yok" description="İlk rapor pazartesi 09:00'da gelir; şimdi görmek için “Şimdi oluştur”." />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <Card className="h-fit p-2">
            <ul className="space-y-1">
              {items.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(d.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted ${open?.id === d.id ? "bg-muted" : ""}`}
                  >
                    <span>{fmtDateTime(d.createdAt)}</span>
                    {d.status !== "READY" && <StatusBadge status={d.status} />}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {r ? (
            <div className="space-y-6">
              <Card className="space-y-3 p-5">
                <h2 className="text-sm font-semibold">Yorum</h2>
                {r.text ? (
                  <>
                    <p className="text-sm leading-relaxed">{r.text.summary}</p>
                    {r.text.highlights.length > 0 && (
                      <ul className="list-disc space-y-1 pl-5 text-sm">
                        {r.text.highlights.map((h) => (
                          <li key={h}>{h}</li>
                        ))}
                      </ul>
                    )}
                    {r.text.actions.length > 0 && (
                      <>
                        <h3 className="pt-2 text-sm font-semibold">Öneriler</h3>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {r.text.actions.map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Bu raporda yapay zekâ yorumu yok; sayılar aşağıda.</p>
                )}
              </Card>
              <Card className="overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{fmtDateTime(r.metrics.period.from)} – {fmtDateTime(r.metrics.period.to)}</TableHead>
                      <TableHead className="text-right">Bu hafta</TableHead>
                      <TableHead className="text-right">Geçen hafta</TableHead>
                      <TableHead className="text-right">Değişim</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ROWS.map(([label, get, fmt]) => {
                      const a = get(r.metrics.thisWeek);
                      const b = get(r.metrics.lastWeek);
                      return (
                        <TableRow key={label}>
                          <TableCell>{label}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt ? fmt(a) : a}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{fmt ? fmt(b) : b}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{pct(a, b)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
              <div className="grid gap-6 md:grid-cols-2">
                <Card className="space-y-2 p-5">
                  <h3 className="text-sm font-semibold">En çok kullanılan araçlar</h3>
                  {r.metrics.topTools.length ? r.metrics.topTools.map((t) => <p key={t.tool} className="flex justify-between text-sm"><span>{t.tool}</span><span className="tabular-nums">{t.designs}</span></p>) : <p className="text-sm text-muted-foreground">—</p>}
                </Card>
                <Card className="space-y-2 p-5">
                  <h3 className="text-sm font-semibold">En çok kullanılan stiller</h3>
                  {r.metrics.topStyles.length ? r.metrics.topStyles.map((s) => <p key={s.style} className="flex justify-between text-sm"><span>{s.style}</span><span className="tabular-nums">{s.designs}</span></p>) : <p className="text-sm text-muted-foreground">—</p>}
                </Card>
              </div>
              <p className="text-xs text-muted-foreground">
                Şu an: {r.metrics.now.registeredUsers} kayıtlı kullanıcı, {r.metrics.now.activeSubscriptions} aktif abonelik, {r.metrics.now.openContentReports} açık içerik bildirimi, {r.metrics.now.openKvkkRequests} açık KVKK başvurusu.
              </p>
            </div>
          ) : (
            <Skeleton className="h-96 w-full" />
          )}
        </div>
      )}
    </div>
  );
}

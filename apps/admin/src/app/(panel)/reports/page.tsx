"use client";

import { Flag, Star, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState, LoadMore, PageHeader } from "@/components/common";
import { Compare, Img, NoResult } from "@/components/design-media";
import { useFeedback } from "@/components/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, ApiError, notifyBadges, useApi, usePaged } from "@/lib/api";
import { fmtDateTime, toolLabel } from "@/lib/format";
import type { AdminMe, ContentReport, ReportStatus } from "@/lib/types";

const REASONS: Record<ContentReport["reason"], string> = {
  inappropriate: "Uygunsuz",
  offensive: "Saldırgan",
  copyright: "Telif",
  privacy: "Gizlilik",
  other: "Diğer",
};
const STATUS: Record<ReportStatus, { label: string; className: string }> = {
  OPEN: { label: "Açık", className: "bg-warn-soft text-warn" },
  RESOLVED: { label: "Çözüldü", className: "bg-good-soft text-good" },
  DISMISSED: { label: "Reddedildi", className: "bg-secondary text-secondary-foreground" },
};
const TABS: ReportStatus[] = ["OPEN", "RESOLVED", "DISMISSED"];

export default function ReportsPage() {
  const [status, setStatus] = useState<ReportStatus>("OPEN");
  const list = usePaged<ContentReport>("/reports", { status });
  const me = useApi<AdminMe>("/me");
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = list.items.find((r) => r.id === openId) ?? null;

  function decided(id: string) {
    list.setItems((items) => items.filter((x) => x.id !== id));
    setOpenId(null);
    notifyBadges();
  }

  return (
    <>
      <PageHeader
        title="İçerik bildirimleri"
        description="Kullanıcıların bildirdiği yapay zekâ çıktıları. Google Play üretken AI politikası bildirimlerin hızla incelenmesini bekler."
      />

      <ToggleGroup type="single" variant="outline" size="sm" value={status} onValueChange={(v) => v && setStatus(v as ReportStatus)} aria-label="Durum" className="mb-4">
        {TABS.map((s) => (
          <ToggleGroupItem key={s} value={s} className="px-3">
            {STATUS[s].label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {list.error && list.items.length === 0 ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : list.loading && list.items.length === 0 ? (
        <Card className="gap-3 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </Card>
      ) : list.items.length === 0 ? (
        <EmptyState title="Bildirim yok" description={status === "OPEN" ? "Bekleyen bildirim yok." : "Bu durumda kayıt yok."} />
      ) : (
        <div className={list.loading ? "opacity-60 transition-opacity" : undefined}>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Tasarım</TableHead>
                  <TableHead>Neden</TableHead>
                  <TableHead>Kullanıcının notu</TableHead>
                  <TableHead>Sahibi</TableHead>
                  <TableHead className="pr-4">{status === "OPEN" ? "Bildirildi" : "Karar"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((r) => {
                  const thumb = r.design.results[0] ?? r.design.input;
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                      <TableCell className="pl-4">
                        <button type="button" className="flex items-center gap-3 text-left" onClick={() => setOpenId(r.id)}>
                          <span className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-muted">{thumb && <Img src={thumb.url} alt="" className="size-full object-cover" />}</span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-medium">
                              <span className="max-w-56 truncate">{r.design.title || toolLabel(r.design.tool)}</span>
                              {r.design.featured && <Star className="size-3.5 shrink-0 text-warn" fill="currentColor" aria-label="İlham galerisinde" />}
                            </span>
                            <span className="block text-xs text-muted-foreground">{toolLabel(r.design.tool)}</span>
                          </span>
                        </button>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-danger">
                          <Flag aria-hidden /> {REASONS[r.reason]}
                        </Badge>
                      </TableCell>
                      {/* User text stays plain text (WEB-01). */}
                      <TableCell className="max-w-72 truncate text-muted-foreground">{r.note ?? "—"}</TableCell>
                      <TableCell className="max-w-52 truncate text-muted-foreground">{r.owner.email ?? "Misafir kullanıcı"}</TableCell>
                      <TableCell className="pr-4 whitespace-nowrap text-muted-foreground">
                        {status === "OPEN" ? (
                          fmtDateTime(r.createdAt)
                        ) : (
                          <span className="block max-w-56 truncate" title={r.resolution ?? undefined}>
                            {r.resolution ?? "—"}
                            <span className="block text-xs">{fmtDateTime(r.resolvedAt)}</span>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          {list.error && <p className="pt-3 text-sm text-danger">{list.error.message}</p>}
          <LoadMore hasMore={Boolean(list.nextCursor)} loading={list.loadingMore} onClick={list.loadMore} />
        </div>
      )}

      <Sheet open={Boolean(selected)} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
          {selected && <ReportDetail key={selected.id} report={selected} role={me.data?.role} onDecided={decided} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function ReportDetail({ report, role, onDecided }: { report: ContentReport; role?: string; onDecided: (id: string) => void }) {
  const { toast, confirm } = useFeedback();
  const d = report.design;
  const result = d.results[0];
  const canUnfeature = role === "EDITOR" || role === "ADMIN" || role === "SUPER_ADMIN";
  const canDelete = role === "ADMIN" || role === "SUPER_ADMIN";
  const [resolution, setResolution] = useState("");
  const [unfeature, setUnfeature] = useState(d.featured && canUnfeature);
  const [deleteDesign, setDeleteDesign] = useState(false);
  const [busy, setBusy] = useState<"RESOLVED" | "DISMISSED" | null>(null);
  const tooShort = resolution.trim().length < 3;

  async function submit(status: "RESOLVED" | "DISMISSED") {
    if (tooShort) return;
    const removing = status === "RESOLVED" && deleteDesign;
    if (removing) {
      const ok = await confirm({
        title: "Tasarım silinsin mi?",
        description: "Tasarım ve tüm sonuç görselleri kalıcı olarak silinir; işlem denetim kaydına yazılır ve geri alınamaz.",
        confirmLabel: "Sil ve çöz",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(status);
    try {
      await api(`/reports/${encodeURIComponent(report.id)}`, {
        method: "PATCH",
        body: { status, resolution: resolution.trim(), unfeature: status === "RESOLVED" && unfeature, deleteDesign: removing },
      });
      toast("success", status === "DISMISSED" ? "Bildirim reddedildi." : removing ? "Tasarım silindi, bildirim çözüldü." : "Bildirim çözüldü.");
      onDecided(report.id);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
      // Someone else decided it meanwhile: the row is stale either way.
      if (e instanceof ApiError && e.status === 409) onDecided(report.id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle>İçerik bildirimi</SheetTitle>
        <SheetDescription>
          {REASONS[report.reason]} · {fmtDateTime(report.createdAt)}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-5 p-4">
        {result && d.input ? (
          <Compare before={d.input} after={result} />
        ) : (
          <div className="aspect-[4/3] overflow-hidden rounded-lg bg-muted">
            {d.input ? <Img src={d.input.url} alt="Yüklenen fotoğraf" className="size-full object-cover" /> : <NoResult status={d.status} />}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-danger">
              <Flag aria-hidden /> {REASONS[report.reason]}
            </Badge>
            <Badge className={STATUS[report.status].className}>{STATUS[report.status].label}</Badge>
            {d.featured && (
              <Badge variant="outline" className="text-warn">
                <Star fill="currentColor" aria-hidden /> İlham galerisinde
              </Badge>
            )}
          </div>
          {report.note ? (
            <blockquote className="rounded-lg border-l-2 border-danger bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">{report.note}</blockquote>
          ) : (
            <p className="text-sm text-muted-foreground">Kullanıcı not bırakmadı.</p>
          )}
        </div>

        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2.5 text-sm">
          <dt className="text-muted-foreground">Tasarım</dt>
          <dd>
            {d.title || toolLabel(d.tool)} · {toolLabel(d.tool)}
          </dd>
          <dt className="text-muted-foreground">Sahibi</dt>
          <dd className="min-w-0 truncate">
            <Link href={`/users/${encodeURIComponent(report.owner.id)}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <UserRound className="size-3.5" aria-hidden /> {report.owner.email ?? "Misafir kullanıcı"}
            </Link>
          </dd>
          <dt className="text-muted-foreground">Üretim tarihi</dt>
          <dd>{fmtDateTime(d.createdAt)}</dd>
          {report.status !== "OPEN" && (
            <>
              <dt className="text-muted-foreground">Karar</dt>
              <dd className="whitespace-pre-wrap">{report.resolution ?? "—"}</dd>
              <dt className="text-muted-foreground">Karar tarihi</dt>
              <dd>{fmtDateTime(report.resolvedAt)}</dd>
            </>
          )}
        </dl>

        {report.status === "OPEN" && (
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="grid gap-2">
              <Label htmlFor="resolution">Karar notu</Label>
              <Textarea
                id="resolution"
                rows={3}
                maxLength={500}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Örn. Görselde uygunsuz bir öğe yok; bildirim reddedildi."
              />
              <p className="text-xs text-muted-foreground">Denetim kaydına yazılır · {resolution.trim().length}/500</p>
            </div>
            {(canUnfeature && d.featured) || canDelete ? (
              <div className="flex flex-col gap-2 text-sm">
                {canUnfeature && d.featured && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={unfeature} onChange={(e) => setUnfeature(e.target.checked)} className="size-4 accent-primary" />
                    Çözerken ilham galerisinden kaldır
                  </label>
                )}
                {canDelete && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={deleteDesign} onChange={(e) => setDeleteDesign(e.target.checked)} className="size-4 accent-destructive" />
                    Çözerken tasarımı kalıcı olarak sil
                  </label>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {report.status === "OPEN" && (
        <SheetFooter className="sticky bottom-0 mt-auto flex-row flex-wrap justify-end border-t bg-background">
          <Button variant="outline" onClick={() => submit("DISMISSED")} disabled={busy !== null || tooShort}>
            Reddet
          </Button>
          <Button variant={deleteDesign ? "destructive" : "default"} onClick={() => submit("RESOLVED")} disabled={busy !== null || tooShort}>
            {deleteDesign ? "Sil ve çöz" : "Çöz"}
          </Button>
        </SheetFooter>
      )}
    </>
  );
}

"use client";

import { CheckCircle2, LifeBuoy, Loader2, Send } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, notifyBadges, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { SupportDetail, SupportStatus, SupportTicket } from "@/lib/types";

// Destek (API.md §7.19): tickets the users open from the web or the app; the answer reaches them by e-mail and push.

const STATUS: Record<SupportStatus, { label: string; className: string }> = {
  OPEN: { label: "Açık", className: "bg-warn-soft text-warn" },
  ANSWERED: { label: "Yanıtlandı", className: "bg-primary/10 text-primary" },
  CLOSED: { label: "Kapalı", className: "bg-secondary text-secondary-foreground" },
};
const CATEGORY: Record<string, string> = { bug: "Hata", billing: "Ödeme", account: "Hesap", design: "Tasarım", idea: "Öneri", other: "Diğer" };
const PLATFORM: Record<string, string> = { web: "Web", ios: "iOS", android: "Android" };

export default function SupportPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Inbox />
    </Suspense>
  );
}

function Inbox() {
  const params = useSearchParams();
  const [status, setStatus] = useState<SupportStatus>("OPEN");
  const [openId, setOpenId] = useState<string | null>(params.get("t"));
  const list = useApi<{ items: SupportTicket[]; counts: Record<SupportStatus, number> }>("/support", { status, limit: 100 });
  const items = list.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Destek" description="Kullanıcıların web ya da uygulamadan açtığı talepler. Yanıtın kullanıcıya e-posta (doğrulanmış adres) ve bildirimle gider; konuşma burada kalır." />
      <div className="flex flex-wrap gap-2">
        {(Object.keys(STATUS) as SupportStatus[]).map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
            {STATUS[s].label}
            <span className="tabular-nums opacity-70">{list.data?.counts[s] ?? "…"}</span>
          </Button>
        ))}
      </div>
      {list.error && !list.data ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton className="h-80 w-full" />
      ) : !items.length ? (
        <Card className="p-0">
          <EmptyState title={status === "OPEN" ? "Bekleyen talep yok" : "Bu durumda talep yok"} />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Talep</TableHead>
                <TableHead>Konu</TableHead>
                <TableHead>Kullanıcı</TableHead>
                <TableHead>Son mesaj</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((t) => (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => setOpenId(t.id)}>
                  <TableCell>
                    <div className="font-mono text-xs">{t.reference}</div>
                    <div className="text-xs text-muted-foreground">
                      {CATEGORY[t.category] ?? t.category}
                      {t.platform ? ` · ${PLATFORM[t.platform] ?? t.platform}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-80 truncate">{t.subject}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.user?.email ?? (t.user?.isGuest ? "Misafir" : "—")}
                    {t.user?.plan === "PRO" && <Badge className="ml-2 bg-primary/10 text-primary">PRO</Badge>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{fmtDateTime(t.lastMessageAt)}</TableCell>
                  <TableCell className="text-right">
                    <Badge className={STATUS[t.status].className}>{STATUS[t.status].label}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {openId && (
        <TicketSheet
          key={openId}
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            list.reload();
            notifyBadges();
          }}
        />
      )}
    </div>
  );
}

function TicketSheet({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const t = useApi<SupportDetail>(`/support/${id}`);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<"reply" | "close" | null>(null);
  const d = t.data;

  async function send() {
    setBusy("reply");
    try {
      await api(`/support/${id}/reply`, { method: "POST", body: { body: reply.trim() } });
      setReply("");
      toast("success", "Yanıt gönderildi.");
      t.reload();
      onChanged();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Gönderilemedi.");
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    if (!(await confirm({ title: "Talep kapatılsın mı?", description: "Kullanıcı cevap yazarsa yeniden açılır.", confirmLabel: "Kapat" }))) return;
    setBusy("close");
    try {
      await api(`/support/${id}/close`, { method: "POST" });
      toast("success", "Kapatıldı.");
      t.reload();
      onChanged();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Kapatılamadı.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {!d ? (
          t.error ? <ErrorState message={t.error.message} onRetry={t.reload} /> : <Skeleton className="m-4 h-96" />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <LifeBuoy className="size-4" /> {d.subject} <Badge className={STATUS[d.status].className}>{STATUS[d.status].label}</Badge>
              </SheetTitle>
              <SheetDescription>
                {d.reference} · {CATEGORY[d.category] ?? d.category} · {fmtDateTime(d.createdAt)}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-4">
              <dl className="grid gap-3 rounded-lg bg-muted/50 p-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Kullanıcı</dt>
                  <dd>
                    <Link href={`/users/${d.user.id}`} className="text-primary hover:underline">
                      {d.user.email ?? (d.user.isGuest ? "Misafir" : d.user.id.slice(0, 8))}
                    </Link>{" "}
                    · {d.user.plan} · {d.user.locale.toUpperCase()}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Ortam</dt>
                  <dd>
                    {d.platform ? PLATFORM[d.platform] ?? d.platform : "—"}
                    {d.appVersion ? ` · ${d.appVersion}` : ""}
                  </dd>
                </div>
                {d.requestId && (
                  <div>
                    <dt className="text-muted-foreground">Hata kimliği (loglarda ara)</dt>
                    <dd className="font-mono">{d.requestId}</dd>
                  </div>
                )}
                {d.designId && (
                  <div>
                    <dt className="text-muted-foreground">Tasarım</dt>
                    <dd className="font-mono">{d.designId.slice(0, 8)}</dd>
                  </div>
                )}
              </dl>
              <ol className="space-y-3">
                {d.messages.map((m) => (
                  <li key={m.id} className={`rounded-lg p-3 text-sm ${m.author === "STAFF" ? "ml-8 bg-primary/10" : "mr-8 bg-muted"}`}>
                    <div className="mb-1 text-xs text-muted-foreground">
                      {m.author === "STAFF" ? "Destek ekibi" : "Kullanıcı"} · {fmtDateTime(m.createdAt)}
                    </div>
                    <p className="whitespace-pre-line">{m.body}</p>
                  </li>
                ))}
              </ol>
              <div className="space-y-1.5">
                <Label htmlFor="support-reply">Yanıt</Label>
                <Textarea id="support-reply" rows={6} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Kullanıcıya yazacağın yanıt (e-postayla da gider)." />
                <p className="text-right text-xs text-muted-foreground">{reply.length}/4000</p>
              </div>
            </div>
            <SheetFooter className="flex-row flex-wrap justify-end gap-2">
              {d.status !== "CLOSED" && (
                <Button variant="outline" onClick={close} disabled={busy !== null}>
                  {busy === "close" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Kapat
                </Button>
              )}
              <Button onClick={send} disabled={busy !== null || !reply.trim()}>
                {busy === "reply" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Yanıtla
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

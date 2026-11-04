"use client";

import { AlarmClock, CircleCheck, Inbox, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState, LoadMore, PageHeader, Spinner } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, ApiError, notifyBadges, useApi, usePaged } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { AdminMe, DataRequest, DataRequestDetail, DataRequestStatus } from "@/lib/types";

// KVKK m.11 rights (backend DATA_REQUEST_TYPES).
const TYPE_LABELS: Record<string, string> = {
  info: "Verilerimin işlenip işlenmediğini öğrenme",
  access: "Verilerim hakkında bilgi",
  transfers: "Aktarılan üçüncü kişileri öğrenme",
  rectification: "Düzeltme",
  erasure: "Silme / yok etme",
  third_party_notice: "Üçüncü kişilere bildirim",
  objection: "Otomatik analize itiraz",
  compensation: "Zararın giderilmesi",
  other: "Diğer",
};
const CHANNEL_LABELS: Record<DataRequest["channel"], string> = { app: "Uygulama", email: "E-posta", kep: "KEP", letter: "Yazılı", other: "Diğer" };
const STATUS: Record<DataRequestStatus, { label: string; className: string }> = {
  RECEIVED: { label: "Alındı", className: "bg-secondary text-secondary-foreground" },
  IN_PROGRESS: { label: "İşlemde", className: "bg-primary-soft text-primary" },
  COMPLETED: { label: "Tamamlandı", className: "bg-good-soft text-good" },
  REJECTED: { label: "Reddedildi", className: "bg-danger-soft text-danger" },
};
const FILTERS = [
  { value: "open", label: "Açık" },
  { value: "overdue", label: "Gecikmiş" },
  { value: "closed", label: "Kapanan" },
  { value: "all", label: "Tümü" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];
const canWrite = (me: AdminMe | null) => me?.role === "ADMIN" || me?.role === "SUPER_ADMIN";

function Deadline({ r }: { r: DataRequest }) {
  if (r.daysLeft === null) return <span className="text-muted-foreground">{fmtDate(r.dueAt)}</span>;
  const tone = r.overdue ? "text-danger" : r.daysLeft <= 7 ? "text-warn" : "text-muted-foreground";
  return (
    <span className={tone}>
      {fmtDate(r.dueAt)}
      <span className="block text-xs">{r.overdue ? `${-r.daysLeft} gün gecikti` : `${r.daysLeft} gün kaldı`}</span>
    </span>
  );
}

export default function DataRequestsPage() {
  const me = useApi<AdminMe>("/me");
  const [filter, setFilter] = useState<Filter>("open");
  const counts = useApi<{ counts: { open: number; dueSoon: number; overdue: number } }>("/data-requests", { limit: 1 });
  // "open" shows both open states; the API filters one status at a time, so it is merged here.
  const received = usePaged<DataRequest>("/data-requests", { status: "RECEIVED" });
  const inProgress = usePaged<DataRequest>("/data-requests", { status: "IN_PROGRESS" });
  const other = usePaged<DataRequest>("/data-requests", filter === "overdue" ? { overdue: "true" } : {});
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const list =
    filter === "open"
      ? [...received.items, ...inProgress.items].sort((a, b) => a.dueAt.localeCompare(b.dueAt))
      : filter === "closed"
        ? other.items.filter((r) => r.status === "COMPLETED" || r.status === "REJECTED")
        : other.items;
  const loading = filter === "open" ? received.loading || inProgress.loading : other.loading;
  const error = filter === "open" ? received.error ?? inProgress.error : other.error;
  const reloadAll = () => {
    counts.reload();
    received.reload();
    inProgress.reload();
    other.reload();
    notifyBadges();
  };
  const c = counts.data?.counts;

  return (
    <>
      <PageHeader
        title="KVKK başvuruları"
        description="KVKK m.11 başvuruları en geç 30 gün içinde yanıtlanır (m.13). Yanıt başvuru sahibine e-postayla gider; başvuru ve yanıt metni denetim kaydına girmez."
        actions={
          canWrite(me.data) && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Başvuru kaydet
            </Button>
          )
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Counter icon={Inbox} label="Açık başvuru" value={c?.open} />
        <Counter icon={AlarmClock} label="7 gün içinde dolacak" value={c?.dueSoon} tone={c?.dueSoon ? "warn" : undefined} />
        <Counter icon={AlarmClock} label="Süresi geçmiş" value={c?.overdue} tone={c?.overdue ? "danger" : undefined} />
      </div>

      <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} aria-label="Filtre" className="mb-4">
        {FILTERS.map((f) => (
          <ToggleGroupItem key={f.value} value={f.value} className="px-3">
            {f.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {error && !list.length ? (
        <ErrorState message={error.message} onRetry={reloadAll} />
      ) : loading && !list.length ? (
        <Spinner />
      ) : !list.length ? (
        <EmptyState title="Başvuru yok" description={filter === "open" ? "Bekleyen KVKK başvurusu bulunmuyor." : undefined} />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Başvuru</TableHead>
                <TableHead>Kanal</TableHead>
                <TableHead>Geliş</TableHead>
                <TableHead>Son tarih</TableHead>
                <TableHead className="pr-6">Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                  <TableCell className="pl-6">
                    <button type="button" className="text-left" onClick={() => setOpenId(r.id)}>
                      <span className="block font-medium">{TYPE_LABELS[r.type] ?? r.type}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{r.reference}</span>
                    </button>
                  </TableCell>
                  <TableCell>{CHANNEL_LABELS[r.channel]}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(r.receivedAt)}</TableCell>
                  <TableCell>
                    <Deadline r={r} />
                  </TableCell>
                  <TableCell className="pr-6">
                    <Badge className={STATUS[r.status].className}>{STATUS[r.status].label}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {filter === "open" ? (
        // Both open states page independently; one click advances whichever still has more.
        <LoadMore
          hasMore={Boolean(received.nextCursor || inProgress.nextCursor)}
          loading={received.loadingMore || inProgress.loadingMore}
          onClick={() => {
            if (received.nextCursor) void received.loadMore();
            if (inProgress.nextCursor) void inProgress.loadMore();
          }}
        />
      ) : (
        <LoadMore hasMore={Boolean(other.nextCursor)} loading={other.loadingMore} onClick={other.loadMore} />
      )}

      {openId && <DetailDialog id={openId} writable={canWrite(me.data)} onClose={() => setOpenId(null)} onChanged={reloadAll} />}
      {creating && <CreateDialog onClose={() => setCreating(false)} onDone={reloadAll} />}
    </>
  );
}

function Counter({ icon: Icon, label, value, tone }: { icon: typeof Inbox; label: string; value: number | undefined; tone?: "warn" | "danger" }) {
  const color = tone === "danger" ? "bg-danger-soft text-danger" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-primary-soft text-primary";
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <span className={`flex size-8 items-center justify-center rounded-lg ${color}`}>
            <Icon className="size-4" aria-hidden />
          </span>
        </CardAction>
        <CardTitle className="tabular text-3xl">{value ?? "—"}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function DetailDialog({ id, writable, onClose, onChanged }: { id: string; writable: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useFeedback();
  const req = useApi<DataRequestDetail>(`/data-requests/${id}`);
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const r = req.data;
  const open = r && (r.status === "RECEIVED" || r.status === "IN_PROGRESS");

  async function update(status: Exclude<DataRequestStatus, "RECEIVED">) {
    setBusy(true);
    try {
      await api(`/data-requests/${id}`, { method: "PATCH", body: status === "IN_PROGRESS" ? { status } : { status, response: response.trim() } });
      toast("success", status === "IN_PROGRESS" ? "Başvuru işleme alındı." : "Başvuru sonuçlandı; yanıt başvuru sahibine gönderildi.");
      req.reload();
      onChanged();
      if (status !== "IN_PROGRESS") onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem başarısız.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{r ? TYPE_LABELS[r.type] ?? r.type : "Başvuru"}</DialogTitle>
          <DialogDescription>{r ? `${r.reference} · ${CHANNEL_LABELS[r.channel]} · ${fmtDateTime(r.receivedAt)}` : "Yükleniyor…"}</DialogDescription>
        </DialogHeader>
        {!r ? (
          req.error ? <ErrorState message={req.error.message} onRetry={req.reload} /> : <Spinner />
        ) : (
          <div className="grid gap-4 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <Badge className={STATUS[r.status].className}>{STATUS[r.status].label}</Badge>
              <span>
                Son tarih: <Deadline r={r} />
              </span>
            </div>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-2">
              <dt className="text-muted-foreground">Başvuru sahibi</dt>
              <dd>
                {r.user ? (
                  <Link href={`/users/${r.user.id}`} className="font-medium text-primary hover:underline">
                    {r.user.name ?? r.user.email ?? "Misafir hesap"}
                  </Link>
                ) : (
                  r.contactEmail ?? "—"
                )}
                {r.user?.email && <span className="block text-xs text-muted-foreground">{r.user.email}</span>}
              </dd>
              {r.closedAt && (
                <>
                  <dt className="text-muted-foreground">Kapanış</dt>
                  <dd>{fmtDateTime(r.closedAt)}</dd>
                </>
              )}
            </dl>
            <div>
              <p className="mb-1 font-medium">Başvuru</p>
              <p className="rounded-lg bg-muted p-3 whitespace-pre-wrap">{r.details}</p>
            </div>
            {r.response && (
              <div>
                <p className="mb-1 font-medium">Verilen yanıt</p>
                <p className="rounded-lg border p-3 whitespace-pre-wrap">{r.response}</p>
              </div>
            )}
            {open && writable && (
              <div className="grid gap-2">
                <Label htmlFor="response">Yanıt (başvuru sahibine e-postayla gider)</Label>
                <Textarea id="response" rows={5} maxLength={5000} value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Yapılan işlemi ve sonucunu açıkça yaz." />
                <p className="text-xs text-muted-foreground">Sonuçlandırmak için en az 10 karakter. E-postada KVKK m.14 şikâyet hakkı hatırlatılır.</p>
              </div>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
          {open && writable && r?.status === "RECEIVED" && (
            <Button variant="secondary" disabled={busy} onClick={() => update("IN_PROGRESS")}>
              İşleme al
            </Button>
          )}
          {open && writable && (
            <>
              <Button variant="destructive" disabled={busy || response.trim().length < 10} onClick={() => update("REJECTED")}>
                Reddet
              </Button>
              <Button disabled={busy || response.trim().length < 10} onClick={() => update("COMPLETED")}>
                <CircleCheck aria-hidden /> Tamamla
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());
  const [type, setType] = useState("access");
  const [channel, setChannel] = useState<Exclude<DataRequest["channel"], "app">>("email");
  const [contactEmail, setContactEmail] = useState("");
  const [details, setDetails] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const emailOk = !contactEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail);

  async function submit() {
    setBusy(true);
    try {
      // Noon in Istanbul keeps the chosen calendar day whatever the browser's time zone.
      const receivedAt = new Date(`${receivedOn}T12:00:00+03:00`);
      const row = await api<DataRequest>("/data-requests", {
        method: "POST",
        body: { type, channel, contactEmail: contactEmail.trim() || null, details: details.trim(), receivedAt: (receivedAt > new Date() ? new Date() : receivedAt).toISOString() },
      });
      toast("success", `${row.reference} kaydedildi; son tarih ${fmtDate(row.dueAt)}.`);
      onDone();
      onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Başvuru kaydet</DialogTitle>
          <DialogDescription>E-posta, KEP ya da yazılı gelen başvuru. 30 günlük süre geldiği günden başlar.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="type">Konu</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="channel">Kanal</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
                <SelectTrigger id="channel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["email", "kep", "letter", "other"] as const).map((k) => (
                    <SelectItem key={k} value={k}>
                      {CHANNEL_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="received">Geliş tarihi</Label>
              <Input id="received" type="date" max={today} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact">Yanıt e-postası</Label>
              <Input id="contact" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="isteğe bağlı" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="details">Başvuru metni</Label>
            <Textarea id="details" rows={5} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={busy || details.trim().length < 10 || !emailOk || !receivedOn} onClick={submit}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

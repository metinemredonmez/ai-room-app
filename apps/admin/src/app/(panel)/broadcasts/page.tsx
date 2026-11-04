"use client";

import { AlertTriangle, Bell, CalendarClock, Mail, Megaphone, Plus, Send, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadMore, PageHeader } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, ApiError, useApi, usePaged } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { LOCALES, LOCALE_LABELS, type AdminMe, type Broadcast, type BroadcastAudience, type BroadcastChannel, type BroadcastDetail, type BroadcastKind, type BroadcastStatus, type Locale } from "@/lib/types";

const KIND: Record<BroadcastKind, { label: string; hint: string; className: string }> = {
  SERVICE: {
    label: "Bilgilendirme",
    hint: "Kullanıcının uygulamayı kullanımıyla ilgili bilgi: yeni stil, bakım, özellik. İndirim, fiyat ya da satın alma çağrısı içeremez.",
    className: "text-primary",
  },
  MARKETING: {
    label: "Kampanya",
    hint: "Ticari ileti: yalnız pazarlama izni veren kullanıcılara gider, kişi başına haftalık sınır ve sessiz saatler (21:00–09:00) uygulanır.",
    className: "text-warn",
  },
};
const CHANNEL: Record<BroadcastChannel, { label: string; hint: string }> = {
  PUSH: { label: "Bildirim", hint: "Uygulamada bildirim izni veren cihazlara gider; metin kısa olmalı." },
  EMAIL: { label: "E-posta", hint: "E-postası doğrulanmış kayıtlı kullanıcılara gider; kampanyada alt bilgide abonelikten çık bağlantısı bulunur. Günlük gönderim sınırı vardır." },
};
const STATUS: Record<BroadcastStatus, { label: string; className: string }> = {
  DRAFT: { label: "Taslak", className: "bg-secondary text-secondary-foreground" },
  SCHEDULED: { label: "Zamanlandı", className: "bg-primary/10 text-primary" },
  SENDING: { label: "Gönderiliyor", className: "bg-warn-soft text-warn" },
  SENT: { label: "Gönderildi", className: "bg-good-soft text-good" },
  CANCELLED: { label: "İptal", className: "bg-secondary text-secondary-foreground" },
  FAILED: { label: "Başarısız", className: "bg-danger/10 text-danger" },
};
const REASONS: Record<string, string> = {
  no_device: "Cihaz yok",
  no_email: "E-posta doğrulanmamış",
  consent_missing: "Pazarlama izni yok",
  weekly_cap: "Haftalık sınır doldu",
  provider_error: "Bildirim servisi reddetti",
  interrupted: "Yarıda kesildi",
  cancelled: "İptal edildi",
  inactive: "Hesap kapalı",
};
const DELIVERY: Record<string, string> = { PENDING: "Sırada", SENDING: "Gönderiliyor", SENT: "Gönderildi", SKIPPED: "Atlandı", FAILED: "Başarısız", CANCELLED: "İptal" };
const SIGNALS: Record<string, string> = {
  indirim: "indirim", kampanya: "kampanya", firsat: "fırsat", teklif: "teklif", kupon: "kupon/promosyon", hediye: "hediye",
  abonelik: "abonelik/üyelik", pro: "PRO'ya geçiş", deneme: "deneme süresi", satin_al: "satın alma", fiyat: "fiyat",
  aciliyet: "aciliyet (son gün, kaçırma…)", yuzde: "yüzde", en_commercial: "İngilizce ticari ifade", satin_alma_ekrani: "fiyatlar ekranına bağlantı",
};
const NONE = "all";

const canWrite = (role?: string) => role === "ADMIN" || role === "SUPER_ADMIN";

function audienceSummary(a: BroadcastAudience, channel: BroadcastChannel = "PUSH"): string {
  const parts: string[] = [];
  if (a.emails?.length) parts.push(`${a.emails.length} seçili kişi`);
  if (a.plan) parts.push(a.plan === "PRO" ? "PRO" : "Ücretsiz");
  if (a.platform && channel === "PUSH") parts.push(a.platform === "ios" ? "iOS" : "Android");
  if (a.locale) parts.push(a.locale.toUpperCase());
  if (a.accounts === "registered") parts.push("kayıtlı");
  if (a.accounts === "guests") parts.push("misafir");
  if (a.activeDays) parts.push(`son ${a.activeDays} günde aktif`);
  if (a.inactiveDays) parts.push(`${a.inactiveDays}+ gündür girmeyen`);
  if (a.registeredAfter || a.registeredBefore) parts.push(`kayıt ${a.registeredAfter ?? "…"} – ${a.registeredBefore ?? "…"}`);
  return parts.length ? parts.join(" · ") : channel === "EMAIL" ? "E-postası doğrulanmış herkes" : "Cihazı kayıtlı herkes";
}

export default function BroadcastsPage() {
  const list = usePaged<Broadcast>("/broadcasts", {});
  const me = useApi<AdminMe>("/me");
  const writer = canWrite(me.data?.role);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Broadcast | "new" | null>(null);

  function saved(b: Broadcast) {
    list.setItems((items) => (items.some((x) => x.id === b.id) ? items.map((x) => (x.id === b.id ? b : x)) : [b, ...items]));
    setEditing(null);
    setOpenId(b.id);
  }

  return (
    <>
      <PageHeader
        title="Toplu Gönderim"
        description="Uygulama kullanıcılarına bildirim gönder. Bilgilendirme herkese, kampanya yalnız pazarlama izni verenlere gider."
        actions={
          writer ? (
            <Button onClick={() => setEditing("new")}>
              <Plus aria-hidden /> Yeni gönderim
            </Button>
          ) : null
        }
      />

      {list.error && list.items.length === 0 ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : list.loading && list.items.length === 0 ? (
        <Card className="gap-3 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </Card>
      ) : list.items.length === 0 ? (
        <EmptyState title="Henüz gönderim yok" description={writer ? "“Yeni gönderim” ile ilk bildirimi hazırla." : "Gönderimleri yöneticiler hazırlar."} />
      ) : (
        <div className={list.loading ? "opacity-60 transition-opacity" : undefined}>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Bildirim</TableHead>
                  <TableHead>Tür</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead className="text-right">Hedef</TableHead>
                  <TableHead className="text-right">Gönderildi</TableHead>
                  <TableHead className="text-right">Açıldı</TableHead>
                  <TableHead className="pr-4">Tarih</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((b) => (
                  <TableRow key={b.id} className="cursor-pointer" onClick={() => setOpenId(b.id)}>
                    <TableCell className="pl-4">
                      <button type="button" className="block max-w-80 text-left" onClick={() => setOpenId(b.id)}>
                        <span className="block truncate font-medium">{b.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{b.body}</span>
                      </button>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        {b.channel === "EMAIL" ? <Mail className="size-4 text-muted-foreground" aria-label="E-posta" /> : <Bell className="size-4 text-muted-foreground" aria-label="Bildirim" />}
                        <Badge variant="outline" className={KIND[b.kind].className}>
                          {KIND[b.kind].label}
                        </Badge>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS[b.status].className}>{STATUS[b.status].label}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.counts.target ? fmtInt(b.counts.target) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.counts.target ? fmtInt(b.counts.sent) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.counts.sent ? fmtInt(b.counts.opened) : "—"}</TableCell>
                    <TableCell className="pr-4 whitespace-nowrap text-muted-foreground">
                      {fmtDateTime(b.status === "SCHEDULED" ? b.scheduledAt : (b.finishedAt ?? b.startedAt ?? b.createdAt))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          {list.error && <p className="pt-3 text-sm text-danger">{list.error.message}</p>}
          <LoadMore hasMore={Boolean(list.nextCursor)} loading={list.loadingMore} onClick={list.loadMore} />
        </div>
      )}

      <Sheet open={Boolean(openId) && !editing} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
          {openId && (
            <BroadcastReport
              key={openId}
              id={openId}
              writer={writer}
              onChanged={(b) => list.setItems((items) => items.map((x) => (x.id === b.id ? b : x)))}
              onDeleted={(id) => {
                list.setItems((items) => items.filter((x) => x.id !== id));
                setOpenId(null);
              }}
              onEdit={(b) => setEditing(b)}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
          {editing && <Composer key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? null : editing} onSaved={saved} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function PhonePreview({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border bg-muted/40 p-3">
      <div className="flex items-start gap-2.5 rounded-xl bg-background p-3 shadow-sm">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Megaphone className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>CASALUME</span>
            <span>şimdi</span>
          </span>
          {/* Admin text stays plain text (WEB-01). */}
          <span className="block truncate text-sm font-semibold">{title || "Başlık"}</span>
          <span className="line-clamp-3 block text-sm text-muted-foreground">{body || "Mesaj metni"}</span>
        </span>
      </div>
    </div>
  );
}

function EmailPreview({ title, body, link }: { title: string; body: string; link: string | null }) {
  return (
    <div className="rounded-2xl border bg-[#F6F1EA] p-4 text-[#1C1714]">
      <div className="mb-3 font-serif text-lg">
        Casa<span className="text-[#A9532E]">lume</span>
      </div>
      <div className="rounded-xl border border-[#E7DDD1] bg-white p-4">
        <div className="font-serif text-lg">{title || "Konu"}</div>
        {/* Admin text stays plain text (WEB-01). */}
        <div className="mt-2 text-sm whitespace-pre-wrap">{body || "E-posta metni"}</div>
        {link && <span className="mt-3 inline-block rounded-full bg-[#A9532E] px-4 py-2 text-xs font-semibold text-white">Casalume&apos;da aç</span>}
      </div>
    </div>
  );
}

function BroadcastReport({
  id, writer, onChanged, onDeleted, onEdit,
}: {
  id: string;
  writer: boolean;
  onChanged: (b: Broadcast) => void;
  onDeleted: (id: string) => void;
  onEdit: (b: Broadcast) => void;
}) {
  const { toast, confirm } = useFeedback();
  const detail = useApi<BroadcastDetail>(`/broadcasts/${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState("");
  const b = detail.data;
  const reload = detail.reload;

  // A running send updates its counters round by round; follow it until it ends.
  useEffect(() => {
    if (b?.status !== "SENDING") return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [b?.status, reload]);
  useEffect(() => {
    if (b) onChanged(b);
    // Only the status and counters matter to the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b?.status, b?.counts.sent, b?.counts.opened]);

  if (detail.error && !b) return <div className="p-4"><ErrorState message={detail.error.message} onRetry={reload} /></div>;
  if (!b) return <div className="p-4"><Skeleton className="h-64 w-full" /></div>;

  async function act(path: "send" | "cancel" | "schedule", body?: unknown, done?: string) {
    setBusy(true);
    try {
      const out = await api<Broadcast>(`/broadcasts/${encodeURIComponent(id)}/${path}`, { method: "POST", body });
      onChanged(out);
      reload();
      toast("success", out.status === "SCHEDULED" && path === "send" ? `Sessiz saatler: ${fmtDateTime(out.scheduledAt)} için zamanlandı.` : (done ?? "Kaydedildi."));
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem yapılamadı.");
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const est = await api<{ withDevice: number; eligible: number }>("/broadcasts/estimate", { method: "POST", body: { audience: b!.audience, kind: b!.kind, channel: b!.channel } }).catch(() => null);
    const ok = await confirm({
      title: "Bildirim şimdi gönderilsin mi?",
      description: `${est ? `${fmtInt(est.eligible)} kişiye` : "Seçili kitleye"} “${b!.title}” gidecek. Gönderilen bildirim geri alınamaz.`,
      confirmLabel: "Gönder",
    });
    if (ok) await act("send", undefined, "Gönderim başladı.");
  }

  async function remove() {
    const ok = await confirm({ title: "Gönderim silinsin mi?", description: "Kayıt ve rapor silinir; metin denetim kaydında kalır.", confirmLabel: "Sil", destructive: true });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/broadcasts/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast("success", "Silindi.");
      onDeleted(id);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Silinemedi.");
    } finally {
      setBusy(false);
    }
  }

  const editable = b.status === "DRAFT" || b.status === "SCHEDULED";
  const cancellable = editable || b.status === "SENDING";
  const stats: Array<[string, number]> = [
    ["Hedef", b.counts.target], ["Gönderildi", b.counts.sent], ["Açıldı", b.counts.opened], ["Atlandı", b.counts.skipped], ["Başarısız", b.counts.failed],
  ];

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="flex items-center gap-2">
          {b.title}
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={KIND[b.kind].className}>{KIND[b.kind].label}</Badge>
          <Badge className={STATUS[b.status].className}>{STATUS[b.status].label}</Badge>
          {b.status === "SCHEDULED" && <span>{fmtDateTime(b.scheduledAt)}</span>}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-5 p-4">
        {b.channel === "EMAIL" ? <EmailPreview title={b.title} body={b.body} link={b.link} /> : <PhonePreview title={b.title} body={b.body} />}

        {b.error && (
          <p className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {b.error}
          </p>
        )}

        {b.counts.target > 0 && (
          <div className="grid grid-cols-5 gap-2">
            {stats.map(([label, n]) => (
              <div key={label} className="rounded-lg border p-2 text-center">
                <div className="text-lg font-semibold tabular-nums">{fmtInt(n)}</div>
                <div className="text-[11px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        )}

        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2.5 text-sm">
          <dt className="text-muted-foreground">Kitle</dt>
          <dd>{audienceSummary(b.audience, b.channel)}</dd>
          <dt className="text-muted-foreground">Kanal</dt>
          <dd>{CHANNEL[b.channel].label}</dd>
          <dt className="text-muted-foreground">Bağlantı</dt>
          <dd>{b.link ?? "—"}</dd>
          <dt className="text-muted-foreground">Hazırlayan</dt>
          <dd className="min-w-0 truncate">{b.createdBy ?? "—"}</dd>
          <dt className="text-muted-foreground">Oluşturuldu</dt>
          <dd>{fmtDateTime(b.createdAt)}</dd>
          {b.startedAt && (
            <>
              <dt className="text-muted-foreground">Başladı / bitti</dt>
              <dd>{fmtDateTime(b.startedAt)} · {b.finishedAt ? fmtDateTime(b.finishedAt) : "sürüyor"}</dd>
            </>
          )}
        </dl>

        {b.breakdown.some((r) => r.reason) && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-medium">Gitmeyenlerin nedeni</h3>
            <ul className="flex flex-wrap gap-1.5">
              {b.breakdown.filter((r) => r.reason).map((r) => (
                <li key={`${r.status}-${r.reason}`}>
                  <Badge variant="outline">{REASONS[r.reason!] ?? r.reason} · {fmtInt(r.count)}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {b.recent.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-medium">Son alıcılar</h3>
            <div className="max-h-72 overflow-y-auto rounded-lg border">
              <Table>
                <TableBody>
                  {b.recent.map((r) => (
                    <TableRow key={r.userId}>
                      <TableCell className="max-w-48 truncate pl-3 text-xs">{r.email ?? "Misafir"}</TableCell>
                      <TableCell className="text-xs">{DELIVERY[r.status] ?? r.status}{r.reason ? ` · ${REASONS[r.reason] ?? r.reason}` : ""}</TableCell>
                      <TableCell className="pr-3 text-right text-xs text-muted-foreground">{r.openedAt ? "Açtı" : ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {writer && editable && (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <Label htmlFor="schedule-at">Zamanla</Label>
            <div className="flex gap-2">
              <Input id="schedule-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="flex-1" />
              <Button variant="outline" disabled={busy || !at} onClick={() => act("schedule", { at: new Date(at).toISOString() }, "Zamanlandı.")}>
                <CalendarClock aria-hidden /> Zamanla
              </Button>
            </div>
            {b.kind === "MARKETING" && <p className="text-xs text-muted-foreground">Kampanya sessiz saatlere (21:00–09:00) denk gelirse 09:00&apos;a kayar.</p>}
          </div>
        )}
      </div>

      {writer && (
        <SheetFooter className="sticky bottom-0 mt-auto flex-row flex-wrap justify-end border-t bg-background">
          {b.status !== "SENDING" && (
            <Button variant="ghost" className="mr-auto text-danger" onClick={remove} disabled={busy}>
              Sil
            </Button>
          )}
          {cancellable && (
            <Button variant="outline" disabled={busy} onClick={() => act("cancel", undefined, "İptal edildi.")}>
              İptal et
            </Button>
          )}
          {editable && (
            <Button variant="outline" disabled={busy} onClick={() => onEdit(b)}>
              Düzenle
            </Button>
          )}
          {editable && (
            <Button disabled={busy} onClick={send}>
              <Send aria-hidden /> Şimdi gönder
            </Button>
          )}
        </SheetFooter>
      )}
    </>
  );
}

type Activity = "all" | "active" | "inactive";

function Composer({ initial, onSaved }: { initial: Broadcast | null; onSaved: (b: Broadcast) => void }) {
  const { toast } = useFeedback();
  const a0 = initial?.audience ?? {};
  const [kind, setKind] = useState<BroadcastKind>(initial?.kind ?? "SERVICE");
  const [channel, setChannel] = useState<BroadcastChannel>(initial?.channel ?? "PUSH");
  const email = channel === "EMAIL";
  const bodyMax = email ? 2000 : 300;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [link, setLink] = useState(initial?.link ?? NONE);
  const [plan, setPlan] = useState<string>(a0.plan ?? NONE);
  const [platform, setPlatform] = useState<string>(a0.platform ?? NONE);
  const [locale, setLocale] = useState<string>(a0.locale ?? NONE);
  const [accounts, setAccounts] = useState<string>(a0.accounts ?? "all");
  const [activity, setActivity] = useState<Activity>(a0.activeDays ? "active" : a0.inactiveDays ? "inactive" : "all");
  const [days, setDays] = useState(String(a0.activeDays ?? a0.inactiveDays ?? 14));
  const [after, setAfter] = useState(a0.registeredAfter ?? "");
  const [before, setBefore] = useState(a0.registeredBefore ?? "");
  const [emails, setEmails] = useState((a0.emails ?? []).join("\n"));
  const [testEmail, setTestEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const links = useApi<{ items: { path: string; label: string }[] }>("/broadcasts/links");
  const [estimate, setEstimate] = useState<{ withDevice: number; eligible: number } | null>(null);
  const [check, setCheck] = useState<{ signals: string[]; blocked: boolean } | null>(null);

  const emailList = emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const dayCount = Math.min(365, Math.max(1, Number.parseInt(days, 10) || 1));
  const audience: BroadcastAudience = {
    ...(plan !== NONE ? { plan: plan as "FREE" | "PRO" } : {}),
    ...(platform !== NONE && !email ? { platform: platform as "ios" | "android" } : {}),
    ...(locale !== NONE ? { locale: locale as Locale } : {}),
    accounts: accounts as "all" | "registered" | "guests",
    ...(activity === "active" ? { activeDays: dayCount } : activity === "inactive" ? { inactiveDays: dayCount } : {}),
    ...(after ? { registeredAfter: after } : {}),
    ...(before ? { registeredBefore: before } : {}),
    ...(emailList.length ? { emails: emailList } : {}),
  };
  const audienceKey = JSON.stringify(audience);
  const content = { title: title.trim(), body: body.trim(), link: link === NONE ? null : link, kind, channel };
  const contentKey = JSON.stringify(content);

  // Live audience size and commercial-text check, debounced while typing.
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ withDevice: number; eligible: number }>("/broadcasts/estimate", { method: "POST", body: { audience: JSON.parse(audienceKey), kind, channel } })
        .then(setEstimate)
        .catch(() => setEstimate(null));
    }, 500);
    return () => clearTimeout(t);
  }, [audienceKey, kind, channel]);
  useEffect(() => {
    const c = JSON.parse(contentKey) as typeof content;
    if (c.title.length < 3 || c.body.length < 5) return;
    const t = setTimeout(() => {
      api<{ signals: string[]; blocked: boolean }>("/broadcasts/precheck", { method: "POST", body: c })
        .then(setCheck)
        .catch(() => setCheck(null));
    }, 500);
    return () => clearTimeout(t);
  }, [contentKey]);

  const tooShort = content.title.length < 3 || content.body.length < 5 || content.body.length > bodyMax;
  const blocked = Boolean(check?.blocked && kind === "SERVICE");

  async function save() {
    setBusy(true);
    try {
      const payload = { ...content, audience };
      const out = initial
        ? await api<Broadcast>(`/broadcasts/${encodeURIComponent(initial.id)}`, { method: "PATCH", body: payload })
        : await api<Broadcast>("/broadcasts", { method: "POST", body: payload });
      toast("success", "Taslak kaydedildi. Göndermek ya da zamanlamak için raporu kullan.");
      onSaved(out);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const out = await api<{ devices: number; accepted: number }>("/broadcasts/test", { method: "POST", body: { ...content, email: testEmail.trim() } });
      toast("success", `Test bildirimi ${out.accepted}/${out.devices} cihaza gönderildi.`);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Gönderilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle>{initial ? "Gönderimi düzenle" : "Yeni gönderim"}</SheetTitle>
        <SheetDescription>Önce taslak olarak kaydedilir; gönderim ayrı bir onayla başlar.</SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-5 p-4">
        <div className="grid gap-2">
          <Label>Kanal</Label>
          <ToggleGroup type="single" variant="outline" size="sm" value={channel} onValueChange={(v) => v && setChannel(v as BroadcastChannel)} aria-label="Kanal" className="justify-start">
            <ToggleGroupItem value="PUSH" className="px-3">
              <Bell aria-hidden /> {CHANNEL.PUSH.label}
            </ToggleGroupItem>
            <ToggleGroupItem value="EMAIL" className="px-3">
              <Mail aria-hidden /> {CHANNEL.EMAIL.label}
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">{CHANNEL[channel].hint}</p>
        </div>

        <div className="grid gap-2">
          <Label>Tür</Label>
          <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={(v) => v && setKind(v as BroadcastKind)} aria-label="Tür" className="justify-start">
            {(Object.keys(KIND) as BroadcastKind[]).map((k) => (
              <ToggleGroupItem key={k} value={k} className="px-3">
                {KIND[k].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">{KIND[kind].hint}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
          <div className="flex flex-col gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="b-title">{email ? "Konu" : "Başlık"}</Label>
              <Input id="b-title" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Örn. Yeni stiller geldi" />
              <p className="text-xs text-muted-foreground">{title.trim().length}/80</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-body">{email ? "E-posta metni" : "Mesaj"}</Label>
              <Textarea id="b-body" rows={email ? 8 : 3} maxLength={bodyMax} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Örn. Kapadokya ve Ege stillerini stüdyoda dene." />
              <p className="text-xs text-muted-foreground">
                {body.trim().length}/{bodyMax} · {email ? "boş satır yeni paragraf açar; metin düz yazı olarak gönderilir" : "telefonda ilk ~120 karakter görünür"}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-link">{email ? "Düğmenin açacağı sayfa (web)" : "Dokununca açılacak yer"}</Label>
              <Select value={link} onValueChange={setLink}>
                <SelectTrigger id="b-link" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{email ? "Düğme olmasın" : "Uygulamanın ana ekranı"}</SelectItem>
                  {(links.data?.items ?? []).map((l) => (
                    <SelectItem key={l.path} value={l.path}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Önizleme</span>
            {email ? <EmailPreview title={title.trim()} body={body.trim()} link={link === NONE ? null : link} /> : <PhonePreview title={title.trim()} body={body.trim()} />}
          </div>
        </div>

        {check && check.signals.length > 0 && (
          <p className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${blocked ? "bg-danger/10 text-danger" : "bg-warn-soft text-warn"}`}>
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Ticari ifade bulundu: {check.signals.map((s) => SIGNALS[s] ?? s).join(", ")}.{" "}
              {blocked ? "Bu metin “Bilgilendirme” olarak gönderilemez; türü “Kampanya” seç (6563 sayılı Kanun / İYS)." : "Kampanya olarak yalnız izin verenlere gidecek."}
            </span>
          </p>
        )}

        <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Kitle</legend>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Choice id="a-plan" label="Plan" value={plan} onChange={setPlan} options={[[NONE, "Hepsi"], ["FREE", "Ücretsiz"], ["PRO", "PRO"]]} />
            {!email && <Choice id="a-platform" label="Platform" value={platform} onChange={setPlatform} options={[[NONE, "Hepsi"], ["ios", "iOS"], ["android", "Android"]]} />}
            <Choice id="a-locale" label="Dil" value={locale} onChange={setLocale} options={[[NONE, "Hepsi"], ...LOCALES.map((l) => [l, LOCALE_LABELS[l]] as [string, string])]} />
            <Choice id="a-accounts" label="Hesap" value={accounts} onChange={setAccounts} options={[["all", "Hepsi"], ["registered", "Kayıtlı"], ["guests", "Misafir"]]} />
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Choice
              id="a-activity"
              label="Etkinlik"
              value={activity}
              onChange={(v) => setActivity(v as Activity)}
              options={[["all", "Hepsi"], ["active", "Son N günde girenler"], ["inactive", "N gündür girmeyenler"]]}
            />
            <div className="grid gap-1.5">
              <Label htmlFor="a-days">N (gün)</Label>
              <Input id="a-days" type="number" min={1} max={365} value={days} disabled={activity === "all"} onChange={(e) => setDays(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="a-after">Kayıt tarihi (başlangıç)</Label>
              <Input id="a-after" type="date" value={after} onChange={(e) => setAfter(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="a-before">Kayıt tarihi (bitiş)</Label>
              <Input id="a-before" type="date" value={before} onChange={(e) => setBefore(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="a-emails">Yalnız şu kişiler (isteğe bağlı)</Label>
            <Textarea id="a-emails" rows={2} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="ornek@eposta.com, ikinci@eposta.com" />
          </div>
          <p className="flex items-center gap-1.5 text-sm">
            {email ? <Mail className="size-4 text-muted-foreground" aria-hidden /> : <Smartphone className="size-4 text-muted-foreground" aria-hidden />}
            {estimate ? (
              kind === "MARKETING" ? (
                <span>
                  <strong className="tabular-nums">{fmtInt(estimate.eligible)}</strong> kişi pazarlama izni vermiş · {email ? "e-postası doğrulanmış" : "cihazı kayıtlı"} {fmtInt(estimate.withDevice)} kişi
                </span>
              ) : (
                <span>
                  {email ? "E-postası doğrulanmış" : "Cihazı kayıtlı"} <strong className="tabular-nums">{fmtInt(estimate.withDevice)}</strong> kişi
                </span>
              )
            ) : (
              <span className="text-muted-foreground">Kitle hesaplanıyor…</span>
            )}
          </p>
        </fieldset>

        <div className="flex flex-col gap-1.5 rounded-lg border p-3">
          <Label htmlFor="t-email">Kendine test gönder</Label>
          <div className="flex gap-2">
            <Input id="t-email" type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="Uygulamada giriş yaptığın e-posta" className="flex-1" />
            <Button variant="outline" disabled={busy || tooShort || blocked || !testEmail.includes("@")} onClick={test}>
              Test gönder
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Yalnız o hesabın {email ? "e-posta adresine" : "cihazlarına"} “[Test]” önekiyle gider; rapora yazılmaz.</p>
        </div>
      </div>

      <SheetFooter className="sticky bottom-0 mt-auto flex-row justify-end border-t bg-background">
        <Button disabled={busy || tooShort || blocked} onClick={save}>
          {initial ? "Kaydet" : "Taslak kaydet"}
        </Button>
      </SheetFooter>
    </>
  );
}

function Choice({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

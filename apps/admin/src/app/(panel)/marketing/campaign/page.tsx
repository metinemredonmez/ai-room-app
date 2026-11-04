"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Megaphone, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { CharField, DRAFT_ERRORS, LocalePicker, StatusBadge, useDrafts } from "@/components/marketing";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, useApi } from "@/lib/api";
import { LOCALE_LABELS, type AdminMe, type BroadcastChannel, type BroadcastKind, type CampaignText, type Locale, type MarketingDraft } from "@/lib/types";

// Pazarlama → Kampanya metni (API.md §7.18): AI writes the Toplu Gönderim text per language; an approved text
// becomes a broadcast DRAFT for that language's users and is sent from the Toplu Gönderim screen.

const LIMITS: Record<BroadcastChannel, { title: number; body: number }> = { PUSH: { title: 50, body: 300 }, EMAIL: { title: 80, body: 2000 } };
const CHANNEL: Record<BroadcastChannel, string> = { PUSH: "Bildirim", EMAIL: "E-posta" };
const KIND: Record<BroadcastKind, { label: string; hint: string }> = {
  SERVICE: { label: "Bilgilendirme", hint: "Yeni stil, özellik, bakım. İndirim, fiyat, PRO çağrısı ya da aciliyet içeremez (İYS)." },
  MARKETING: { label: "Kampanya", hint: "Ticari ileti: yalnız pazarlama izni verenlere gider; sahte aciliyet ya da uydurma indirim yok." },
};
const NO_LINK = "none";

type CampaignDraft = MarketingDraft<CampaignText> & { input: { channel: BroadcastChannel; kind: BroadcastKind; goal: string } };

export default function CampaignPage() {
  const list = useDrafts<CampaignText>("campaign");
  const me = useApi<AdminMe>("/me");
  const [runOpen, setRunOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const items = list.items as CampaignDraft[];
  const open = items.find((d) => d.id === openId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kampanya metni"
        description="Toplu gönderim için bildirim ya da e-posta metni, her dil için ayrı. Onayladığın metinden o dildeki kullanıcılara giden bir gönderim taslağı açılır; gönderimi Toplu Gönderim ekranından kendin yaparsın."
        actions={
          <Button onClick={() => setRunOpen(true)}>
            <Sparkles className="size-4" /> Yeni metin yazdır
          </Button>
        }
      />
      {list.error && !list.data ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton className="h-80 w-full" />
      ) : !items.length ? (
        <Card className="p-0">
          <EmptyState title="Henüz metin yok" description="“Yeni metin yazdır” ile amacı yaz, kanal ve tür seç." />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dil</TableHead>
                <TableHead>Kanal / tür</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Başlık</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{LOCALE_LABELS[d.locale]}</TableCell>
                  <TableCell className="text-sm">
                    {CHANNEL[d.input.channel]} · {KIND[d.input.kind].label}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={d.status} />
                      {d.violations.includes("looks_commercial") && <span className="text-xs text-danger">Ticari ifade var</span>}
                      {d.output?.broadcastId && <span className="text-xs text-good">Gönderim taslağı açıldı</span>}
                      {d.status === "FAILED" && <span className="text-xs text-muted-foreground">{DRAFT_ERRORS[d.error ?? ""] ?? d.error}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-sm text-muted-foreground">{d.output?.title ?? d.input.goal}</TableCell>
                  <TableCell className="text-right">
                    {d.output && (
                      <Button size="sm" variant="outline" onClick={() => setOpenId(d.id)}>
                        Aç
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <RunSheet open={runOpen} onClose={() => setRunOpen(false)} onDone={list.reload} />
      {open && <TextSheet key={open.id} draft={open} approver={me.data?.role === "ADMIN" || me.data?.role === "SUPER_ADMIN"} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </div>
  );
}

function RunSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const [locales, setLocales] = useState<Locale[]>(["tr"]);
  const [channel, setChannel] = useState<BroadcastChannel>("PUSH");
  const [kind, setKind] = useState<BroadcastKind>("SERVICE");
  const [goal, setGoal] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await api("/marketing/campaign", { method: "POST", body: { locales, channel, kind, goal } });
      toast("success", `${locales.length} dil için yazılıyor.`);
      onDone();
      onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Başlatılamadı.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Yeni kampanya metni</SheetTitle>
          <SheetDescription>Dil başına bir metin; yaklaşık 0,01 $. Ticari ifade kontrolü taslakta da yapılır.</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kanal</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as BroadcastChannel)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUSH">Bildirim</SelectItem>
                  <SelectItem value="EMAIL">E-posta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tür</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as BroadcastKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SERVICE">Bilgilendirme</SelectItem>
                  <SelectItem value="MARKETING">Kampanya</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{KIND[kind].hint}</p>
          <LocalePicker value={locales} onChange={setLocales} />
          <div className="space-y-1.5">
            <Label htmlFor="c-goal">Amaç</Label>
            <Textarea id="c-goal" rows={4} maxLength={1000} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ör. Kapadokya ve Ege stillerinin geldiğini duyur, stüdyoya çağır." />
          </div>
        </div>
        <SheetFooter>
          <Button onClick={submit} disabled={saving || !locales.length || goal.trim().length < 5}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {locales.length} dil için yazdır
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function TextSheet({ draft, approver, onClose, onChanged }: { draft: CampaignDraft; approver: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const links = useApi<{ items: Array<{ path: string; label: string }> }>("/broadcasts/links");
  const lim = LIMITS[draft.input.channel];
  const [form, setForm] = useState({ title: draft.output!.title, body: draft.output!.body, link: draft.output!.link });
  const [saving, setSaving] = useState(false);
  const original = { title: draft.output!.title, body: draft.output!.body, link: draft.output!.link };
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const editable = draft.status === "READY" || draft.status === "APPROVED";
  const invalid = form.title.trim().length < 3 || form.title.length > lim.title || form.body.trim().length < 5 || form.body.length > lim.body;
  const commercial = draft.violations.includes("looks_commercial");

  async function act(path: "save" | "approve" | "archive" | "broadcast") {
    setSaving(true);
    try {
      if (path === "save") await api(`/marketing/drafts/${draft.id}`, { method: "PATCH", body: { output: form } });
      else await api(`/marketing/drafts/${draft.id}/${path}`, { method: "POST" });
      toast("success", { save: "Kaydedildi.", approve: "Onaylandı.", archive: "Arşivlendi.", broadcast: "Toplu Gönderim'de taslak açıldı." }[path]);
      onChanged();
      if (path === "archive") onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem yapılamadı.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {LOCALE_LABELS[draft.locale]} · {CHANNEL[draft.input.channel]} · {KIND[draft.input.kind].label} <StatusBadge status={draft.status} />
          </SheetTitle>
          <SheetDescription>Amaç: {draft.input.goal}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          {commercial && (
            <p className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Bilgilendirme metninde ticari ifade var ({draft.output?.signals?.join(", ")}). Metni değiştir ya da türü “Kampanya” olan yeni bir metin yazdır.
            </p>
          )}
          <CharField id="c-title" label={draft.input.channel === "EMAIL" ? "Konu" : "Başlık"} value={form.title} max={lim.title} readOnly={!editable} onChange={(v) => setForm({ ...form, title: v })} />
          <CharField id="c-body" label="Metin" value={form.body} max={lim.body} rows={draft.input.channel === "EMAIL" ? 10 : 4} readOnly={!editable} onChange={(v) => setForm({ ...form, body: v })} hint={draft.input.channel === "EMAIL" ? "Boş satır yeni paragraf açar." : "Bildirimde ilk ~120 karakter görünür."} />
          <div className="space-y-1.5">
            <Label>Bağlantı</Label>
            <Select value={form.link ?? NO_LINK} onValueChange={(v) => setForm({ ...form, link: v === NO_LINK ? null : v })} disabled={!editable}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LINK}>Bağlantı yok</SelectItem>
                {(links.data?.items ?? []).map((l) => (
                  <SelectItem key={l.path} value={l.path} disabled={draft.input.kind === "SERVICE" && l.path === "/fiyatlar"}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {draft.output?.broadcastId && (
            <Link href="/broadcasts" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              <ExternalLink className="size-4" /> Toplu Gönderim ekranında aç
            </Link>
          )}
        </div>
        <SheetFooter className="flex-row flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={saving}
            onClick={async () => {
              if (await confirm({ title: "Metin arşivlensin mi?", confirmLabel: "Arşivle", destructive: true })) await act("archive");
            }}
          >
            Arşivle
          </Button>
          {editable && !draft.output?.broadcastId && (
            <Button variant="outline" onClick={() => act("save")} disabled={saving || !dirty || invalid}>
              Kaydet
            </Button>
          )}
          {draft.status === "READY" && (
            <Button onClick={() => act("approve")} disabled={saving || dirty || invalid || commercial || !approver} title={approver ? undefined : "Onay için ADMIN rolü gerekir"}>
              <CheckCircle2 className="size-4" /> Onayla
            </Button>
          )}
          {draft.status === "APPROVED" && !draft.output?.broadcastId && (
            <Button onClick={() => act("broadcast")} disabled={saving || dirty || !approver}>
              <Megaphone className="size-4" /> Gönderim taslağı aç
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

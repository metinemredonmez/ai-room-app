"use client";

import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { LOCALES, LOCALE_LABELS, type AdminMe, type AsoField, type AsoListing, type Locale, type MarketingDraft, type MarketingDraftStatus } from "@/lib/types";

// Pazarlama → Mağaza metni (API.md §7.18). The AI writes, the owner edits and approves, then uploads the export.

const FIELDS: Array<{ key: AsoField; label: string; max: number; rows?: number; hint?: string }> = [
  { key: "app_name", label: "Uygulama adı", max: 30 },
  { key: "app_subtitle", label: "Alt başlık", max: 30 },
  { key: "app_keywords", label: "Anahtar kelimeler", max: 100, hint: "Virgülle, boşluksuz. Ad ve alt başlıktaki sözcükleri tekrar etme." },
  { key: "app_promo", label: "Tanıtım metni", max: 170, rows: 3, hint: "Sürüm göndermeden değiştirilebilir." },
  { key: "app_description", label: "Açıklama", max: 4000, rows: 10 },
  { key: "app_whats_new", label: "Yenilikler", max: 4000, rows: 3, hint: "Google Play'de de kullanılır." },
  { key: "play_title", label: "Başlık", max: 30 },
  { key: "play_short", label: "Kısa açıklama", max: 80 },
  { key: "play_description", label: "Tam açıklama", max: 4000, rows: 10 },
];
const APP_STORE = FIELDS.slice(0, 6);
const PLAY = FIELDS.slice(6);

const STATUS: Record<MarketingDraftStatus, { label: string; className: string }> = {
  PENDING: { label: "Yazılıyor", className: "bg-warn-soft text-warn" },
  READY: { label: "Onay bekliyor", className: "bg-primary/10 text-primary" },
  FAILED: { label: "Başarısız", className: "bg-danger/10 text-danger" },
  APPROVED: { label: "Onaylı", className: "bg-good-soft text-good" },
  ARCHIVED: { label: "Arşiv", className: "bg-secondary text-secondary-foreground" },
};
const ERRORS: Record<string, string> = {
  ai_unavailable: "Yapay zekâ yanıt vermedi",
  timeout: "Zaman aşımı",
  internal: "Beklenmeyen hata",
};

const canApprove = (me: AdminMe | null) => me?.role === "ADMIN" || me?.role === "SUPER_ADMIN";

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AsoPage() {
  const list = useApi<{ items: MarketingDraft[] }>("/marketing/drafts", { kind: "aso" });
  const me = useApi<AdminMe>("/me");
  const { toast } = useFeedback();
  const [runOpen, setRunOpen] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const pending = items.some((d) => d.status === "PENDING");
  const { reload } = list;
  // Drafts are written in the background: refresh while any language is still being written.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [pending, reload]);

  const byLocale = useMemo(() => {
    const m = new Map<Locale, { latest?: MarketingDraft; approved?: MarketingDraft; count: number }>();
    for (const l of LOCALES) m.set(l, { count: 0 });
    for (const d of items) {
      const row = m.get(d.locale);
      if (!row) continue;
      row.count++;
      if (!row.latest) row.latest = d;
      if (d.status === "APPROVED" && !row.approved) row.approved = d;
    }
    return m;
  }, [items]);
  const approvedCount = [...byLocale.values()].filter((r) => r.approved).length;
  const open = items.find((d) => d.id === openId) ?? null;

  async function exportFiles() {
    try {
      const out = await api<{ locales: string[]; appStore: unknown; googlePlay: unknown }>("/marketing/aso/export");
      if (!out.locales.length) return toast("error", "Onaylı dil yok; önce bir taslağı onayla.");
      download("store.config.json", out.appStore);
      download("google-play.json", out.googlePlay);
      toast("success", `${out.locales.length} dil indirildi.`);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İndirilemedi.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mağaza metni"
        description="App Store ve Google Play metinleri, 11 dilde. Yapay zekâ taslak yazar; sen düzenleyip onaylarsın. Mağazaya yüklemeyi sen yaparsın, buradan hiçbir şey yayınlanmaz."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setFactsOpen(true)}>
              <FileText className="size-4" /> Bilgi sayfası
            </Button>
            <Button variant="outline" onClick={exportFiles} disabled={!approvedCount}>
              <Download className="size-4" /> Dışa aktar ({approvedCount})
            </Button>
            <Button onClick={() => setRunOpen(true)}>
              <Sparkles className="size-4" /> Yeni metin yazdır
            </Button>
          </div>
        }
      />

      {list.error && !list.data ? (
        <ErrorState message={list.error.message} onRetry={reload} />
      ) : !list.data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dil</TableHead>
                <TableHead>Son taslak</TableHead>
                <TableHead>Onaylı metin</TableHead>
                <TableHead className="text-right">Maliyet</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {LOCALES.map((l) => {
                const row = byLocale.get(l)!;
                const d = row.latest;
                return (
                  <TableRow key={l}>
                    <TableCell className="font-medium">{LOCALE_LABELS[l]}</TableCell>
                    <TableCell>
                      {d ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={STATUS[d.status].className}>
                            {d.status === "PENDING" && <Loader2 className="size-3 animate-spin" />}
                            {STATUS[d.status].label}
                          </Badge>
                          {d.violations.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-danger">
                              <AlertTriangle className="size-3" /> {d.violations.length} alan sınırı aşıyor
                            </span>
                          )}
                          {d.status === "FAILED" && <span className="text-xs text-muted-foreground">{ERRORS[d.error ?? ""] ?? d.error}</span>}
                          <span className="text-xs text-muted-foreground">{fmtDateTime(d.createdAt)}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Henüz yok</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.approved ? (
                        <button type="button" className="inline-flex items-center gap-1 text-sm text-good hover:underline" onClick={() => setOpenId(row.approved!.id)}>
                          <CheckCircle2 className="size-4" /> {row.approved.output?.app_name}
                        </button>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{d && d.costUsd > 0 ? `$${d.costUsd.toFixed(3)}` : "—"}</TableCell>
                    <TableCell className="text-right">
                      {d && d.status !== "PENDING" && d.output && (
                        <Button size="sm" variant="outline" onClick={() => setOpenId(d.id)}>
                          Aç
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!items.length && <EmptyState title="Henüz taslak yok" description="“Yeni metin yazdır” ile istediğin diller için taslak hazırlat." />}
        </Card>
      )}

      <RunSheet open={runOpen} onClose={() => setRunOpen(false)} onDone={reload} busy={items.filter((d) => d.status === "PENDING").map((d) => d.locale)} />
      <FactsSheet open={factsOpen} onClose={() => setFactsOpen(false)} />
      <DraftSheet key={open?.id ?? "none"} draft={open} approver={canApprove(me.data)} onClose={() => setOpenId(null)} onChanged={reload} />
    </div>
  );
}

function RunSheet({ open, onClose, onDone, busy }: { open: boolean; onClose: () => void; onDone: () => void; busy: Locale[] }) {
  const { toast } = useFeedback();
  const [locales, setLocales] = useState<Locale[]>([...LOCALES]);
  const [brief, setBrief] = useState("");
  const [whatsNew, setWhatsNew] = useState("");
  const [saving, setSaving] = useState(false);
  const chosen = locales.filter((l) => !busy.includes(l));

  async function submit() {
    setSaving(true);
    try {
      await api("/marketing/aso", { method: "POST", body: { locales: chosen, ...(brief.trim() ? { brief } : {}), ...(whatsNew.trim() ? { whatsNew } : {}) } });
      toast("success", `${chosen.length} dil için yazım başladı. Birkaç dakika sürer.`);
      onDone();
      onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Başlatılamadı.");
    } finally {
      setSaving(false);
    }
  }

  const toggle = (l: Locale) => setLocales((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l]));
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Yeni metin yazdır</SheetTitle>
          <SheetDescription>
            Her dil kendi pazarı için ayrı yazılır (çeviri değil). Yapay zekâ yalnız bilgi sayfasındaki gerçekleri kullanır; fiyat yazmaz. Dil başına yaklaşık 0,07–0,15 $.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Diller</Label>
              <div className="flex gap-2 text-xs">
                <button type="button" className="text-primary hover:underline" onClick={() => setLocales([...LOCALES])}>Hepsi</button>
                <button type="button" className="text-primary hover:underline" onClick={() => setLocales([])}>Hiçbiri</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LOCALES.map((l) => (
                <label key={l} className={`flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm ${busy.includes(l) ? "opacity-50" : ""}`}>
                  <input type="checkbox" checked={locales.includes(l) && !busy.includes(l)} disabled={busy.includes(l)} onChange={() => toggle(l)} />
                  {LOCALE_LABELS[l]}
                </label>
              ))}
            </div>
            {busy.length > 0 && <p className="text-xs text-muted-foreground">Yazılmakta olan diller seçilemez.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aso-brief">Not (isteğe bağlı)</Label>
            <Textarea id="aso-brief" rows={4} maxLength={1000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Ör. Küçük daireler ve kiracılar öne çıksın; mimarlara da hitap etsin." />
            <p className="text-right text-xs text-muted-foreground">{brief.length}/1000</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aso-new">Bu sürümdeki yenilikler (isteğe bağlı)</Label>
            <Textarea id="aso-new" rows={3} maxLength={1000} value={whatsNew} onChange={(e) => setWhatsNew(e.target.value)} placeholder="Ör. Dokunarak seçim: fotoğraftaki tek bir eşyayı değiştir. 11 dil." />
            <p className="text-right text-xs text-muted-foreground">{whatsNew.length}/1000</p>
          </div>
        </div>
        <SheetFooter>
          <Button onClick={submit} disabled={saving || !chosen.length}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {chosen.length} dil için yazdır
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FactsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const facts = useApi<{ facts: string }>(open ? "/marketing/facts" : null);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Bilgi sayfası</SheetTitle>
          <SheetDescription>Yapay zekâya verilen gerçekler. Katalogdan ve ayarlardan otomatik üretilir; burada olmayan bir özelliği yazmaz.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {facts.error ? (
            <ErrorState message={facts.error.message} onRetry={facts.reload} />
          ) : !facts.data ? (
            <Skeleton className="h-80 w-full" />
          ) : (
            <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-relaxed">{facts.data.facts}</pre>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DraftSheet({ draft, approver, onClose, onChanged }: { draft: MarketingDraft | null; approver: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [form, setForm] = useState<AsoListing | null>(draft?.output ?? null);
  const [saving, setSaving] = useState(false);
  if (!draft || !form) return null;

  const dirty = JSON.stringify(form) !== JSON.stringify(draft.output);
  const over = FIELDS.filter((f) => form[f.key].length > f.max || !form[f.key].trim());
  const editable = draft.status === "READY" || draft.status === "APPROVED";

  async function act(path: "save" | "approve" | "archive") {
    setSaving(true);
    try {
      if (path === "save") await api(`/marketing/drafts/${draft!.id}`, { method: "PATCH", body: { output: form } });
      else await api(`/marketing/drafts/${draft!.id}/${path}`, { method: "POST" });
      toast("success", path === "save" ? "Kaydedildi." : path === "approve" ? "Onaylandı; dışa aktarmada bu metin kullanılır." : "Arşivlendi.");
      onChanged();
      if (path !== "save") onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem yapılamadı.");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (await confirm({ title: "Taslak arşivlensin mi?", description: "Listeden kalkar; onaylıysa dışa aktarmaya girmez.", confirmLabel: "Arşivle", destructive: true })) await act("archive");
  }

  const fieldView = (f: (typeof FIELDS)[number]) => {
    const value = form[f.key];
    const bad = value.length > f.max || !value.trim();
    const props = {
      id: `aso-${f.key}`,
      value,
      readOnly: !editable,
      "aria-invalid": bad,
      onChange: (e: { target: { value: string } }) => setForm({ ...form, [f.key]: e.target.value }),
    };
    return (
      <div key={f.key} className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={props.id}>{f.label}</Label>
          <span className={`tabular-nums text-xs ${bad ? "font-medium text-danger" : "text-muted-foreground"}`}>
            {value.length}/{f.max}
          </span>
        </div>
        {f.rows ? <Textarea rows={f.rows} {...props} /> : <Input {...props} />}
        {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
      </div>
    );
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {LOCALE_LABELS[draft.locale]} <Badge className={STATUS[draft.status].className}>{STATUS[draft.status].label}</Badge>
          </SheetTitle>
          <SheetDescription>
            {fmtDateTime(draft.createdAt)}
            {draft.input.brief ? ` · Not: ${draft.input.brief}` : ""}
            {draft.status === "APPROVED" ? " · Düzenlersen yeniden onay gerekir." : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-4">
          {over.length > 0 && (
            <p className="flex items-center gap-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertTriangle className="size-4 shrink-0" /> Sınırı aşan ya da boş alan: {over.map((f) => f.label).join(", ")}. Kısaltmadan onaylanamaz.
            </p>
          )}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold">App Store</h3>
            {APP_STORE.map(fieldView)}
          </section>
          <section className="space-y-4">
            <h3 className="text-sm font-semibold">Google Play</h3>
            {PLAY.map(fieldView)}
          </section>
        </div>
        <SheetFooter className="flex-row flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={archive} disabled={saving}>
            Arşivle
          </Button>
          {editable && (
            <Button variant="outline" onClick={() => act("save")} disabled={saving || !dirty || over.length > 0}>
              Kaydet
            </Button>
          )}
          {draft.status === "READY" && (
            <Button onClick={() => act("approve")} disabled={saving || dirty || over.length > 0 || !approver} title={approver ? undefined : "Onay için ADMIN rolü gerekir"}>
              <CheckCircle2 className="size-4" /> Onayla
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

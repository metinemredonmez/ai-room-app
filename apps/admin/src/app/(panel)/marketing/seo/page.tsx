"use client";

import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { ErrorState, PageHeader } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { CharField, DRAFT_ERRORS, LocalePicker, StatusBadge, useDrafts } from "@/components/marketing";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { LOCALES, LOCALE_LABELS, type AdminMe, type Locale, type MarketingDraft } from "@/lib/types";

// Pazarlama → SEO (API.md §7.18): page titles and meta descriptions per language; the approved text is used by
// casalume.app within a few minutes (the site's own texts are the fallback).

type SeoOutput = { pages: Array<{ key: string; title: string; description: string }> };
const PAGES: Record<string, string> = { home: "Ana sayfa", studio: "Stüdyo", pricing: "Fiyatlar", chat: "AI Sohbet", blog: "Blog" };

export default function SeoPage() {
  const drafts = useDrafts<SeoOutput>("seo");
  const me = useApi<AdminMe>("/me");
  const [runOpen, setRunOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const byLocale = useMemo(() => {
    const m = new Map<Locale, { latest?: MarketingDraft<SeoOutput>; approved?: MarketingDraft<SeoOutput> }>();
    for (const l of LOCALES) m.set(l, {});
    for (const d of drafts.items) {
      const row = m.get(d.locale);
      if (!row) continue;
      row.latest ??= d;
      if (d.status === "APPROVED") row.approved ??= d;
    }
    return m;
  }, [drafts.items]);
  const open = drafts.items.find((d) => d.id === openId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="SEO"
        description="Ana sayfa, stüdyo, fiyatlar, sohbet ve blog için her dilde Google başlığı ve açıklaması. Onayladığın metin birkaç dakika içinde sitede kullanılır; onay yoksa sitenin kendi metni geçerli."
        actions={
          <Button onClick={() => setRunOpen(true)}>
            <Sparkles className="size-4" /> Yeni öneri yazdır
          </Button>
        }
      />
      {drafts.error && !drafts.data ? (
        <ErrorState message={drafts.error.message} onRetry={drafts.reload} />
      ) : !drafts.data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dil</TableHead>
                <TableHead>Son öneri</TableHead>
                <TableHead>Sitede kullanılan</TableHead>
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
                          <StatusBadge status={d.status} />
                          {d.violations.length > 0 && <span className="text-xs text-danger">{d.violations.length} sorun</span>}
                          {d.status === "FAILED" && <span className="text-xs text-muted-foreground">{DRAFT_ERRORS[d.error ?? ""] ?? d.error}</span>}
                          <span className="text-xs text-muted-foreground">{fmtDateTime(d.createdAt)}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Henüz yok</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-72 truncate text-sm">
                      {row.approved ? row.approved.output?.pages.find((p) => p.key === "home")?.title : <span className="text-muted-foreground">Sitenin kendi metni</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {d && d.output && d.status !== "PENDING" && (
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
        </Card>
      )}
      <RunSheet open={runOpen} onClose={() => setRunOpen(false)} onDone={drafts.reload} />
      {open && <SeoSheet key={open.id} draft={open} approver={me.data?.role === "ADMIN" || me.data?.role === "SUPER_ADMIN"} onClose={() => setOpenId(null)} onChanged={drafts.reload} />}
    </div>
  );
}

function RunSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const [locales, setLocales] = useState<Locale[]>([...LOCALES]);
  const [saving, setSaving] = useState(false);
  async function submit() {
    setSaving(true);
    try {
      await api("/marketing/seo", { method: "POST", body: { locales } });
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
          <SheetTitle>Yeni SEO önerisi</SheetTitle>
          <SheetDescription>Dil başına 5 sayfanın başlığı ve açıklaması; dil başına yaklaşık 0,02 $.</SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <LocalePicker value={locales} onChange={setLocales} />
        </div>
        <SheetFooter>
          <Button onClick={submit} disabled={saving || !locales.length}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {locales.length} dil için yazdır
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function SeoSheet({ draft, approver, onClose, onChanged }: { draft: MarketingDraft<SeoOutput>; approver: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useFeedback();
  const initial = Object.keys(PAGES).map((key) => draft.output?.pages.find((p) => p.key === key) ?? { key, title: "", description: "" });
  const [pages, setPages] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(pages) !== JSON.stringify(initial);
  const editable = draft.status === "READY" || draft.status === "APPROVED";
  const invalid = pages.some((p) => p.title.trim().length < 5 || p.title.length > 60 || p.description.trim().length < 50 || p.description.length > 160);
  const set = (i: number, patch: Partial<(typeof pages)[number]>) => setPages(pages.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  async function act(path: "save" | "approve" | "archive") {
    setSaving(true);
    try {
      if (path === "save") await api(`/marketing/drafts/${draft.id}`, { method: "PATCH", body: { output: { pages } } });
      else await api(`/marketing/drafts/${draft.id}/${path}`, { method: "POST" });
      toast("success", { save: "Kaydedildi.", approve: "Onaylandı; birkaç dakika içinde sitede.", archive: "Arşivlendi." }[path]);
      onChanged();
      if (path !== "save") onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem yapılamadı.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {LOCALE_LABELS[draft.locale]} <StatusBadge status={draft.status} />
          </SheetTitle>
          <SheetDescription>Ana sayfa dışındaki başlıklara site “ · Casalume” ekler.</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-4">
          {pages.map((p, i) => (
            <section key={p.key} className="space-y-3">
              <h3 className="text-sm font-semibold">{PAGES[p.key]}</h3>
              <CharField id={`seo-${p.key}-t`} label="Başlık" value={p.title} max={60} readOnly={!editable} onChange={(v) => set(i, { title: v })} />
              <CharField id={`seo-${p.key}-d`} label="Açıklama" value={p.description} max={160} rows={2} readOnly={!editable} onChange={(v) => set(i, { description: v })} />
            </section>
          ))}
        </div>
        <SheetFooter className="flex-row flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => act("archive")} disabled={saving}>
            Arşivle
          </Button>
          {editable && (
            <Button variant="outline" onClick={() => act("save")} disabled={saving || !dirty || invalid}>
              Kaydet
            </Button>
          )}
          {draft.status === "READY" && (
            <Button onClick={() => act("approve")} disabled={saving || dirty || invalid || draft.violations.length > 0 || !approver} title={approver ? undefined : "Onay için ADMIN rolü gerekir"}>
              <CheckCircle2 className="size-4" /> Onayla
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

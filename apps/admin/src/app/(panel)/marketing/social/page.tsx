"use client";

import { AlertTriangle, CheckCircle2, Copy, Download, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { CharField, DRAFT_ERRORS, LocalePicker, StatusBadge, downloadDataUrl, useDrafts } from "@/components/marketing";
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
import { LOCALE_LABELS, type AdminMe, type Locale, type MarketingDraft, type Platform, type SocialPost } from "@/lib/types";

// Pazarlama → Sosyal medya (API.md §7.18): before/after image of our own sample room + caption per language.

const PLATFORMS: Record<Platform, { label: string; format: Format; caption: number }> = {
  instagram: { label: "Instagram", format: "square", caption: 2200 },
  tiktok: { label: "TikTok", format: "story", caption: 2200 },
  pinterest: { label: "Pinterest", format: "pin", caption: 500 },
};
type Format = "square" | "story" | "pin";
const FORMATS: Record<Format, string> = { square: "Kare 1080×1080", story: "Story 1080×1920", pin: "Pinterest 1000×1500" };
const MAX_RUN = 30;

type SocialDraft = MarketingDraft<SocialPost> & { input: { styleId: string; platform: Platform; brief: string | null } };
type StyleOption = { id: string; name: string; previewUrl: string };

export default function SocialPage() {
  const list = useDrafts<SocialPost>("social");
  const styles = useApi<{ items: StyleOption[] }>("/marketing/social/styles");
  const me = useApi<AdminMe>("/me");
  const [runOpen, setRunOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const items = list.items as SocialDraft[];
  const styleName = (id: string) => styles.data?.items.find((s) => s.id === id)?.name ?? id;
  const open = items.find((d) => d.id === openId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sosyal medya"
        description="Önce/sonra görseli ve her dil için açıklama. Görseller kendi örnek odamızdan ve stil fotoğraflarımızdan; kullanıcı fotoğrafı kullanılmaz. Paylaşımı sen yaparsın; TikTok'ta “AI ile oluşturuldu” etiketini açmayı unutma."
        actions={
          <Button onClick={() => setRunOpen(true)}>
            <Sparkles className="size-4" /> Yeni gönderi yazdır
          </Button>
        }
      />
      {list.error && !list.data ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton className="h-80 w-full" />
      ) : !items.length ? (
        <Card className="p-0">
          <EmptyState title="Henüz gönderi yok" description="“Yeni gönderi yazdır” ile stil, platform ve dil seç." />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stil</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Dil</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Başlık</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{styleName(d.input.styleId)}</TableCell>
                  <TableCell>{PLATFORMS[d.input.platform]?.label ?? d.input.platform}</TableCell>
                  <TableCell>{LOCALE_LABELS[d.locale]}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={d.status} />
                      {d.violations.length > 0 && <AlertTriangle className="size-4 text-danger" aria-label="Sınırı aşan alan var" />}
                      {d.status === "FAILED" && <span className="text-xs text-muted-foreground">{DRAFT_ERRORS[d.error ?? ""] ?? d.error}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-sm text-muted-foreground">{d.output?.title ?? fmtDateTime(d.createdAt)}</TableCell>
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
      <RunSheet open={runOpen} styles={styles.data?.items ?? []} onClose={() => setRunOpen(false)} onDone={list.reload} />
      {open && <PostSheet key={open.id} draft={open} styleName={styleName(open.input.styleId)} approver={me.data?.role === "ADMIN" || me.data?.role === "SUPER_ADMIN"} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </div>
  );
}

function RunSheet({ open, styles, onClose, onDone }: { open: boolean; styles: StyleOption[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const [styleIds, setStyleIds] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>(["instagram"]);
  const [locales, setLocales] = useState<Locale[]>(["tr"]);
  const [brief, setBrief] = useState("");
  const [saving, setSaving] = useState(false);
  const count = styleIds.length * platforms.length * locales.length;

  async function submit() {
    setSaving(true);
    try {
      await api("/marketing/social", { method: "POST", body: { styleIds, platforms, locales, ...(brief.trim() ? { brief } : {}) } });
      toast("success", `${count} gönderi yazılıyor.`);
      onDone();
      onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Başlatılamadı.");
    } finally {
      setSaving(false);
    }
  }

  const toggleStyle = (id: string) => setStyleIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 5 ? s : [...s, id]));
  const togglePlatform = (p: Platform) => setPlatforms((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Yeni gönderi yazdır</SheetTitle>
          <SheetDescription>Stil × platform × dil başına bir gönderi (en çok {MAX_RUN}). Gönderi başına yaklaşık 0,02 $.</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4">
          <div className="space-y-2">
            <Label>Stiller (en çok 5)</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {styles.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleStyle(s.id)}
                  className={`overflow-hidden rounded-md border text-left text-sm ${styleIds.includes(s.id) ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- public style preview from the API */}
                  <img src={s.previewUrl} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
                  <span className="block px-2 py-1.5">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Platformlar</Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PLATFORMS) as Platform[]).map((p) => (
                <label key={p} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                  <input type="checkbox" checked={platforms.includes(p)} onChange={() => togglePlatform(p)} />
                  {PLATFORMS[p].label}
                </label>
              ))}
            </div>
          </div>
          <LocalePicker value={locales} onChange={setLocales} />
          <div className="space-y-1.5">
            <Label htmlFor="social-brief">Not (isteğe bağlı)</Label>
            <Textarea id="social-brief" rows={3} maxLength={1000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Ör. Küçük salonlar için; sıcak bir ton." />
          </div>
        </div>
        <SheetFooter>
          {count > MAX_RUN && <p className="text-sm text-danger">En çok {MAX_RUN} gönderi; seçimi azalt.</p>}
          <Button onClick={submit} disabled={saving || !count || count > MAX_RUN}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {count} gönderi yazdır
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function PostSheet({ draft, styleName, approver, onClose, onChanged }: { draft: SocialDraft; styleName: string; approver: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const platform = PLATFORMS[draft.input.platform] ?? PLATFORMS.instagram;
  const [format, setFormat] = useState<Format>(platform.format);
  const [image, setImage] = useState<{ format: Format; dataUrl: string } | null>(null);
  const [form, setForm] = useState<SocialPost>(draft.output!);
  const [tags, setTags] = useState(draft.output!.hashtags.join(" "));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    api<{ dataUrl: string }>(`/marketing/drafts/${draft.id}/image`, { query: { format }, signal: ctrl.signal })
      .then((r) => setImage({ format, dataUrl: r.dataUrl }))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [draft.id, format]);

  const hashtags = tags.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean);
  const value: SocialPost = { ...form, hashtags };
  const dirty = JSON.stringify(value) !== JSON.stringify(draft.output);
  const editable = draft.status === "READY" || draft.status === "APPROVED";
  const badTags = hashtags.length > 5 || hashtags.some((t) => !/^[\p{L}\p{N}_]{1,40}$/u.test(t));
  const invalid = badTags || !form.title.trim() || form.title.length > 100 || !form.caption.trim() || form.caption.length > platform.caption || !form.alt_text.trim() || form.alt_text.length > 250;
  const fullText = `${form.caption}\n\n${hashtags.map((t) => `#${t}`).join(" ")}`;

  async function act(path: "save" | "approve" | "archive") {
    setSaving(true);
    try {
      if (path === "save") await api(`/marketing/drafts/${draft.id}`, { method: "PATCH", body: { output: value } });
      else await api(`/marketing/drafts/${draft.id}/${path}`, { method: "POST" });
      toast("success", path === "save" ? "Kaydedildi." : path === "approve" ? "Onaylandı." : "Arşivlendi.");
      onChanged();
      if (path !== "save") onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem yapılamadı.");
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullText);
      toast("success", "Açıklama ve etiketler kopyalandı.");
    } catch {
      toast("error", "Kopyalanamadı; metni elle seç.");
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {styleName} · {platform.label} · {LOCALE_LABELS[draft.locale]} <StatusBadge status={draft.status} />
          </SheetTitle>
          <SheetDescription>{draft.input.brief ? `Not: ${draft.input.brief}` : fmtDateTime(draft.createdAt)}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-6 px-4 pb-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {(Object.keys(FORMATS) as Format[]).map((f) => (
                <Button key={f} size="sm" variant={format === f ? "default" : "outline"} onClick={() => setFormat(f)}>
                  {FORMATS[f]}
                </Button>
              ))}
            </div>
            {image?.format === format ? (
              // eslint-disable-next-line @next/next/no-img-element -- generated data URL
              <img src={image.dataUrl} alt={form.alt_text} className="w-full rounded-md border border-border" />
            ) : (
              <Skeleton className="aspect-square w-full" />
            )}
            <Button variant="outline" className="w-full" disabled={image?.format !== format} onClick={() => image && downloadDataUrl(`casalume-${draft.input.styleId}-${format}.jpg`, image.dataUrl)}>
              <Download className="size-4" /> Görseli indir
            </Button>
          </div>
          <div className="space-y-4">
            <CharField id="s-title" label={draft.input.platform === "pinterest" ? "Pin başlığı" : "Başlık / ilk cümle"} value={form.title} max={100} readOnly={!editable} onChange={(v) => setForm({ ...form, title: v })} />
            <CharField id="s-caption" label="Açıklama" value={form.caption} max={platform.caption} rows={8} readOnly={!editable} onChange={(v) => setForm({ ...form, caption: v })} />
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="s-tags">Etiketler</Label>
                <span className={`text-xs ${badTags ? "font-medium text-danger" : "text-muted-foreground"}`}>{hashtags.length}/5</span>
              </div>
              <Input id="s-tags" value={tags} readOnly={!editable} onChange={(e) => setTags(e.target.value)} aria-invalid={badTags} />
              <p className="text-xs text-muted-foreground"># olmadan, boşlukla ayır; harf, rakam ya da _.</p>
            </div>
            <CharField id="s-alt" label="Görsel açıklaması (erişilebilirlik)" value={form.alt_text} max={250} rows={2} readOnly={!editable} onChange={(v) => setForm({ ...form, alt_text: v })} />
            <Button variant="outline" onClick={copy}>
              <Copy className="size-4" /> Açıklama + etiketleri kopyala
            </Button>
          </div>
        </div>
        <SheetFooter className="flex-row flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={saving}
            onClick={async () => {
              if (await confirm({ title: "Gönderi arşivlensin mi?", confirmLabel: "Arşivle", destructive: true })) await act("archive");
            }}
          >
            Arşivle
          </Button>
          {editable && (
            <Button variant="outline" onClick={() => act("save")} disabled={saving || !dirty || invalid}>
              Kaydet
            </Button>
          )}
          {draft.status === "READY" && (
            <Button onClick={() => act("approve")} disabled={saving || dirty || invalid || !approver} title={approver ? undefined : "Onay için ADMIN rolü gerekir"}>
              <CheckCircle2 className="size-4" /> Onayla
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

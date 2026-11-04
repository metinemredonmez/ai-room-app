"use client";

import { CheckCircle2, ExternalLink, Languages, Loader2, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { CharField, DRAFT_ERRORS, LocalePicker, StatusBadge, useDrafts } from "@/components/marketing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { LOCALES, LOCALE_LABELS, type AdminMe, type Locale, type MarketingDraft } from "@/lib/types";

// Pazarlama → Blog (API.md §7.18): the agent writes an article (or translates a published one); approving a draft
// publishes it on casalume.app/blog. Published articles can be taken down here.

type Article = { title: string; description: string; slug: string; body: string };
type Post = { id: string; groupId: string; locale: Locale; slug: string; title: string; status: "DRAFT" | "PUBLISHED"; publishedAt: string };
type BlogDraft = MarketingDraft<Article> & { input: { mode: "write" | "translate"; topic?: string; sourcePostId?: string } };
const WEB = (process.env.NEXT_PUBLIC_WEB_URL ?? "https://casalume.app").replace(/\/$/, "");
const postUrl = (locale: Locale, slug: string) => `${WEB}${locale === "tr" ? "" : `/${locale}`}/blog/${slug}`;
const NO_STYLE = "none";

export default function BlogAdminPage() {
  const drafts = useDrafts<Article>("blog");
  const posts = useApi<{ items: Post[] }>("/blog");
  const me = useApi<AdminMe>("/me");
  const { toast } = useFeedback();
  const [writeOpen, setWriteOpen] = useState(false);
  const [translate, setTranslate] = useState<Post | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const approver = me.data?.role === "ADMIN" || me.data?.role === "SUPER_ADMIN";
  const groups = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of posts.data?.items ?? []) m.set(p.groupId, [...(m.get(p.groupId) ?? []), p]);
    return [...m.values()];
  }, [posts.data]);
  const items = (drafts.items as BlogDraft[]).filter((d) => d.status !== "APPROVED");
  const open = (drafts.items as BlogDraft[]).find((d) => d.id === openId) ?? null;

  async function setStatus(p: Post, path: "publish" | "unpublish") {
    try {
      await api(`/blog/${p.id}/${path}`, { method: "POST" });
      toast("success", path === "publish" ? "Yeniden yayında." : "Yayından kaldırıldı.");
      posts.reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem yapılamadı.");
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Blog"
        description="Yapay zekâ konudan yazı yazar ya da yayındaki yazıyı başka dillere uyarlar. Onayladığın taslak casalume.app/blog'da yayına girer (birkaç dakika içinde) ve site haritasına eklenir."
        actions={
          <Button onClick={() => setWriteOpen(true)}>
            <Sparkles className="size-4" /> Yeni yazı yazdır
          </Button>
        }
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Taslaklar</h2>
        {drafts.error && !drafts.data ? (
          <ErrorState message={drafts.error.message} onRetry={drafts.reload} />
        ) : !drafts.data ? (
          <Skeleton className="h-40 w-full" />
        ) : !items.length ? (
          <Card className="p-0">
            <EmptyState title="Bekleyen taslak yok" />
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dil</TableHead>
                  <TableHead>Tür</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Başlık / konu</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{LOCALE_LABELS[d.locale]}</TableCell>
                    <TableCell className="text-sm">{d.input.mode === "translate" ? "Çeviri" : "Yeni yazı"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={d.status} />
                        {d.violations.length > 0 && <span className="text-xs text-danger">Düzeltilecek: {d.violations.join(", ")}</span>}
                        {d.status === "FAILED" && <span className="text-xs text-muted-foreground">{DRAFT_ERRORS[d.error ?? ""] ?? d.error}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-80 truncate text-sm text-muted-foreground">{d.output?.title ?? d.input.topic ?? "—"}</TableCell>
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
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Yazılar</h2>
        {posts.error && !posts.data ? (
          <ErrorState message={posts.error.message} onRetry={posts.reload} />
        ) : !posts.data ? (
          <Skeleton className="h-40 w-full" />
        ) : !groups.length ? (
          <Card className="p-0">
            <EmptyState title="Henüz yayında yazı yok" description="Bir taslağı onayladığında burada görünür." />
          </Card>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <Card key={g[0].groupId} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{g[0].title}</p>
                    <p className="text-xs text-muted-foreground">{fmtDateTime(g[0].publishedAt)}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setTranslate(g[0])}>
                    <Languages className="size-4" /> Başka dillere uyarla
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {g.map((p) => (
                    <div key={p.id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
                      <Badge className={p.status === "PUBLISHED" ? "bg-good-soft text-good" : "bg-secondary text-secondary-foreground"}>{LOCALE_LABELS[p.locale]}</Badge>
                      <a href={postUrl(p.locale, p.slug)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        /{p.slug} <ExternalLink className="size-3" />
                      </a>
                      {approver && (
                        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setStatus(p, p.status === "PUBLISHED" ? "unpublish" : "publish")}>
                          {p.status === "PUBLISHED" ? "Kaldır" : "Yayınla"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <WriteSheet open={writeOpen} onClose={() => setWriteOpen(false)} onDone={drafts.reload} />
      {translate && <TranslateSheet post={translate} existing={groups.find((g) => g[0].groupId === translate.groupId)?.map((p) => p.locale) ?? []} onClose={() => setTranslate(null)} onDone={drafts.reload} />}
      {open && (
        <ArticleSheet
          key={open.id}
          draft={open}
          approver={approver}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            drafts.reload();
            posts.reload();
          }}
        />
      )}
    </div>
  );
}

function WriteSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const styles = useApi<{ items: Array<{ id: string; name: string }> }>(open ? "/marketing/social/styles" : null);
  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [locale, setLocale] = useState<Locale>("tr");
  const [styleId, setStyleId] = useState(NO_STYLE);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await api("/marketing/blog", { method: "POST", body: { topic, locale, ...(keywords.trim() ? { keywords } : {}), ...(styleId !== NO_STYLE ? { styleId } : {}) } });
      toast("success", "Yazı yazılıyor; 1–2 dakika sürer.");
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
          <SheetTitle>Yeni yazı</SheetTitle>
          <SheetDescription>700–1100 sözcük, stüdyoya bağlantıyla biten pratik bir yazı. Yaklaşık 0,1 $.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4">
          <div className="space-y-1.5">
            <Label htmlFor="b-topic">Konu</Label>
            <Input id="b-topic" maxLength={300} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ör. Küçük salonu ferah gösteren 7 dekorasyon fikri" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-keys">Anahtar kelimeler (isteğe bağlı)</Label>
            <Input id="b-keys" maxLength={300} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="küçük salon dekorasyonu, dar salon" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Dil</Label>
              <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {LOCALE_LABELS[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Kapak (stil fotoğrafı)</Label>
              <Select value={styleId} onValueChange={setStyleId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_STYLE}>Kapak yok</SelectItem>
                  {(styles.data?.items ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <SheetFooter>
          <Button onClick={submit} disabled={saving || topic.trim().length < 5}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Yazdır
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function TranslateSheet({ post, existing, onClose, onDone }: { post: Post; existing: Locale[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const [locales, setLocales] = useState<Locale[]>(LOCALES.filter((l) => !existing.includes(l)));
  const [saving, setSaving] = useState(false);
  async function submit() {
    setSaving(true);
    try {
      await api("/marketing/blog/translate", { method: "POST", body: { postId: post.id, locales } });
      toast("success", `${locales.length} dil için uyarlanıyor.`);
      onDone();
      onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Başlatılamadı.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Başka dillere uyarla</SheetTitle>
          <SheetDescription>“{post.title}” — her dil o pazarın arama ifadeleriyle yeniden yazılır. Dil başına yaklaşık 0,05 $.</SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <LocalePicker value={locales} onChange={setLocales} disabled={[post.locale]} />
        </div>
        <SheetFooter>
          <Button onClick={submit} disabled={saving || !locales.filter((l) => l !== post.locale).length}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Languages className="size-4" />} Uyarla
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ArticleSheet({ draft, approver, onClose, onChanged }: { draft: BlogDraft; approver: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [form, setForm] = useState<Article>(draft.output!);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(draft.output);
  const editable = draft.status === "READY";
  const badSlug = !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug) || form.slug.length > 80;
  const invalid = badSlug || form.title.trim().length < 5 || form.title.length > 70 || form.description.trim().length < 50 || form.description.length > 160 || form.body.trim().length < 200 || form.body.length > 30000;

  async function act(path: "save" | "approve" | "archive") {
    setSaving(true);
    try {
      if (path === "save") await api(`/marketing/drafts/${draft.id}`, { method: "PATCH", body: { output: form } });
      else await api(`/marketing/drafts/${draft.id}/${path}`, { method: "POST" });
      toast("success", { save: "Kaydedildi.", approve: "Yayına alındı; birkaç dakika içinde sitede.", archive: "Arşivlendi." }[path]);
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
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {LOCALE_LABELS[draft.locale]} · {draft.input.mode === "translate" ? "Çeviri" : "Yeni yazı"} <StatusBadge status={draft.status} />
          </SheetTitle>
          <SheetDescription>{draft.input.topic ? `Konu: ${draft.input.topic}` : fmtDateTime(draft.createdAt)}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          <CharField id="b-title" label="Başlık" value={form.title} max={70} readOnly={!editable} onChange={(v) => setForm({ ...form, title: v })} hint="Google'da ~60 karaktere kadar görünür." />
          <CharField id="b-desc" label="Açıklama (meta description)" value={form.description} max={160} rows={2} readOnly={!editable} onChange={(v) => setForm({ ...form, description: v })} />
          <div className="space-y-1.5">
            <Label htmlFor="b-slug">Adres</Label>
            <Input id="b-slug" value={form.slug} readOnly={!editable} aria-invalid={badSlug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            <p className={`text-xs ${badSlug ? "text-danger" : "text-muted-foreground"}`}>{postUrl(draft.locale, form.slug || "…")} — küçük harf, rakam ve tire.</p>
          </div>
          <CharField id="b-body" label="Metin (Markdown: ##, ###, -, 1., **kalın**, [bağlantı](/studio))" value={form.body} max={30000} rows={22} readOnly={!editable} onChange={(v) => setForm({ ...form, body: v })} />
        </div>
        <SheetFooter className="flex-row flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={saving}
            onClick={async () => {
              if (await confirm({ title: "Taslak arşivlensin mi?", confirmLabel: "Arşivle", destructive: true })) await act("archive");
            }}
          >
            Arşivle
          </Button>
          {editable && (
            <Button variant="outline" onClick={() => act("save")} disabled={saving || !dirty || invalid}>
              Kaydet
            </Button>
          )}
          {editable && (
            <Button onClick={() => act("approve")} disabled={saving || dirty || invalid || draft.violations.length > 0 || !approver} title={approver ? undefined : "Onay için ADMIN rolü gerekir"}>
              <CheckCircle2 className="size-4" /> Onayla ve yayınla
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

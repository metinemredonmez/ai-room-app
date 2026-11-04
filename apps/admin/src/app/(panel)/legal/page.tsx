"use client";

import { Eye, FilePlus2, Pencil, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { ErrorState, PageHeader, Spinner } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { AdminMe, LegalCurrent, LegalDocument, LegalKind, LegalLocale, LegalRow } from "@/lib/types";

const KIND_LABELS: Record<LegalKind, string> = {
  terms: "Kullanım koşulları",
  privacy: "Aydınlatma metni",
  ai_processing: "Yapay zekâ ile işleme onayı",
  marketing: "Ticari ileti onayı",
};
const LOCALE_LABELS: Record<LegalLocale, string> = { tr: "Türkçe", en: "İngilizce" };
const VERSION_RE = /^\d{4}-\d{2}-\d{2}(\.[1-9])?$/;
const HTML_TAG = /<\/?[a-z][^>]*>/i;
const canWrite = (me: AdminMe | null) => me?.role === "ADMIN" || me?.role === "SUPER_ADMIN";

/** Today's date as a version; a second version on the same day gets .1, .2, … */
function nextVersion(current: string | undefined, taken: string[]) {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());
  const candidates = [today, ...Array.from({ length: 9 }, (_, i) => `${today}.${i + 1}`)];
  return candidates.find((v) => (!current || v > current) && !taken.includes(v)) ?? today;
}

type Editor = { mode: "new" } | { mode: "edit"; id: string } | { mode: "view"; id: string };
type Overview = { current: LegalCurrent[]; items: LegalRow[] };

export default function LegalPage() {
  const me = useApi<AdminMe>("/me");
  const data = useApi<Overview>("/legal");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [publishing, setPublishing] = useState<{ kind: LegalKind; version: string } | null>(null);
  const { toast, confirm } = useFeedback();
  const writable = canWrite(me.data);

  // Draft versions that are ready to publish (one row per kind + version; Turkish is required).
  const drafts = data.data?.items.filter((r) => r.status === "draft") ?? [];
  const publishable = [...new Map(drafts.map((d) => [`${d.kind}|${d.version}`, d])).values()];

  async function remove(row: LegalRow) {
    const ok = await confirm({ title: "Taslak silinsin mi?", description: `${KIND_LABELS[row.kind]} · ${row.version} · ${LOCALE_LABELS[row.locale]}`, confirmLabel: "Sil", destructive: true });
    if (!ok) return;
    try {
      await api(`/legal/${row.id}`, { method: "DELETE" });
      toast("success", "Taslak silindi.");
      data.reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Silinemedi.");
    }
  }

  return (
    <>
      <PageHeader
        title="Yasal metinler"
        description="Yayınlanan sürüm değiştirilemez: kullanıcının neyi onayladığının kanıtıdır. Değişiklik yeni bir sürümle yapılır; Türkçe metin zorunludur."
        actions={
          writable && (
            <Button onClick={() => setEditor({ mode: "new" })}>
              <FilePlus2 aria-hidden /> Yeni sürüm
            </Button>
          )
        }
      />

      {data.error && !data.data ? (
        <ErrorState message={data.error.message} onRetry={data.reload} />
      ) : !data.data ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.data.current.map((c) => (
              <Card key={c.kind} className="gap-3">
                <CardHeader>
                  <CardDescription>{KIND_LABELS[c.kind]}</CardDescription>
                  <CardTitle className="tabular text-xl">{c.version}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  {c.publishedAt ? `Yayın: ${fmtDate(c.publishedAt)}` : "Yayında metin yok"}
                  {c.consentVersion !== c.version && <span className="block">Onay geçerli: {c.consentVersion} ve sonrası</span>}
                </CardContent>
              </Card>
            ))}
          </div>

          {writable && publishable.length > 0 && (
            <Card className="gap-3 border-warn/40 bg-warn-soft/40">
              <CardHeader>
                <CardTitle className="text-base">Yayın bekleyen taslaklar</CardTitle>
                <CardDescription>Bir sürümün bütün dilleri birlikte yayınlanır.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {publishable.map((d) => (
                  <Button key={`${d.kind}|${d.version}`} variant="outline" size="sm" onClick={() => setPublishing({ kind: d.kind, version: d.version })}>
                    <Send aria-hidden /> {KIND_LABELS[d.kind]} · {d.version}
                  </Button>
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Metin</TableHead>
                  <TableHead>Sürüm</TableHead>
                  <TableHead>Dil</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Yeniden onay</TableHead>
                  <TableHead>Güncelleme</TableHead>
                  <TableHead className="pr-6 text-right">İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-6">
                      <p className="font-medium">{KIND_LABELS[r.kind]}</p>
                      <p className="max-w-xs truncate text-xs text-muted-foreground">{r.title}</p>
                    </TableCell>
                    <TableCell className="tabular">{r.version}</TableCell>
                    <TableCell>{LOCALE_LABELS[r.locale]}</TableCell>
                    <TableCell>
                      {r.status === "published" ? <Badge variant="secondary">Yayında</Badge> : <Badge className="bg-warn-soft text-warn">Taslak</Badge>}
                    </TableCell>
                    <TableCell>{r.requiresConsent ? "Gerekir" : "Gerekmez"}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDateTime(r.publishedAt ?? r.updatedAt)}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex justify-end gap-1">
                        {r.status === "draft" && writable ? (
                          <>
                            <Button variant="ghost" size="icon" aria-label="Düzenle" onClick={() => setEditor({ mode: "edit", id: r.id })}>
                              <Pencil aria-hidden />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label="Sil" onClick={() => remove(r)}>
                              <Trash2 aria-hidden />
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="icon" aria-label="Görüntüle" onClick={() => setEditor({ mode: "view", id: r.id })}>
                            <Eye aria-hidden />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {editor && data.data && (
        <EditorDialog editor={editor} overview={data.data} onClose={() => setEditor(null)} onSaved={data.reload} />
      )}
      {publishing && <PublishDialog target={publishing} rows={drafts} onClose={() => setPublishing(null)} onDone={data.reload} />}
    </>
  );
}

function EditorDialog({ editor, overview, onClose, onSaved }: { editor: Editor; overview: Overview; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const existing = useApi<LegalDocument>(editor.mode === "new" ? null : `/legal/${editor.id}`);
  const [kind, setKind] = useState<LegalKind>("privacy");
  const [locale, setLocale] = useState<LegalLocale>("tr");
  const current = overview.current.find((c) => c.kind === kind);
  const [version, setVersion] = useState(() => nextVersion(overview.current.find((c) => c.kind === "privacy")?.version, []));
  const [form, setForm] = useState<{ title: string; body: string; requiresConsent: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const readOnly = editor.mode === "view";

  // Start a new version from the published text, or an edit from the draft itself.
  const base = editor.mode === "new" ? overview.items.find((r) => r.kind === kind && r.locale === locale && r.status === "published") : null;
  const baseDoc = useApi<LegalDocument>(editor.mode === "new" && base ? `/legal/${base.id}` : null);
  // useApi keeps the previous document while the next one loads; only the matching one may fill the form.
  const source = editor.mode === "new" ? (base && baseDoc.data?.id === base.id ? baseDoc.data : null) : existing.data;
  const values = form ?? (source ? { title: source.title, body: source.body, requiresConsent: editor.mode === "new" ? true : source.requiresConsent } : null);
  const problem = !values
    ? null
    : values.title.trim().length < 3
      ? "Başlık en az 3 karakter olmalı."
      : values.body.trim().length < 50
        ? "Metin en az 50 karakter olmalı."
        : HTML_TAG.test(values.title) || HTML_TAG.test(values.body)
          ? "Metin HTML içeremez; Markdown kullan."
          : editor.mode === "new" && !VERSION_RE.test(version)
            ? "Sürüm YYYY-MM-DD ya da YYYY-MM-DD.n biçiminde olmalı."
            : editor.mode === "new" && current && version <= current.version
              ? `Sürüm yayındaki ${current.version} sürümünden büyük olmalı.`
              : null;

  async function save() {
    if (!values || problem) return;
    setBusy(true);
    try {
      if (editor.mode === "new") {
        await api("/legal", { method: "POST", body: { kind, version, locale, title: values.title.trim(), body: values.body.trim(), requiresConsent: values.requiresConsent } });
        toast("success", "Taslak oluşturuldu. Yayınlamak için 'Yayın bekleyen taslaklar' bölümünü kullan.");
      } else {
        await api(`/legal/${(editor as { id: string }).id}`, { method: "PATCH", body: { title: values.title.trim(), body: values.body.trim(), requiresConsent: values.requiresConsent } });
        toast("success", "Taslak kaydedildi.");
      }
      onSaved();
      onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  const doc = existing.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editor.mode === "new" ? "Yeni sürüm taslağı" : readOnly ? "Yasal metin" : "Taslağı düzenle"}</DialogTitle>
          <DialogDescription>
            {doc ? `${KIND_LABELS[doc.kind]} · ${doc.version} · ${LOCALE_LABELS[doc.locale]}` : "Yayındaki metinden başlar; {{controller.name}} gibi yer tutucular yayında doldurulur."}
          </DialogDescription>
        </DialogHeader>

        {editor.mode === "new" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="kind">Metin</Label>
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(v as LegalKind);
                  setForm(null);
                  setVersion(nextVersion(overview.current.find((c) => c.kind === v)?.version, overview.items.filter((r) => r.kind === v).map((r) => r.version)));
                }}
              >
                <SelectTrigger id="kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABELS) as LegalKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="locale">Dil</Label>
              <Select
                value={locale}
                onValueChange={(v) => {
                  setLocale(v as LegalLocale);
                  setForm(null);
                }}
              >
                <SelectTrigger id="locale" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tr">Türkçe</SelectItem>
                  <SelectItem value="en">İngilizce</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="version">Sürüm</Label>
              <Input id="version" value={version} onChange={(e) => setVersion(e.target.value.trim())} className="tabular" />
            </div>
          </div>
        )}

        {!values ? (
          editor.mode === "new" && !base ? (
            <Button variant="outline" onClick={() => setForm({ title: "", body: "", requiresConsent: true })}>
              Boş metinle başla
            </Button>
          ) : (
            <Spinner />
          )
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="title">Başlık</Label>
              <Input id="title" value={values.title} readOnly={readOnly} maxLength={200} onChange={(e) => setForm({ ...values, title: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="body">Metin (Markdown)</Label>
              <Textarea
                id="body"
                value={values.body}
                readOnly={readOnly}
                rows={16}
                maxLength={100_000}
                className="max-h-[50vh] font-mono text-xs leading-relaxed"
                onChange={(e) => setForm({ ...values, body: e.target.value })}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.requiresConsent}
                disabled={readOnly}
                onChange={(e) => setForm({ ...values, requiresConsent: e.target.checked })}
                className="mt-0.5 size-4 accent-[var(--primary)]"
              />
              <span>
                Kullanıcılardan yeniden onay iste
                <span className="block text-xs text-muted-foreground">
                  Anlamı değişen sürümlerde işaretle. Yalnız yazım düzeltmesiyse kaldır; eski onaylar geçerli kalır. Türkçe metindeki seçim geçerlidir.
                </span>
              </span>
            </label>
            {problem && !readOnly && (
              <p className="text-sm text-danger" role="alert">
                {problem}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {readOnly ? "Kapat" : "Vazgeç"}
          </Button>
          {!readOnly && (
            <Button onClick={save} disabled={busy || !values || Boolean(problem)}>
              {editor.mode === "new" ? "Taslak oluştur" : "Kaydet"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PublishDialog({ target, rows, onClose, onDone }: { target: { kind: LegalKind; version: string }; rows: LegalRow[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const locales = rows.filter((r) => r.kind === target.kind && r.version === target.version);
  const tr = locales.find((r) => r.locale === "tr");

  async function publish() {
    setBusy(true);
    try {
      await api("/legal/publish", { method: "POST", body: { ...target, reason: reason.trim() } });
      toast("success", `${KIND_LABELS[target.kind]} ${target.version} yayınlandı.`);
      onDone();
      onClose();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Yayınlanamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sürümü yayınla</DialogTitle>
          <DialogDescription>
            {KIND_LABELS[target.kind]} · {target.version} · {locales.map((l) => LOCALE_LABELS[l.locale]).join(", ")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          {!tr ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-danger">Türkçe taslak yok; önce Türkçe metni oluştur.</p>
          ) : tr.requiresConsent ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-warn">Bu sürüm yeniden onay istiyor: kullanıcılar uygulamayı açınca yeni metni onaylamaları gerekecek.</p>
          ) : (
            <p className="rounded-lg bg-muted px-3 py-2 text-muted-foreground">Yazım düzeltmesi: mevcut onaylar geçerli kalır.</p>
          )}
          <p className="text-muted-foreground">Yayınlanan metin bir daha değiştirilemez ve silinemez.</p>
          <div className="grid gap-2">
            <Label htmlFor="publish-reason">Gerekçe</Label>
            <Textarea id="publish-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Örn. hukukçu onayı, 3. taraf listesi güncellendi" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={publish} disabled={busy || !tr || reason.trim().length < 5}>
            <Send aria-hidden /> Yayınla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

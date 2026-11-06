"use client";

import { Crown, Eye, Loader2, Palette, Pencil, Plus, Trash2, TrendingUp } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState, ErrorState, PageHeader, Spinner } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { badgeTone, StatCard } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtInt, HEX_RE } from "@/lib/format";
import { atLeast, type AdminMe, type AdminStyle, type AdminStyleInput } from "@/lib/types";

// Stiller: uygulamada görünen tasarım stilleri ve görsel modeline giden tanımları. SUPPORT okur, EDITOR ve üstü yazar.

const EMPTY: AdminStyleInput = {
  id: "",
  nameTr: "",
  nameEn: "",
  descriptionTr: "",
  descriptionEn: "",
  prompt: "",
  palette: ["#1F6F5C", "#E07A4F", "#F7F4EF"],
  isPro: false,
  isActive: true,
  sortOrder: 100,
};

const FILTERS = [
  { value: "all", label: "Tümü" },
  { value: "active", label: "Aktif" },
  { value: "inactive", label: "Pasif" },
  { value: "pro", label: "PRO" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

function validate(v: AdminStyleInput, isNew: boolean): string | null {
  if (isNew && !/^[a-z_]{2,40}$/.test(v.id)) return "Kimlik 2–40 karakter, yalnız küçük harf ve alt çizgi olmalı.";
  if (!v.nameTr.trim() || !v.nameEn.trim()) return "Türkçe ve İngilizce ad gerekli.";
  if (v.nameTr.length > 60 || v.nameEn.length > 60) return "Adlar en fazla 60 karakter olabilir.";
  if (v.descriptionTr.length > 240 || v.descriptionEn.length > 240) return "Açıklamalar en fazla 240 karakter olabilir.";
  if (v.prompt.trim().length < 10 || v.prompt.length > 1000) return "Prompt 10–1000 karakter olmalı.";
  if (v.palette.length < 1 || v.palette.length > 6 || !v.palette.every((h) => HEX_RE.test(h))) return "Palet 1–6 geçerli hex renk içermeli (#RRGGBB).";
  if (!Number.isInteger(v.sortOrder) || v.sortOrder < 0 || v.sortOrder > 9999) return "Sıra 0–9999 arasında bir tam sayı olmalı.";
  return null;
}

function PaletteStrip({ palette }: { palette: string[] }) {
  return (
    <div className="flex h-14 overflow-hidden rounded-lg border" aria-hidden>
      {palette.map((hex, i) => (
        <span key={`${hex}-${i}`} className="flex-1" style={{ background: HEX_RE.test(hex) ? hex : "transparent" }} title={hex} />
      ))}
    </div>
  );
}

export default function StylesPage() {
  const styles = useApi<AdminStyle[]>("/styles");
  const me = useApi<AdminMe>("/me");
  const writable = atLeast(me.data?.role, "EDITOR");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<{ style: AdminStyleInput; isNew: boolean } | null>(null);
  const all = [...(styles.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const list = all.filter((s) => (filter === "active" ? s.isActive : filter === "inactive" ? !s.isActive : filter === "pro" ? s.isPro : true));
  const top = all.reduce<AdminStyle | null>((best, s) => (!best || s.usageCount > best.usageCount ? s : best), null);

  function onSaved(saved: AdminStyle) {
    styles.setData((prev) => {
      const items = prev ?? [];
      return items.some((s) => s.id === saved.id) ? items.map((s) => (s.id === saved.id ? saved : s)) : [...items, saved];
    });
    setEditing(null);
  }

  return (
    <>
      <PageHeader
        title="Stiller"
        description="Uygulamada görünen tasarım stilleri ve görsel modeline giden tanımları. Pasif stil yeni tasarımda seçilemez; eski tasarımlarda adıyla görünür."
        actions={
          writable && (
            <Button onClick={() => setEditing({ style: EMPTY, isNew: true })}>
              <Plus aria-hidden /> Yeni stil
            </Button>
          )
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Palette} label="Stil" value={styles.data && fmtInt(all.length)} />
        <StatCard icon={Eye} label="Aktif" value={styles.data && fmtInt(all.filter((s) => s.isActive).length)} tone="good" />
        <StatCard icon={Crown} label="PRO" value={styles.data && fmtInt(all.filter((s) => s.isPro).length)} tone="warn" />
        <StatCard icon={TrendingUp} label="En çok kullanılan" value={styles.data && (top && top.usageCount > 0 ? top.nameTr : "—")} tone="neutral" note={top && top.usageCount > 0 ? `${fmtInt(top.usageCount)} tasarım` : "Henüz kullanım yok"} />
      </div>

      <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} aria-label="Süzgeç" className="mb-4">
        {FILTERS.map((f) => (
          <ToggleGroupItem key={f.value} value={f.value} className="px-3">
            {f.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {styles.error && !styles.data ? (
        <ErrorState message={styles.error.message} onRetry={styles.reload} />
      ) : !styles.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <EmptyState title={all.length ? "Bu süzgeçte stil yok" : "Henüz stil yok"} description={all.length ? undefined : "Yeni stil ekleyerek başla."} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <Card key={s.id} className={`gap-4 ${s.isActive ? "" : "opacity-70"}`}>
              <CardHeader>
                <CardTitle className="truncate">{s.nameTr}</CardTitle>
                <CardDescription className="truncate">
                  {s.nameEn} · <span className="font-mono text-xs">{s.id}</span>
                </CardDescription>
                <CardAction className="flex gap-1">
                  {s.isPro && <Badge className={badgeTone.warn}>PRO</Badge>}
                  {s.isActive ? <Badge className={badgeTone.good}>Aktif</Badge> : <Badge className={badgeTone.neutral}>Pasif</Badge>}
                </CardAction>
              </CardHeader>
              <CardContent className="grid gap-3">
                <PaletteStrip palette={s.palette} />
                {s.descriptionTr && <p className="line-clamp-2 text-sm text-muted-foreground">{s.descriptionTr}</p>}
              </CardContent>
              <CardFooter className="mt-auto justify-between gap-2 text-xs text-muted-foreground">
                <span className="tabular">
                  Sıra {s.sortOrder} · {fmtInt(s.usageCount)} tasarım
                </span>
                {writable && (
                  <Button size="sm" variant="outline" onClick={() => setEditing({ style: s, isNew: false })}>
                    <Pencil aria-hidden /> Düzenle
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      {editing && <StyleEditor initial={editing.style} isNew={editing.isNew} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </>
  );
}

function StyleEditor({ initial, isNew, onClose, onSaved }: { initial: AdminStyleInput; isNew: boolean; onClose: () => void; onSaved: (s: AdminStyle) => void }) {
  const [v, setV] = useState<AdminStyleInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useFeedback();
  const set = <K extends keyof AdminStyleInput>(k: K, value: AdminStyleInput[K]) => setV((prev) => ({ ...prev, [k]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const payload = { ...v, palette: v.palette.map((h) => h.toUpperCase()) };
    const problem = validate(payload, isNew);
    setError(problem);
    if (problem) return;
    setSaving(true);
    try {
      // Only the editable fields: the row being edited also carries usageCount.
      const { id, nameTr, nameEn, descriptionTr, descriptionEn, prompt, palette, isPro, isActive, sortOrder } = payload;
      const patch = { nameTr, nameEn, descriptionTr, descriptionEn, prompt, palette, isPro, isActive, sortOrder };
      const saved = isNew
        ? await api<AdminStyle>("/styles", { method: "POST", body: { id, ...patch } })
        : await api<AdminStyle>(`/styles/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
      toast("success", isNew ? "Stil oluşturuldu." : "Stil güncellendi.");
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} noValidate className="flex min-h-full flex-col">
          <SheetHeader>
            <SheetTitle>{isNew ? "Yeni stil" : `Stili düzenle: ${initial.nameTr}`}</SheetTitle>
            <SheetDescription>Adlar ve açıklamalar uygulamada görünür; tanım görsel modeline gider.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 px-4">
            {error && (
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            <div className="grid gap-2">
              <Label htmlFor="sid">Kimlik</Label>
              <Input id="sid" value={v.id} disabled={!isNew} onChange={(e) => set("id", e.target.value.toLowerCase())} className="font-mono" autoFocus={isNew} />
              <p className="text-xs text-muted-foreground">{isNew ? "Ör. modern_turkish — sonradan değiştirilemez." : "Kimlik değiştirilemez."}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="nameTr">Ad (TR)</Label>
                <Input id="nameTr" maxLength={60} value={v.nameTr} onChange={(e) => set("nameTr", e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="nameEn">Ad (EN)</Label>
                <Input id="nameEn" maxLength={60} value={v.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="descTr">Açıklama (TR)</Label>
                <Textarea id="descTr" rows={2} maxLength={240} value={v.descriptionTr} onChange={(e) => set("descriptionTr", e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="descEn">Açıklama (EN)</Label>
                <Textarea id="descEn" rows={2} maxLength={240} value={v.descriptionEn} onChange={(e) => set("descriptionEn", e.target.value)} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prompt">Görsel modeline giden tanım</Label>
              <Textarea id="prompt" rows={5} maxLength={1000} value={v.prompt} onChange={(e) => set("prompt", e.target.value)} className="font-mono text-[13px]" />
              <p className="text-xs text-muted-foreground">İngilizce önerilir, 10–1000 karakter · {v.prompt.length}/1000</p>
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Palet (1–6 renk)</legend>
              <PaletteStrip palette={v.palette} />
              {v.palette.map((hex, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`Renk ${i + 1} seçici`}
                    value={HEX_RE.test(hex) ? hex : "#000000"}
                    onChange={(e) => set("palette", v.palette.map((h, j) => (j === i ? e.target.value.toUpperCase() : h)))}
                    className="h-9 w-10 cursor-pointer rounded-md border bg-background p-1"
                  />
                  <Input
                    aria-label={`Renk ${i + 1} hex`}
                    aria-invalid={!HEX_RE.test(hex)}
                    value={hex}
                    maxLength={7}
                    onChange={(e) => set("palette", v.palette.map((h, j) => (j === i ? e.target.value : h)))}
                    className="w-32 font-mono"
                  />
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Renk ${i + 1} sil`} disabled={v.palette.length <= 1} onClick={() => set("palette", v.palette.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" className="justify-self-start" disabled={v.palette.length >= 6} onClick={() => set("palette", [...v.palette, "#CCCCCC"])}>
                <Plus aria-hidden /> Renk ekle
              </Button>
            </fieldset>
            <div className="grid items-end gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="sortOrder">Sıra</Label>
                <Input id="sortOrder" type="number" min={0} max={9999} step={1} value={v.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} />
              </div>
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={v.isPro} onChange={(e) => set("isPro", e.target.checked)} className="size-4 accent-[var(--primary)]" />
                PRO stil
              </label>
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-4 accent-[var(--primary)]" />
                Aktif
              </label>
            </div>
          </div>
          <SheetFooter className="mt-auto flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              {isNew ? "Oluştur" : "Kaydet"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

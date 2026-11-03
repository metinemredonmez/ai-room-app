"use client";

import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Spinner, Table, td, Textarea, th } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtInt, HEX_RE } from "@/lib/format";
import type { AdminStyle, AdminStyleInput } from "@/lib/types";

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

function Swatches({ palette }: { palette: string[] }) {
  return (
    <span className="flex">
      {palette.map((hex, i) => (
        <span key={`${hex}-${i}`} className="-ml-1 h-5 w-5 rounded-full border-2 border-surface first:ml-0" style={{ background: HEX_RE.test(hex) ? hex : "transparent" }} title={hex} />
      ))}
    </span>
  );
}

function StyleEditor({ initial, isNew, onClose, onSaved }: { initial: AdminStyleInput; isNew: boolean; onClose: () => void; onSaved: (s: AdminStyle) => void }) {
  const [v, setV] = useState<AdminStyleInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useFeedback();
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof AdminStyleInput>(k: K, value: AdminStyleInput[K]) => setV((prev) => ({ ...prev, [k]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const payload = { ...v, palette: v.palette.map((h) => h.toUpperCase()) };
    const problem = validate(payload, isNew);
    setError(problem);
    if (problem) return;
    setSaving(true);
    try {
      const saved = isNew
        ? await api<AdminStyle>("/styles", { method: "POST", body: payload })
        : await api<AdminStyle>(`/styles/${encodeURIComponent(v.id)}`, {
            method: "PATCH",
            body: {
              nameTr: payload.nameTr,
              nameEn: payload.nameEn,
              descriptionTr: payload.descriptionTr,
              descriptionEn: payload.descriptionEn,
              prompt: payload.prompt,
              palette: payload.palette,
              isPro: payload.isPro,
              isActive: payload.isActive,
              sortOrder: payload.sortOrder,
            },
          });
      toast("success", isNew ? "Stil oluşturuldu." : "Stil güncellendi.");
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="style-editor-title"
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-line bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-5 py-3">
          <h2 id="style-editor-title" className="text-base font-semibold text-fg">
            {isNew ? "Yeni stil" : `Stili düzenle: ${initial.nameTr}`}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-fg" aria-label="Kapat">
            <X className="h-5 w-5" />
          </button>
        </header>
        <form onSubmit={submit} className="flex flex-col gap-4 p-5" noValidate>
          {error && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <Field label="Kimlik" htmlFor="sid" hint={isNew ? "Ör. modern_turkish — sonradan değiştirilemez." : "Kimlik değiştirilemez."}>
            <Input id="sid" ref={firstField} value={v.id} disabled={!isNew} onChange={(e) => set("id", e.target.value.toLowerCase())} className="font-mono" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ad (TR)" htmlFor="nameTr">
              <Input id="nameTr" maxLength={60} value={v.nameTr} onChange={(e) => set("nameTr", e.target.value)} />
            </Field>
            <Field label="Ad (EN)" htmlFor="nameEn">
              <Input id="nameEn" maxLength={60} value={v.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
            </Field>
            <Field label="Açıklama (TR)" htmlFor="descTr">
              <Textarea id="descTr" rows={2} maxLength={240} value={v.descriptionTr} onChange={(e) => set("descriptionTr", e.target.value)} />
            </Field>
            <Field label="Açıklama (EN)" htmlFor="descEn">
              <Textarea id="descEn" rows={2} maxLength={240} value={v.descriptionEn} onChange={(e) => set("descriptionEn", e.target.value)} />
            </Field>
          </div>
          <Field label="Görsel modeli prompt'u" htmlFor="prompt" hint="AI servisine stil tanımı olarak gönderilir (İngilizce önerilir, 10–1000 karakter).">
            <Textarea id="prompt" rows={5} maxLength={1000} value={v.prompt} onChange={(e) => set("prompt", e.target.value)} className="font-mono text-[13px]" />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-medium text-fg">Palet (1–6 renk)</legend>
            {v.palette.map((hex, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`Renk ${i + 1} seçici`}
                  value={HEX_RE.test(hex) ? hex : "#000000"}
                  onChange={(e) => set("palette", v.palette.map((h, j) => (j === i ? e.target.value.toUpperCase() : h)))}
                  className="h-9 w-10 cursor-pointer rounded-lg border border-line bg-surface p-1"
                />
                <Input
                  aria-label={`Renk ${i + 1} hex`}
                  value={hex}
                  maxLength={7}
                  onChange={(e) => set("palette", v.palette.map((h, j) => (j === i ? e.target.value : h)))}
                  className={`w-32 font-mono ${HEX_RE.test(hex) ? "" : "border-danger"}`}
                />
                <Button type="button" size="sm" variant="ghost" aria-label={`Renk ${i + 1} sil`} disabled={v.palette.length <= 1} onClick={() => set("palette", v.palette.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" className="self-start" disabled={v.palette.length >= 6} onClick={() => set("palette", [...v.palette, "#CCCCCC"])}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> Renk ekle
            </Button>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Sıra" htmlFor="sortOrder">
              <Input id="sortOrder" type="number" min={0} max={9999} step={1} value={v.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-fg">
              <input type="checkbox" checked={v.isPro} onChange={(e) => set("isPro", e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
              PRO stil
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-fg">
              <input type="checkbox" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
              Aktif
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" onClick={onClose}>
              Vazgeç
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {isNew ? "Oluştur" : "Kaydet"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function StylesPage() {
  const styles = useApi<AdminStyle[]>("/styles");
  const [editing, setEditing] = useState<{ style: AdminStyleInput; isNew: boolean } | null>(null);
  const list = [...(styles.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

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
        description="Uygulamada görünen tasarım stilleri ve görsel modeli prompt'ları"
        actions={
          <Button variant="primary" onClick={() => setEditing({ style: EMPTY, isNew: true })}>
            <Plus className="h-4 w-4" aria-hidden /> Yeni stil
          </Button>
        }
      />
      <Card>
        {styles.error && !styles.data ? (
          <ErrorState message={styles.error.message} onRetry={styles.reload} />
        ) : !styles.data ? (
          <Spinner />
        ) : list.length === 0 ? (
          <EmptyState title="Henüz stil yok" description="Yeni stil ekleyerek başla." />
        ) : (
          <Table
            head={
              <tr>
                <th className={th}>Palet</th>
                <th className={th}>Stil</th>
                <th className={th}>Kimlik</th>
                <th className={th}>Erişim</th>
                <th className={th}>Durum</th>
                <th className={`${th} text-right`}>Sıra</th>
                <th className={`${th} text-right`}>Kullanım</th>
                <th className={th}>
                  <span className="sr-only">İşlemler</span>
                </th>
              </tr>
            }
          >
            {list.map((s) => (
              <tr key={s.id} className="hover:bg-surface-2">
                <td className={td}>
                  <Swatches palette={s.palette} />
                </td>
                <td className={td}>
                  <p className="font-medium text-fg">{s.nameTr}</p>
                  <p className="text-xs text-muted-foreground">{s.nameEn}</p>
                </td>
                <td className={`${td} font-mono text-xs text-muted-foreground`}>{s.id}</td>
                <td className={td}>{s.isPro ? <Badge tone="warn">PRO</Badge> : <Badge>Ücretsiz</Badge>}</td>
                <td className={td}>{s.isActive ? <Badge tone="good">Aktif</Badge> : <Badge>Pasif</Badge>}</td>
                <td className={`${td} text-right`}>{s.sortOrder}</td>
                <td className={`${td} text-right`}>{fmtInt(s.usageCount)}</td>
                <td className={`${td} text-right`}>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ style: s, isNew: false })}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden /> Düzenle
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && <StyleEditor initial={editing.style} isNew={editing.isNew} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </>
  );
}

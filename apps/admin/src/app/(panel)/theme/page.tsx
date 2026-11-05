"use client";

import { Check, Plus, Save, Star, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Spinner } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { AdminMe, ContrastReport, ThemePalette, ThemeState, ThemeTokens } from "@/lib/types";

// Renk temaları (API.md §7.34): web'de (ve uygulamada) kullanıcıların seçebildiği temalar. Bir palet koyudan açığa
// 6 tondur; sunucu tonlardan 11 renk değişkenini üretir ve okunurluğu ölçer. Metin, buton ve vurgu yazısı 4.5:1'i
// geçmeyen palet açılamaz. Varsayılan, ilk kez gelen herkesin gördüğü temadır. Kayıt gerekçe ister ve denetlenir.

type Item = ThemePalette & { contrast: ContrastReport };
const strip = ({ id, name, tones, tokens, enabled }: Item): ThemePalette => ({ id, name, tones, tokens, enabled });
const HEX_RE = /^#[0-9a-f]{6}$/;
const safe = (c: string) => (HEX_RE.test(c) ? c : "transparent");
const slugify = (v: string) =>
  v.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);

export default function ThemePage() {
  const state = useApi<ThemeState>("/theme");
  const me = useApi<AdminMe>("/me");
  const s = state.data;
  return (
    <>
      <PageHeader
        title="Renk temaları"
        description="Kullanıcıların sitenin sağ üstünden seçebildiği renk temaları. Varsayılan tema, ilk kez gelen herkesin gördüğü temadır. Değişiklik web'e birkaç dakika içinde yansır; uygulama da aynı listeyi okur."
      />
      {state.error && !s ? (
        <ErrorState message={state.error.message} onRetry={state.reload} />
      ) : !s || !me.data ? (
        <Spinner />
      ) : (
        <Editor key={s.version ?? "default"} state={s} canEdit={["ADMIN", "SUPER_ADMIN"].includes(me.data.role)} onSaved={(n) => state.setData(() => n)} onReload={state.reload} />
      )}
    </>
  );
}

function Editor({ state, canEdit, onSaved, onReload }: { state: ThemeState; canEdit: boolean; onSaved: (s: ThemeState) => void; onReload: () => void }) {
  const { toast, confirm } = useFeedback();
  const [items, setItems] = useState<Item[]>(state.palettes);
  const [defaultId, setDefaultId] = useState(state.defaultId);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = defaultId !== state.defaultId || JSON.stringify(items.map(strip)) !== JSON.stringify(state.palettes.map(strip));
  const enabledCount = items.filter((p) => p.enabled).length;

  function toggle(p: Item) {
    if (p.enabled && p.id === defaultId) return toast("error", "Varsayılan tema kapatılamaz; önce başka bir temayı varsayılan yap.");
    if (!p.enabled && p.contrast.blocking.length) return toast("error", "Bu palet okunurluk kontrolünden geçmiyor; açılamaz.");
    setItems((xs) => xs.map((x) => (x.id === p.id ? { ...x, enabled: !x.enabled } : x)));
  }

  async function remove(p: Item) {
    if (p.id === defaultId) return toast("error", "Varsayılan tema silinemez.");
    const ok = await confirm({ title: `“${p.name.tr}” silinsin mi?`, description: "Bu temayı seçmiş kullanıcılar varsayılan temayı görür. Kaydetmeden önce geri alabilirsin.", confirmLabel: "Sil", destructive: true });
    if (ok) setItems((xs) => xs.filter((x) => x.id !== p.id));
  }

  async function save() {
    setBusy(true);
    try {
      const out = await api<ThemeState>("/theme", { method: "PATCH", body: { theme: { defaultId, palettes: items.map(strip) }, reason: reason.trim(), version: state.version } });
      setReason("");
      onSaved(out);
      toast("success", "Kaydedildi; web'e birkaç dakika içinde yansır.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (await confirm({ title: "Temalar bu arada değişti", description: "Başka biri kaydetmiş. Güncel hâli yüklensin mi? (Kaydedilmemiş değişikliklerin gider.)", confirmLabel: "Yükle" })) onReload();
      } else toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted-foreground">Görüntüleme yetkin var; değiştirmek için yönetici rolü gerekir.</p>}
      <Card title={`Temalar · ${enabledCount} açık / ${items.length}`}>
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((p) => (
            <PaletteCard
              key={p.id}
              p={p}
              isDefault={p.id === defaultId}
              canEdit={canEdit}
              onDefault={() => (p.enabled ? setDefaultId(p.id) : toast("error", "Önce temayı aç."))}
              onToggle={() => toggle(p)}
              onRemove={() => void remove(p)}
            />
          ))}
        </div>
      </Card>
      {canEdit && <NewPalette taken={items.map((p) => p.id)} onAdd={(p) => setItems((xs) => [...xs, p])} />}
      {canEdit && (
        <Card>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <Field label="Değişiklik gerekçesi" htmlFor="theme-reason" hint="Denetim kaydına yazılır (en az 3 karakter).">
                <Input id="theme-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Örn. kış kampanyası için Kahve varsayılan" />
              </Field>
            </div>
            <Button variant="primary" loading={busy} disabled={!dirty || reason.trim().length < 3} onClick={() => void save()}>
              <Save className="h-4 w-4" aria-hidden /> Kaydet
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {dirty ? "Kaydedilmemiş değişiklik var." : "Değişiklik yok."}
            {state.updatedAt ? ` Son kayıt: ${fmtDateTime(state.updatedAt)}${state.updatedBy ? ` · ${state.updatedBy}` : ""}.` : " Şu an yerleşik temalar kullanılıyor."}
          </p>
        </Card>
      )}
    </div>
  );
}

function ToneStrip({ tones }: { tones: string[] }) {
  return (
    <div className="flex h-7 overflow-hidden rounded-lg ring-1 ring-black/10" aria-hidden>
      {tones.map((t, i) => (
        <span key={`${t}-${i}`} className="flex-1" style={{ background: safe(t) }} title={t} />
      ))}
    </div>
  );
}

/** A small mock of the site in this palette: page, card, text, secondary text, filled button and the PRO badge. */
function Preview({ tokens: k }: { tokens: ThemeTokens }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: safe(k.bg) }} aria-hidden>
      <div className="rounded-md border p-2.5" style={{ background: safe(k.surface), borderColor: safe(k.border) }}>
        <p className="text-[13px] font-medium" style={{ color: safe(k.text) }}>
          Odanı yeniden tasarla
        </p>
        <p className="text-[11px]" style={{ color: safe(k.muted) }}>
          Fotoğraf yükle, stili seç, saniyeler içinde gör.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full px-2.5 py-1 text-[11px] font-medium text-white" style={{ background: safe(k.primary) }}>
            Tasarla
          </span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: safe(k.accentSoft), color: safe(k.accent) }}>
            PRO
          </span>
          <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: safe(k.primarySoft), color: safe(k.primary) }}>
            3 kredi
          </span>
        </div>
      </div>
    </div>
  );
}

function ContrastLine({ report }: { report: ContrastReport }) {
  if (report.blocking.length)
    return (
      <details className="text-[11px] text-danger">
        <summary className="cursor-pointer">Okunurluk yetersiz ({report.blocking.length}); açılamaz</summary>
        <ul className="mt-1 list-disc pl-4">
          {report.blocking.map((c) => (
            <li key={c.pair}>
              {c.pair}: {c.ratio.toFixed(2)}:1 (en az {c.min}:1)
            </li>
          ))}
        </ul>
      </details>
    );
  if (report.warnings.length)
    return (
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">Okunurluk tamam · {report.warnings.length} küçük uyarı</summary>
        <ul className="mt-1 list-disc pl-4">
          {report.warnings.map((c) => (
            <li key={c.pair}>
              {c.pair}: {c.ratio.toFixed(2)}:1 (önerilen {c.min}:1)
            </li>
          ))}
        </ul>
      </details>
    );
  return (
    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <Check className="h-3 w-3" aria-hidden /> Okunurluk tamam
    </p>
  );
}

function PaletteCard({ p, isDefault, canEdit, onDefault, onToggle, onRemove }: { p: Item; isDefault: boolean; canEdit: boolean; onDefault: () => void; onToggle: () => void; onRemove: () => void }) {
  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-3 ${isDefault ? "border-primary" : "border-line"} ${p.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-fg">{p.name.tr}</span>
            <span className="text-xs text-muted-foreground">{p.name.en}</span>
            {isDefault && <Badge tone="good">Varsayılan</Badge>}
            {!p.enabled && <Badge tone="neutral">Kapalı</Badge>}
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">{p.id}</span>
        </div>
        {canEdit && (
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs">
            <span>{p.enabled ? "Açık" : "Kapalı"}</span>
            <input type="checkbox" role="switch" aria-label={`${p.name.tr}: ${p.enabled ? "açık" : "kapalı"}`} checked={p.enabled} onChange={onToggle} className="h-4 w-4 accent-[var(--primary)]" />
          </label>
        )}
      </div>
      <ToneStrip tones={p.tones} />
      <Preview tokens={p.tokens} />
      <ContrastLine report={p.contrast} />
      {canEdit && (
        <div className="flex items-center gap-1">
          {!isDefault && (
            <Button size="sm" variant="ghost" onClick={onDefault}>
              <Star className="h-3.5 w-3.5" aria-hidden /> Varsayılan yap
            </Button>
          )}
          {!isDefault && (
            <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`${p.name.tr} temasını sil`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Sil
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** New palette: paste six colours (darkest → lightest, e.g. "#211713 #493126 …"); the server derives the tokens. */
function NewPalette({ taken, onAdd }: { taken: string[]; onAdd: (p: Item) => void }) {
  const { toast } = useFeedback();
  const [tr, setTr] = useState("");
  const [en, setEn] = useState("");
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<{ tones: string[]; tokens: ThemeTokens; contrast: ContrastReport } | null>(null);
  const [busy, setBusy] = useState(false);
  const tones = (raw.match(/#?[0-9a-fA-F]{6}\b/g) ?? []).map((t) => `#${t.replace("#", "").toLowerCase()}`);
  const id = slugify(tr);
  const idOk = /^[a-z][a-z0-9-]{1,23}$/.test(id) && !taken.includes(id);

  async function derive() {
    setBusy(true);
    try {
      setPreview(await api<{ tones: string[]; tokens: ThemeTokens; contrast: ContrastReport }>("/theme/derive", { method: "POST", body: { tones } }));
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Önizlenemedi.");
    } finally {
      setBusy(false);
    }
  }

  function add() {
    if (!preview) return;
    const enabled = preview.contrast.blocking.length === 0;
    onAdd({ id, name: { tr: tr.trim(), en: en.trim() || tr.trim() }, tones: preview.tones, tokens: preview.tokens, enabled, contrast: preview.contrast });
    toast(enabled ? "success" : "error", enabled ? "Listeye eklendi; kaydetmeyi unutma." : "Okunurluk yetersiz: kapalı olarak eklendi.");
    setTr("");
    setEn("");
    setRaw("");
    setPreview(null);
  }

  return (
    <Card title={<span className="flex items-center gap-2"><Plus className="h-4 w-4" aria-hidden /> Yeni palet</span>}>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Ad (Türkçe)" htmlFor="np-tr" hint={tr ? `Kısa ad: ${id || "…"}${idOk ? "" : " (kullanılıyor ya da geçersiz)"}` : "Ör. Kahve"}>
          <Input id="np-tr" value={tr} maxLength={30} onChange={(e) => setTr(e.target.value)} />
        </Field>
        <Field label="Ad (İngilizce)" htmlFor="np-en" hint="Diğer diller bunu görür.">
          <Input id="np-en" value={en} maxLength={30} onChange={(e) => setEn(e.target.value)} placeholder="Coffee" />
        </Field>
        <Field label="6 renk, koyudan açığa" htmlFor="np-tones" hint={`${tones.length}/6 renk okundu. Görseldeki kodları olduğu gibi yapıştırabilirsin.`}>
          <Input
            id="np-tones"
            value={raw}
            maxLength={200}
            className="font-mono text-xs"
            onChange={(e) => {
              setRaw(e.target.value);
              setPreview(null);
            }}
            placeholder="#211713 #493126 #78533B #B18A62 #E0C58E #F6EEDB"
          />
        </Field>
      </div>
      {tones.length > 0 && (
        <div className="mt-3 max-w-md">
          <ToneStrip tones={tones.slice(0, 6)} />
        </div>
      )}
      {preview && (
        <div className="mt-3 grid max-w-md gap-2">
          <Preview tokens={preview.tokens} />
          <ContrastLine report={preview.contrast} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="ghost" loading={busy} disabled={tones.length !== 6} onClick={() => void derive()}>
          Önizle
        </Button>
        <Button variant="primary" disabled={!preview || !idOk || !tr.trim()} onClick={add}>
          {preview?.contrast.blocking.length ? <TriangleAlert className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Listeye ekle
        </Button>
      </div>
    </Card>
  );
}

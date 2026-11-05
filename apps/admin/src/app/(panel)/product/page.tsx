"use client";

import { ChevronDown, ChevronUp, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Select, Spinner } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { AdminMe, ProductCatalog, ProductColor, ProductFloor, ProductRoom, ProductState, ProductTool } from "@/lib/types";

// Ürün kataloğu (API.md §7.25): uygulamanın ve web'in sunduğu araçlar, oda tipleri, zeminler ve duvar renkleri.
// Kayıt birkaç saniye içinde web ve mobile yansır (ikisi de /v1/catalog'dan okur). Gerekçe ister ve denetlenir.

type Tab = "tools" | "rooms" | "floors" | "colors";
const TABS: { id: Tab; label: string }[] = [
  { id: "tools", label: "Araçlar" },
  { id: "rooms", label: "Odalar" },
  { id: "floors", label: "Zeminler" },
  { id: "colors", label: "Renkler" },
];
const LIMITS = { rooms: 40, floors: 30, colors: 30 } as const;
const CATEGORY: Record<string, string> = { interior: "İç mekân", exterior: "Dış mekân", edit: "Düzenleme" };
const NEEDS: Record<string, string> = {
  style: "stil", room: "oda", floor: "zemin", color: "renk", target: "nesne adı", replacement: "yerine gelecek",
  instructions: "serbest açıklama", reference: "referans fotoğraf", removeAll: "hepsini sil", points: "dokunarak seçim",
};
const PROMPT_OK = /^[A-Za-z0-9 ,'()/&.-]+$/;
const ID_OK = /^[a-z][a-z0-9_]{1,39}$/;
const HEX_OK = /^#[0-9A-Fa-f]{6}$/;

/** Saved rows keep their id; a new row's id follows its English name until the admin edits it. */
type Row<T> = T & { uid: string; saved: boolean; autoId: boolean };
type Draft = { tools: ProductTool[]; rooms: Row<ProductRoom>[]; floors: Row<ProductFloor>[]; colors: Row<ProductColor>[] };

// Row keys only; random so they never collide with rows already in state (e.g. after a hot reload).
const uid = () => crypto.randomUUID();
const wrap = <T,>(list: T[]): Row<T>[] => list.map((x) => ({ ...x, uid: uid(), saved: true, autoId: false }));
const strip = <T,>(list: Row<T>[]): T[] =>
  list.map((row) => {
    const x: Partial<Row<T>> = { ...row };
    delete x.uid;
    delete x.saved;
    delete x.autoId;
    return x as T;
  });
const slug = (v: string) =>
  v.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "").slice(0, 40);

function toDraft(c: ProductCatalog): Draft {
  return { tools: c.tools.map((t) => ({ ...t })), rooms: wrap(c.rooms), floors: wrap(c.floors), colors: wrap(c.colors) };
}

function fromDraft(d: Draft): ProductCatalog {
  const trim = <T extends { nameTr: string; nameEn: string }>(x: T): T => ({ ...x, nameTr: x.nameTr.trim(), nameEn: x.nameEn.trim() });
  return {
    tools: d.tools.map((t) => ({ ...trim(t), descriptionTr: t.descriptionTr.trim(), descriptionEn: t.descriptionEn.trim() })),
    rooms: strip(d.rooms).map((r) => ({ ...trim(r), prompt: r.prompt.trim() })),
    floors: strip(d.floors).map((f) => ({ ...trim(f), prompt: f.prompt.trim() })),
    colors: strip(d.colors).map((c) => ({ ...trim(c), hex: c.hex.toUpperCase() })),
  };
}

function move<T>(list: T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Problems the server would refuse, shown before saving (the server checks again). */
function problems(c: ProductCatalog): string[] {
  const out: string[] = [];
  const named = (x: { nameTr: string; nameEn: string; id: string }, what: string) => {
    if (!x.nameTr || !x.nameEn) out.push(`${what} “${x.nameTr || x.id}”: Türkçe ve İngilizce ad gerekli.`);
  };
  const ids = (list: { id: string }[], what: string) => {
    const seen = new Set<string>();
    for (const x of list) {
      if (!ID_OK.test(x.id)) out.push(`${what} kimliği “${x.id}” geçersiz (küçük harf, rakam, _; harfle başlar).`);
      if (seen.has(x.id)) out.push(`${what} kimliği “${x.id}” iki kez kullanılmış.`);
      seen.add(x.id);
    }
  };
  if (!c.tools.some((t) => t.enabled)) out.push("En az bir araç açık olmalı.");
  c.tools.forEach((t) => {
    if (!t.nameTr || !t.nameEn || !t.descriptionTr || !t.descriptionEn) out.push(`Araç “${t.nameTr || t.id}”: ad ve açıklama iki dilde gerekli.`);
  });
  ids(c.rooms, "Oda");
  ids(c.floors, "Zemin");
  ids(c.colors, "Renk");
  c.rooms.forEach((r) => {
    named(r, "Oda");
    if (!PROMPT_OK.test(r.prompt) || r.prompt.length < 2 || r.prompt.length > 60) out.push(`Oda “${r.nameTr || r.id}”: istem 2–60 karakter, yalnız İngilizce harf, rakam ve , ' ( ) / & . -`);
  });
  c.floors.forEach((f) => {
    named(f, "Zemin");
    if (!PROMPT_OK.test(f.prompt) || f.prompt.length < 2 || f.prompt.length > 80) out.push(`Zemin “${f.nameTr || f.id}”: istem 2–80 karakter, yalnız İngilizce harf, rakam ve , ' ( ) / & . -`);
  });
  c.colors.forEach((x) => {
    named(x, "Renk");
    if (!HEX_OK.test(x.hex)) out.push(`Renk “${x.nameTr || x.id}”: #RRGGBB biçiminde olmalı.`);
  });
  if (c.rooms.length && !c.rooms.some((r) => r.enabled)) out.push("En az bir oda açık olmalı.");
  if (c.tools.some((t) => t.enabled && t.id === "flooring") && !c.floors.some((f) => f.enabled)) out.push("Yeni Zemin aracı açıkken en az bir zemin açık olmalı.");
  return out;
}

export default function ProductPage() {
  const state = useApi<ProductState>("/product");
  const me = useApi<AdminMe>("/me");
  // Kept here, outside the editor, so a save (which remounts the editor) does not jump back to the first tab.
  const [tab, setTab] = useState<Tab>("tools");
  const s = state.data;
  return (
    <>
      <PageHeader
        title="Ürün kataloğu"
        description="Uygulamada ve web'de sunulan araçlar, oda tipleri, zeminler ve duvar renkleri. Kayıt birkaç saniye içinde web ve mobile yansır."
      />
      {state.error && !s ? (
        <ErrorState message={state.error.message} onRetry={state.reload} />
      ) : !s || !me.data ? (
        <Spinner />
      ) : (
        <Editor key={s.version ?? "default"} state={s} tab={tab} setTab={setTab} canEdit={["ADMIN", "SUPER_ADMIN"].includes(me.data.role)} onSaved={state.setData} onReload={state.reload} />
      )}
    </>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" /> {children}
    </label>
  );
}

function Order({ i, count, onMove, label }: { i: number; count: number; onMove: (by: -1 | 1) => void; label: string }) {
  return (
    <div className="flex flex-col">
      <button type="button" aria-label={`${label}: yukarı taşı`} disabled={i === 0} onClick={() => onMove(-1)} className="rounded p-0.5 text-muted-foreground hover:bg-surface-2 disabled:opacity-30">
        <ChevronUp className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" aria-label={`${label}: aşağı taşı`} disabled={i === count - 1} onClick={() => onMove(1)} className="rounded p-0.5 text-muted-foreground hover:bg-surface-2 disabled:opacity-30">
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function Editor({
  state, tab, setTab, canEdit, onSaved, onReload,
}: {
  state: ProductState;
  tab: Tab;
  setTab: (t: Tab) => void;
  canEdit: boolean;
  onSaved: (u: (p: ProductState | null) => ProductState) => void;
  onReload: () => void;
}) {
  const { toast, confirm } = useFeedback();
  const [draft, setDraft] = useState<Draft>(() => toDraft(state.catalog));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const next = useMemo(() => fromDraft(draft), [draft]);
  const dirty = JSON.stringify(next) !== JSON.stringify(state.catalog);
  const issues = useMemo(() => problems(next), [next]);
  const ro = !canEdit;

  const setTool = (id: string, patch: Partial<ProductTool>) => setDraft((d) => ({ ...d, tools: d.tools.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const setRow = <K extends "rooms" | "floors" | "colors">(k: K, u: string, patch: Partial<Draft[K][number]>) =>
    setDraft((d) => ({
      ...d,
      [k]: (d[k] as Row<{ id: string; nameEn: string }>[]).map((x) => {
        if (x.uid !== u) return x;
        const merged = { ...x, ...patch } as Row<{ id: string; nameEn: string }>;
        if ("id" in patch) merged.autoId = false;
        else if (merged.autoId && "nameEn" in patch) merged.id = slug(merged.nameEn);
        return merged;
      }),
    }));
  const moveIn = <K extends keyof Draft>(k: K, i: number, by: -1 | 1) => setDraft((d) => ({ ...d, [k]: move(d[k] as unknown[], i, by) }));

  async function removeRow(k: "rooms" | "floors", row: Row<ProductRoom> | Row<ProductFloor>) {
    const used = state.usage[k][row.id] ?? 0;
    if (row.saved && used > 0) {
      const ok = await confirm({
        title: `“${row.nameTr}” listeden çıkıyor`,
        description: `${fmtInt(used)} tasarımda kullanılmış. Bu tasarımlar adıyla görünmeye devam eder; yeni tasarımda seçilemez. Yalnız gizlemek istersen “Açık” işaretini kaldır.`,
        confirmLabel: "Çıkar",
      });
      if (!ok) return;
    }
    setDraft((d) => ({ ...d, [k]: (d[k] as { uid: string }[]).filter((x) => x.uid !== row.uid) }));
  }

  function addRoom() {
    setDraft((d) => ({ ...d, rooms: [...d.rooms, { uid: uid(), saved: false, autoId: true, id: "", nameTr: "", nameEn: "", prompt: "", icon: state.roomIcons[0] ?? "home-outline", enabled: true }] }));
  }
  function addFloor() {
    setDraft((d) => ({ ...d, floors: [...d.floors, { uid: uid(), saved: false, autoId: true, id: "", nameTr: "", nameEn: "", prompt: "", enabled: true }] }));
  }
  function addColor() {
    setDraft((d) => ({ ...d, colors: [...d.colors, { uid: uid(), saved: false, autoId: true, id: "", nameTr: "", nameEn: "", hex: "#C8B8A6", enabled: true }] }));
  }

  async function save() {
    const offTools = next.tools.filter((t) => !t.enabled && state.catalog.tools.find((x) => x.id === t.id)?.enabled);
    if (offTools.length) {
      const ok = await confirm({
        title: "Araç kapanıyor",
        description: `${offTools.map((t) => `“${t.nameTr}”`).join(", ")} web ve uygulamadan kalkacak; eski uygulamadan gelen istek “Bu araç şu an kullanılamıyor” yanıtı alır. Eski tasarımlar etkilenmez.`,
        confirmLabel: "Kaydet",
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const saved = await api<ProductState>("/product", { method: "PATCH", body: { catalog: next, reason: reason.trim(), version: state.version } });
      setReason("");
      onSaved(() => saved);
      toast("success", "Katalog kaydedildi; web ve uygulama birkaç saniye içinde güncellenir.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (await confirm({ title: "Katalog bu arada değişti", description: "Başka biri kaydetmiş. Güncel hâli yüklensin mi? Buradaki değişikliklerin kaybolur.", confirmLabel: "Yükle" })) onReload();
      } else toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  const count = (list: { enabled: boolean }[]) => `${list.filter((x) => x.enabled).length}/${list.length}`;
  const counts: Record<Tab, string> = { tools: count(draft.tools), rooms: count(draft.rooms), floors: count(draft.floors), colors: count(draft.colors) };

  return (
    <div className="flex flex-col gap-4">
      {!state.saved && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
          Katalog henüz kaydedilmedi: şu an koddaki varsayılan liste kullanılıyor. İlk kayıttan sonra buradan yönetilir.
        </p>
      )}
      {ro && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted-foreground">Görüntüleme yetkin var; değiştirmek için yönetici rolü gerekir.</p>}

      <div role="tablist" aria-label="Katalog bölümleri" className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === t.id ? "bg-primary text-primary-fg" : "text-fg hover:bg-surface-2"}`}
          >
            {t.label} <span className="ml-1 text-xs opacity-75">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {tab === "tools" && (
        <Card title="Araçlar">
          <fieldset disabled={ro} className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Aracın ne yaptığı kodda tanımlıdır; burada açılıp kapatılır, PRO&apos;ya özel yapılır, adı ve sırası değişir. Kapanan araç web ve uygulamadan kalkar. Diğer 9 dil, İngilizce ad
              değişmedikçe çeviriyi kullanır; değişirse İngilizcesi görünür.
            </p>
            {draft.tools.map((t, i) => {
              const info = state.toolInfo[t.id];
              const def = state.defaults.tools.find((x) => x.id === t.id);
              const changed = def && (def.nameTr !== t.nameTr || def.nameEn !== t.nameEn || def.descriptionTr !== t.descriptionTr || def.descriptionEn !== t.descriptionEn);
              return (
                <div key={t.id} className={`flex gap-2 rounded-lg border border-line p-3 ${t.enabled ? "" : "bg-surface-2 opacity-75"}`}>
                  {canEdit && <Order i={i} count={draft.tools.length} label={t.nameTr} onMove={(by) => moveIn("tools", i, by)} />}
                  <div className="grid flex-1 gap-3 md:grid-cols-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:col-span-2">
                      <span className="font-medium text-fg">{t.nameTr}</span>
                      <Badge tone="neutral">{CATEGORY[info?.category ?? ""] ?? info?.category}</Badge>
                      <span className="font-mono text-[11px] text-muted-foreground">{t.id}</span>
                      <span className="text-xs text-muted-foreground">İstediği: {(info?.needs ?? []).map((n) => NEEDS[n] ?? n).join(", ") || "—"}</span>
                      <div className="ml-auto flex items-center gap-4">
                        <Check checked={t.enabled} onChange={(v) => setTool(t.id, { enabled: v })}>Açık</Check>
                        <Check checked={t.isPro} onChange={(v) => setTool(t.id, { isPro: v })}>PRO</Check>
                        <Check checked={t.isNew} onChange={(v) => setTool(t.id, { isNew: v })}>Yeni rozeti</Check>
                      </div>
                    </div>
                    <Field label="Ad (Türkçe)" htmlFor={`t-ntr-${t.id}`}>
                      <Input id={`t-ntr-${t.id}`} value={t.nameTr} maxLength={40} onChange={(e) => setTool(t.id, { nameTr: e.target.value })} />
                    </Field>
                    <Field label="Ad (İngilizce)" htmlFor={`t-nen-${t.id}`}>
                      <Input id={`t-nen-${t.id}`} value={t.nameEn} maxLength={40} onChange={(e) => setTool(t.id, { nameEn: e.target.value })} />
                    </Field>
                    <Field label="Açıklama (Türkçe)" htmlFor={`t-dtr-${t.id}`}>
                      <Input id={`t-dtr-${t.id}`} value={t.descriptionTr} maxLength={120} onChange={(e) => setTool(t.id, { descriptionTr: e.target.value })} />
                    </Field>
                    <Field label="Açıklama (İngilizce)" htmlFor={`t-den-${t.id}`}>
                      <Input id={`t-den-${t.id}`} value={t.descriptionEn} maxLength={120} onChange={(e) => setTool(t.id, { descriptionEn: e.target.value })} />
                    </Field>
                    {changed && canEdit && (
                      <button
                        type="button"
                        onClick={() => setTool(t.id, { nameTr: def.nameTr, nameEn: def.nameEn, descriptionTr: def.descriptionTr, descriptionEn: def.descriptionEn })}
                        className="flex items-center gap-1 justify-self-start text-xs text-primary hover:underline md:col-span-2"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden /> Ad ve açıklamayı varsayılana döndür
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </fieldset>
        </Card>
      )}

      {tab === "rooms" && (
        <Card
          title="Oda tipleri"
          actions={
            canEdit && (
              <Button size="sm" onClick={addRoom} disabled={draft.rooms.length >= LIMITS.rooms}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> Oda ekle
              </Button>
            )
          }
        >
          <fieldset disabled={ro} className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              İstem, görsel modeline giden İngilizce kelimedir (örn. <span className="font-mono">living room</span>). Kapatılan oda yeni tasarımda seçilemez; listeden çıkarılan oda eski tasarımlarda
              adıyla görünmeye devam eder.{state.retired.rooms > 0 && ` Listeden çıkmış ${fmtInt(state.retired.rooms)} oda bu yüzden hâlâ tanınıyor.`}
            </p>
            {draft.rooms.map((r, i) => (
              <EntryRow
                key={r.uid}
                i={i}
                count={draft.rooms.length}
                canEdit={canEdit}
                row={r}
                used={state.usage.rooms[r.id] ?? 0}
                onMove={(by) => moveIn("rooms", i, by)}
                onChange={(p) => setRow("rooms", r.uid, p)}
                onRemove={() => void removeRow("rooms", r)}
                promptMax={60}
                extra={
                  <Field label="Simge" htmlFor={`icon-${r.uid}`}>
                    <Select id={`icon-${r.uid}`} value={r.icon} onChange={(e) => setRow("rooms", r.uid, { icon: e.target.value })}>
                      {state.roomIcons.map((ic) => (
                        <option key={ic} value={ic}>
                          {ic.replace(/-outline$/, "")}
                        </option>
                      ))}
                    </Select>
                  </Field>
                }
              />
            ))}
          </fieldset>
        </Card>
      )}

      {tab === "floors" && (
        <Card
          title="Zeminler"
          actions={
            canEdit && (
              <Button size="sm" onClick={addFloor} disabled={draft.floors.length >= LIMITS.floors}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> Zemin ekle
              </Button>
            )
          }
        >
          <fieldset disabled={ro} className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              “Yeni Zemin” aracında seçilen malzemeler. İstem İngilizce tarif olmalı (örn. <span className="font-mono">herringbone oak parquet</span>).
              {state.retired.floors > 0 && ` Listeden çıkmış ${fmtInt(state.retired.floors)} zemin eski tasarımlar için tanınıyor.`}
            </p>
            {draft.floors.map((f, i) => (
              <EntryRow
                key={f.uid}
                i={i}
                count={draft.floors.length}
                canEdit={canEdit}
                row={f}
                used={state.usage.floors[f.id] ?? 0}
                onMove={(by) => moveIn("floors", i, by)}
                onChange={(p) => setRow("floors", f.uid, p)}
                onRemove={() => void removeRow("floors", f)}
                promptMax={80}
              />
            ))}
          </fieldset>
        </Card>
      )}

      {tab === "colors" && (
        <Card
          title="Duvar renkleri"
          actions={
            canEdit && (
              <Button size="sm" onClick={addColor} disabled={draft.colors.length >= LIMITS.colors}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> Renk ekle
              </Button>
            )
          }
        >
          <fieldset disabled={ro} className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">“Duvar Boyası” aracındaki hazır renkler. Kullanıcı yine kendi rengini de seçebilir.</p>
            {draft.colors.map((c, i) => (
              <div key={c.uid} className={`flex gap-2 rounded-lg border border-line p-3 ${c.enabled ? "" : "bg-surface-2 opacity-75"}`}>
                {canEdit && <Order i={i} count={draft.colors.length} label={c.nameTr || c.id} onMove={(by) => moveIn("colors", i, by)} />}
                <div className="grid flex-1 items-end gap-3 md:grid-cols-[auto_1fr_1fr_8rem_auto]">
                  <input
                    type="color"
                    aria-label={`${c.nameTr || "Renk"}: renk seç`}
                    value={HEX_OK.test(c.hex) ? c.hex : "#000000"}
                    onChange={(e) => setRow("colors", c.uid, { hex: e.target.value.toUpperCase() })}
                    className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-surface p-1"
                  />
                  <Field label="Ad (Türkçe)" htmlFor={`c-ntr-${c.uid}`}>
                    <Input id={`c-ntr-${c.uid}`} value={c.nameTr} maxLength={40} onChange={(e) => setRow("colors", c.uid, { nameTr: e.target.value })} />
                  </Field>
                  <Field label="Ad (İngilizce)" htmlFor={`c-nen-${c.uid}`}>
                    <Input id={`c-nen-${c.uid}`} value={c.nameEn} maxLength={40} onChange={(e) => setRow("colors", c.uid, { nameEn: e.target.value })} />
                  </Field>
                  <Field label="Kod" htmlFor={`c-hex-${c.uid}`}>
                    <Input id={`c-hex-${c.uid}`} value={c.hex} maxLength={7} className="font-mono text-xs" onChange={(e) => setRow("colors", c.uid, { hex: e.target.value })} />
                  </Field>
                  <div className="flex items-center gap-3 pb-2">
                    <Check checked={c.enabled} onChange={(v) => setRow("colors", c.uid, { enabled: v })}>Açık</Check>
                    {canEdit && (
                      <button type="button" aria-label={`${c.nameTr || "Renk"}: kaldır`} onClick={() => setDraft((d) => ({ ...d, colors: d.colors.filter((x) => x.uid !== c.uid) }))} className="text-danger hover:opacity-80">
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </div>
                  {!c.saved && (
                    <Field label="Kimlik" htmlFor={`c-id-${c.uid}`} hint="küçük harf, rakam, _">
                      <Input id={`c-id-${c.uid}`} value={c.id} maxLength={40} className="font-mono text-xs" onChange={(e) => setRow("colors", c.uid, { id: e.target.value })} />
                    </Field>
                  )}
                </div>
              </div>
            ))}
          </fieldset>
        </Card>
      )}

      {canEdit && (
        <Card>
          {dirty && issues.length > 0 && (
            <ul className="mb-3 list-disc rounded-lg bg-danger/10 py-2 pl-7 pr-3 text-xs text-danger">
              {issues.slice(0, 6).map((m) => (
                <li key={m}>{m}</li>
              ))}
              {issues.length > 6 && <li>… ve {issues.length - 6} sorun daha</li>}
            </ul>
          )}
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <Field label="Değişiklik gerekçesi" htmlFor="product-reason" hint="Denetim kaydına yazılır (en az 3 karakter).">
                <Input id="product-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Örn. bahçe aracı bakımda, çatı katı odası eklendi" />
              </Field>
            </div>
            <Button variant="primary" onClick={save} loading={saving} disabled={!dirty || issues.length > 0 || reason.trim().length < 3}>
              <Save className="h-4 w-4" aria-hidden /> Kaydet
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {dirty ? "Kaydedilmemiş değişiklik var (tüm sekmeler birlikte kaydedilir)." : "Değişiklik yok."}
            {state.updatedAt && ` Son kayıt: ${fmtDateTime(state.updatedAt)}${state.updatedBy ? ` · ${state.updatedBy}` : ""}.`}
          </p>
        </Card>
      )}
    </div>
  );
}

function EntryRow({
  i, count, canEdit, row, used, onMove, onChange, onRemove, promptMax, extra,
}: {
  i: number;
  count: number;
  canEdit: boolean;
  row: Row<ProductRoom> | Row<ProductFloor>;
  used: number;
  onMove: (by: -1 | 1) => void;
  onChange: (p: Partial<ProductRoom & ProductFloor>) => void;
  onRemove: () => void;
  promptMax: number;
  extra?: ReactNode;
}) {
  const promptBad = row.prompt.trim() !== "" && !PROMPT_OK.test(row.prompt.trim());
  return (
    <div className={`flex gap-2 rounded-lg border border-line p-3 ${row.enabled ? "" : "bg-surface-2 opacity-75"}`}>
      {canEdit && <Order i={i} count={count} label={row.nameTr || row.id} onMove={onMove} />}
      <div className={`grid flex-1 gap-3 ${extra ? "md:grid-cols-[1fr_1fr_1.4fr_10rem]" : "md:grid-cols-[1fr_1fr_1.4fr]"}`}>
        <Field label="Ad (Türkçe)" htmlFor={`ntr-${row.uid}`}>
          <Input id={`ntr-${row.uid}`} value={row.nameTr} maxLength={40} onChange={(e) => onChange({ nameTr: e.target.value })} />
        </Field>
        <Field label="Ad (İngilizce)" htmlFor={`nen-${row.uid}`}>
          <Input id={`nen-${row.uid}`} value={row.nameEn} maxLength={40} onChange={(e) => onChange({ nameEn: e.target.value })} />
        </Field>
        <Field label="İstem (İngilizce)" htmlFor={`pr-${row.uid}`} hint={promptBad ? "Yalnız İngilizce harf, rakam ve , ' ( ) / & . -" : `${row.prompt.length}/${promptMax}`}>
          <Input id={`pr-${row.uid}`} value={row.prompt} maxLength={promptMax} aria-invalid={promptBad} className={promptBad ? "border-danger" : ""} onChange={(e) => onChange({ prompt: e.target.value })} />
        </Field>
        {extra}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs md:col-span-full">
          {row.saved ? (
            <span className="font-mono text-[11px] text-muted-foreground">{row.id}</span>
          ) : (
            <label className="flex items-center gap-2">
              Kimlik
              <Input aria-label="Kimlik" value={row.id} maxLength={40} className="h-8 w-48 font-mono text-xs" onChange={(e) => onChange({ id: e.target.value })} />
            </label>
          )}
          <span className="text-muted-foreground">{used > 0 ? `${fmtInt(used)} tasarımda kullanıldı` : "Henüz kullanılmadı"}</span>
          <div className="ml-auto flex items-center gap-4">
            <Check checked={row.enabled} onChange={(v) => onChange({ enabled: v })}>Açık</Check>
            {canEdit && (
              <Button size="sm" variant="ghost" className="text-danger" onClick={onRemove}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Listeden çıkar
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { ArrowDown, ArrowUp, ExternalLink, Pencil, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import {
  LOCALES,
  LOCALE_LABELS,
  SITE_FAQ_LIMITS,
  SITE_LIST_LIMITS,
  SITE_SECTIONS,
  SITE_TEXT_LIMITS,
  type AdminMe,
  type FaqItem,
  type Locale,
  type SiteAnnouncement,
  type SiteContentDoc,
  type SiteContentState,
  type SiteListKey,
  type SiteLocaleTexts,
  type SiteSection,
  type SiteTextKey,
} from "@/lib/types";

// Ana sayfa ve SSS (API.md §7.46): casalume.app ana sayfasının metinleri, SSS, görünen bölümler ve her sayfanın
// üstündeki duyuru çubuğu. Boş bırakılan metin sitenin kendi çevirisini kullanır; sitenin bugünkü metni alanın içinde
// soluk görünür. SUPPORT görür; EDITOR ve üstü kaydeder (gerekçe zorunlu, denetim kaydına girer).

const WEB = (process.env.NEXT_PUBLIC_WEB_URL ?? "https://casalume.app").replace(/\/$/, "");
const LINK_RE = /^\/(studio|fiyatlar|sohbet|blog(\/[a-z0-9]+(?:-[a-z0-9]+)*)?)$/;
const LINKS: Array<[string, string]> = [
  ["/studio", "Stüdyo"],
  ["/fiyatlar", "Fiyatlar"],
  ["/sohbet", "Sohbet"],
  ["/blog", "Blog"],
];
const TEXT_KEYS = Object.keys(SITE_TEXT_LIMITS) as SiteTextKey[];
const LIST_KEYS = Object.keys(SITE_LIST_LIMITS) as SiteListKey[];

const SECTION_LABELS: Record<SiteSection, string> = {
  gallery: "Örnekler (önce / sonra)",
  tools: "Araçlar",
  features: "Özellikler",
  pro: "Mimarlar için",
  how: "Nasıl çalışır",
  styles: "Stiller",
  pricing: "Fiyatlar",
  app: "Mobil uygulama ve bekleme listesi",
  faq: "Sık sorulan sorular",
};

type Group = { title: string; section?: SiteSection; texts: SiteTextKey[]; list?: SiteListKey };
const GROUPS: Group[] = [
  { title: "Üst bölüm", texts: ["badge", "heroTitle", "heroText", "ctaPrimary", "ctaSecondary"], list: "trust" },
  { title: "Örnekler", section: "gallery", texts: ["galleryTitle", "galleryText"] },
  { title: "Araçlar", section: "tools", texts: ["toolsTitle", "toolsText", "moreTools"] },
  { title: "Özellikler", section: "features", texts: ["featuresTitle", "featuresText"] },
  { title: "Mimarlar için", section: "pro", texts: ["proBadge", "proTitle", "proText"], list: "proPoints" },
  { title: "Nasıl çalışır", section: "how", texts: ["howTitle"] },
  { title: "Stiller", section: "styles", texts: ["stylesTitle", "stylesText"] },
  { title: "Fiyatlar", section: "pricing", texts: ["pricingTitle", "pricingText"] },
  { title: "Son çağrı", texts: ["finalTitle", "finalCta"] },
];
const TEXT_LABELS: Record<SiteTextKey, string> = {
  badge: "Rozet",
  heroTitle: "Başlık",
  heroText: "Açıklama",
  ctaPrimary: "Ana düğme",
  ctaSecondary: "İkinci düğme",
  galleryTitle: "Başlık",
  galleryText: "Açıklama",
  toolsTitle: "Başlık",
  toolsText: "Açıklama",
  moreTools: "Alt not",
  featuresTitle: "Başlık",
  featuresText: "Açıklama",
  proBadge: "Rozet",
  proTitle: "Başlık",
  proText: "Açıklama",
  howTitle: "Başlık",
  stylesTitle: "Başlık",
  stylesText: "Açıklama",
  pricingTitle: "Başlık",
  pricingText: "Açıklama",
  faqTitle: "Başlık",
  finalTitle: "Başlık",
  finalCta: "Düğme",
};
const LONG = new Set<SiteTextKey>(["heroText", "proText"]);
const LIST_LABELS: Record<SiteListKey, string> = { trust: "Güven maddeleri", proPoints: "Maddeler" };
const TONES: Array<[SiteAnnouncement["tone"], string]> = [
  ["info", "Bilgi"],
  ["promo", "Kampanya"],
  ["warning", "Uyarı"],
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What is sent: trimmed, empty parts removed, and anything equal to the site's own text dropped (it is the default). */
function clean(doc: SiteContentDoc, defaults: SiteContentState["defaults"]): SiteContentDoc {
  const texts: SiteContentDoc["texts"] = {};
  for (const l of LOCALES) {
    const t = doc.texts[l];
    const d = defaults[l];
    if (!t) continue;
    const out: SiteLocaleTexts = {};
    for (const k of TEXT_KEYS) {
      const v = t[k]?.trim();
      if (v && v !== d?.[k]) out[k] = v;
    }
    for (const k of LIST_KEYS) {
      const v = t[k]?.map((x) => x.trim()).filter(Boolean);
      if (v?.length && !same(v, d?.[k])) out[k] = v;
    }
    const faq = t.faq?.map((f) => ({ q: f.q.trim(), a: f.a.trim() })).filter((f) => f.q || f.a);
    if (faq?.length && !same(faq, d?.faq)) out.faq = faq;
    if (Object.keys(out).length) texts[l] = out;
  }
  const text: SiteAnnouncement["text"] = {};
  for (const l of LOCALES) {
    const v = doc.announcement.text[l]?.trim();
    if (v) text[l] = v;
  }
  return { sections: doc.sections, announcement: { ...doc.announcement, text }, texts };
}

/** ISO → datetime-local (browser time) and back. */
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);

export default function SiteContentPage() {
  const state = useApi<SiteContentState>("/site-content");
  const me = useApi<AdminMe>("/me");
  const s = state.data;
  const canEdit = me.data ? ["EDITOR", "ADMIN", "SUPER_ADMIN"].includes(me.data.role) : false;
  return (
    <>
      <PageHeader
        title="Ana sayfa ve SSS"
        description="casalume.app ana sayfasının metinleri, sık sorulan sorular, görünen bölümler ve her sayfanın üstündeki duyuru çubuğu. Boş bırakılan metin sitenin kendi çevirisini kullanır. Kayıttan sonra sitede birkaç dakika içinde görünür."
        actions={
          <a href={WEB} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">
            <ExternalLink className="h-4 w-4" aria-hidden /> Siteyi aç
          </a>
        }
      />
      {state.error && !s ? (
        <ErrorState message={state.error.message} onRetry={state.reload} />
      ) : !s || !me.data ? (
        <Spinner />
      ) : (
        <Editor key={s.version ?? "default"} state={s} canEdit={canEdit} onSaved={(n) => state.setData(() => n)} onReload={state.reload} />
      )}
    </>
  );
}

function Editor({ state, canEdit, onSaved, onReload }: { state: SiteContentState; canEdit: boolean; onSaved: (s: SiteContentState) => void; onReload: () => void }) {
  const { toast, confirm } = useFeedback();
  const [doc, setDoc] = useState<SiteContentDoc>(state.content);
  const [locale, setLocale] = useState<Locale>("tr");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const next = clean(doc, state.defaults);
  const dirty = !same(next, clean(state.content, state.defaults));
  const texts = doc.texts[locale] ?? {};
  const defaults = state.defaults[locale];
  const linkOk = !next.announcement.link || LINK_RE.test(next.announcement.link);

  const setTexts = (fn: (t: SiteLocaleTexts) => SiteLocaleTexts) => setDoc((d) => ({ ...d, texts: { ...d.texts, [locale]: fn(d.texts[locale] ?? {}) } }));
  const setAnnouncement = (a: Partial<SiteAnnouncement>) => setDoc((d) => ({ ...d, announcement: { ...d.announcement, ...a } }));

  async function save() {
    setBusy(true);
    try {
      const out = await api<SiteContentState>("/site-content", { method: "PATCH", body: { content: next, reason: reason.trim(), version: state.version } });
      setReason("");
      onSaved(out);
      toast("success", out.changes?.length ? "Kaydedildi. Sitede birkaç dakika içinde görünür." : "Değişiklik yoktu.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (await confirm({ title: "İçerik bu arada değişti", description: "Güncel hâli yüklensin mi? Buradaki kaydedilmemiş değişiklikler gider.", confirmLabel: "Yükle" })) onReload();
      } else toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Bölümler">
          <p className="mb-2 text-xs text-muted-foreground">Kapalı bölüm ana sayfada gösterilmez. Üst bölüm ve son çağrı her zaman görünür.</p>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {SITE_SECTIONS.map((k) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 py-1.5 text-sm">
                <input
                  type="checkbox"
                  role="switch"
                  checked={doc.sections[k]}
                  disabled={!canEdit}
                  onChange={(e) => setDoc((d) => ({ ...d, sections: { ...d.sections, [k]: e.target.checked } }))}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                {SECTION_LABELS[k]}
              </label>
            ))}
          </div>
        </Card>
        <AnnouncementCard a={doc.announcement} canEdit={canEdit} linkOk={linkOk} onChange={setAnnouncement} />
      </div>

      <Card
        title="Metinler ve SSS"
        actions={
          <>
            <Select aria-label="Dil" value={locale} onChange={(e) => setLocale(e.target.value as Locale)} className="h-8 w-48">
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABELS[l]}
                  {next.texts[l] ? " · özel" : ""}
                </option>
              ))}
            </Select>
            <a href={`${WEB}/${locale === "tr" ? "" : locale}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium hover:bg-surface-2">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Sitede gör
            </a>
          </>
        }
      >
        {!defaults && <p className="mb-3 text-xs text-danger">Sitenin bu dildeki metinleri okunamadı; boş alanlar yine sitenin kendi metnini kullanır.</p>}
        <p className="mb-4 text-xs text-muted-foreground">
          Soluk yazı sitenin bugünkü metnidir. Bir alanı değiştirdiğinde yalnız o dilde geçerli olur; diğer diller kendi çevirisini gösterir.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {GROUPS.map((g) => (
            <Fieldset key={g.title} title={g.title} hidden={g.section ? !doc.sections[g.section] : false}>
              {g.texts.map((k) => (
                <TextField
                  key={k}
                  id={`t-${locale}-${k}`}
                  label={TEXT_LABELS[k]}
                  value={texts[k]}
                  fallback={defaults?.[k] ?? ""}
                  max={SITE_TEXT_LIMITS[k]}
                  long={LONG.has(k)}
                  disabled={!canEdit}
                  onChange={(v) => setTexts((t) => ({ ...t, [k]: v }))}
                />
              ))}
              {g.list && (
                <ListField
                  label={LIST_LABELS[g.list]}
                  items={texts[g.list]}
                  fallback={defaults?.[g.list] ?? []}
                  limits={SITE_LIST_LIMITS[g.list]}
                  disabled={!canEdit}
                  onChange={(v) => setTexts((t) => ({ ...t, [g.list!]: v }))}
                />
              )}
            </Fieldset>
          ))}
        </div>
        <div className="mt-4">
          <Fieldset title="Sık sorulan sorular" hidden={!doc.sections.faq}>
            <TextField
              id={`t-${locale}-faqTitle`}
              label={TEXT_LABELS.faqTitle}
              value={texts.faqTitle}
              fallback={defaults?.faqTitle ?? ""}
              max={SITE_TEXT_LIMITS.faqTitle}
              disabled={!canEdit}
              onChange={(v) => setTexts((t) => ({ ...t, faqTitle: v }))}
            />
            <FaqEditor items={texts.faq} fallback={defaults?.faq ?? []} disabled={!canEdit} onChange={(v) => setTexts((t) => ({ ...t, faq: v }))} />
          </Fieldset>
        </div>
      </Card>

      <Card>
        {canEdit ? (
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <Field label="Değişiklik gerekçesi" htmlFor="site-reason" hint={dirty ? "Kaydedilmemiş değişiklik var." : undefined}>
                <Input id="site-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
            <Button variant="primary" loading={busy} disabled={!dirty || !linkOk || reason.trim().length < 3 || busy} onClick={() => void save()}>
              <Save className="h-4 w-4" aria-hidden /> Kaydet
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Bu ekranı düzenlemek için Editör ya da üstü yetki gerekir.</p>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {state.updatedAt ? `Son kayıt: ${fmtDateTime(state.updatedAt)}${state.updatedBy ? ` · ${state.updatedBy}` : ""}.` : "Henüz kayıt yok; site kendi metinlerini kullanıyor."}
        </p>
      </Card>
    </div>
  );
}

function Fieldset({ title, hidden, children }: { title: string; hidden: boolean; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-3">
      <legend className="flex items-center gap-2 px-1 text-[13px] font-semibold">
        {title} {hidden && <Badge tone="warn">bölüm kapalı</Badge>}
      </legend>
      {children}
    </fieldset>
  );
}

function TextField({ id, label, value, fallback, max, long, disabled, onChange }: { id: string; label: string; value: string | undefined; fallback: string; max: number; long?: boolean; disabled: boolean; onChange: (v: string | undefined) => void }) {
  const custom = value !== undefined && value !== "";
  const set = (v: string) => onChange(v === "" ? undefined : v);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {label} {custom && <Badge tone="primary">özel</Badge>}
        </label>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {(value ?? fallback).length}/{max}
        </span>
      </div>
      <div className="flex items-start gap-1">
        {long ? (
          <Textarea id={id} rows={3} value={value ?? ""} placeholder={fallback} maxLength={max} disabled={disabled} onChange={(e) => set(e.target.value)} />
        ) : (
          <Input id={id} value={value ?? ""} placeholder={fallback} maxLength={max} disabled={disabled} onChange={(e) => set(e.target.value)} />
        )}
        {custom && !disabled && (
          <Button size="sm" variant="ghost" className="mt-0.5" title="Sitenin kendi metnine dön" aria-label={`${label}: sitenin kendi metnine dön`} onClick={() => onChange(undefined)}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

function ListField({ label, items, fallback, limits, disabled, onChange }: { label: string; items: string[] | undefined; fallback: string[]; limits: { items: number; length: number }; disabled: boolean; onChange: (v: string[] | undefined) => void }) {
  if (!items) {
    return (
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          {!disabled && (
            <Button size="sm" variant="ghost" onClick={() => onChange([...fallback])}>
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Düzenle
            </Button>
          )}
        </div>
        <ul className="list-inside list-disc text-sm text-muted-foreground">
          {fallback.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {label} <Badge tone="primary">özel</Badge>
        </span>
        {!disabled && (
          <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Sitenin kendi metni
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map((x, i) => (
          <div key={i} className="flex items-center gap-1">
            <Input aria-label={`${label} ${i + 1}`} value={x} maxLength={limits.length} disabled={disabled} onChange={(e) => onChange(items.map((y, j) => (j === i ? e.target.value : y)))} />
            {!disabled && (
              <Button size="sm" variant="ghost" aria-label={`${label} ${i + 1}: sil`} disabled={items.length <= 1} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            )}
          </div>
        ))}
        {!disabled && items.length < limits.items && (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => onChange([...items, ""])}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Madde ekle
          </Button>
        )}
      </div>
    </div>
  );
}

function FaqEditor({ items, fallback, disabled, onChange }: { items: FaqItem[] | undefined; fallback: FaqItem[]; disabled: boolean; onChange: (v: FaqItem[] | undefined) => void }) {
  if (!items) {
    return (
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Sitenin kendi soruları gösteriliyor ({fallback.length}).</span>
          {!disabled && (
            <Button size="sm" variant="secondary" onClick={() => onChange(fallback.map((f) => ({ ...f })))}>
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Soruları düzenle
            </Button>
          )}
        </div>
        <ol className="flex flex-col gap-2 text-sm">
          {fallback.map((f, i) => (
            <li key={f.q} className="rounded-lg bg-surface-2 px-3 py-2">
              <p className="font-medium">
                {i + 1}. {f.q}
              </p>
              <p className="mt-1 whitespace-pre-line text-muted-foreground">{f.a}</p>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  const move = (i: number, d: -1 | 1) => {
    const out = [...items];
    [out[i], out[i + d]] = [out[i + d], out[i]];
    onChange(out);
  };
  const qs = items.map((f) => f.q.trim().toLocaleLowerCase("tr")).filter(Boolean);
  const dup = qs.length !== new Set(qs).size;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge tone="primary">özel</Badge> {items.length} soru (en çok {SITE_FAQ_LIMITS.items})
        </span>
        {!disabled && (
          <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Sitenin kendi soruları
          </Button>
        )}
      </div>
      {dup && <p className="text-xs text-danger">Aynı soru iki kez yazılmış.</p>}
      {items.map((f, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-line p-2.5">
          <div className="flex items-center gap-1">
            <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
            <Input aria-label={`Soru ${i + 1}`} placeholder="Soru" value={f.q} maxLength={SITE_FAQ_LIMITS.q} disabled={disabled} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
            {!disabled && (
              <>
                <Button size="sm" variant="ghost" aria-label={`Soru ${i + 1}: yukarı`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Soru ${i + 1}: aşağı`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Soru ${i + 1}: sil`} disabled={items.length <= 1} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </>
            )}
          </div>
          <Textarea aria-label={`Cevap ${i + 1}`} placeholder="Cevap (boş satırla paragraf ayrılır)" rows={3} value={f.a} maxLength={SITE_FAQ_LIMITS.a} disabled={disabled} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} />
          <span className="self-end text-[11px] tabular-nums text-muted-foreground">
            {f.a.length}/{SITE_FAQ_LIMITS.a}
          </span>
        </div>
      ))}
      {!disabled && items.length < SITE_FAQ_LIMITS.items && (
        <Button size="sm" variant="secondary" className="self-start" onClick={() => onChange([...items, { q: "", a: "" }])}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Soru ekle
        </Button>
      )}
    </div>
  );
}

function AnnouncementCard({ a, canEdit, linkOk, onChange }: { a: SiteAnnouncement; canEdit: boolean; linkOk: boolean; onChange: (a: Partial<SiteAnnouncement>) => void }) {
  const [now] = useState(() => Date.now());
  const linkChoice = a.link === null ? "" : LINKS.some(([p]) => p === a.link) ? a.link : "post";
  const hasText = LOCALES.some((l) => a.text[l]?.trim());
  const status = !a.enabled
    ? { tone: "neutral" as const, label: "kapalı" }
    : a.endsAt && Date.parse(a.endsAt) <= now
      ? { tone: "warn" as const, label: "süresi doldu" }
      : a.startsAt && Date.parse(a.startsAt) > now
        ? { tone: "primary" as const, label: "planlandı" }
        : { tone: "good" as const, label: "yayında" };
  const preview = a.text.tr?.trim() || a.text.en?.trim();
  const previewCls = a.tone === "promo" ? "bg-primary text-primary-fg" : a.tone === "warning" ? "bg-warn-soft text-warn" : "bg-primary-soft text-primary";
  return (
    <Card title="Duyuru çubuğu" actions={<Badge tone={status.tone}>{status.label}</Badge>}>
      <p className="mb-3 text-xs text-muted-foreground">Sitenin her sayfasında üstte görünür. Ziyaretçinin dilinde metin yoksa İngilizcesi, o da yoksa hiç gösterilmez.</p>
      <div className="flex flex-col gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" role="switch" checked={a.enabled} disabled={!canEdit} onChange={(e) => onChange({ enabled: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" />
          Duyuruyu göster
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Görünüm" htmlFor="ann-tone">
            <Select id="ann-tone" value={a.tone} disabled={!canEdit} onChange={(e) => onChange({ tone: e.target.value as SiteAnnouncement["tone"] })}>
              {TONES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bağlantı" htmlFor="ann-link">
            <Select id="ann-link" value={linkChoice} disabled={!canEdit} onChange={(e) => onChange({ link: e.target.value === "" ? null : e.target.value === "post" ? "/blog/" : e.target.value })}>
              <option value="">Bağlantı yok</option>
              {LINKS.map(([p, l]) => (
                <option key={p} value={p}>
                  {l} ({p})
                </option>
              ))}
              <option value="post">Blog yazısı…</option>
            </Select>
          </Field>
        </div>
        {linkChoice === "post" && (
          <Field label="Yazının adresi" htmlFor="ann-post" hint={linkOk ? undefined : "Biçim: /blog/yazinin-adresi (küçük harf, rakam, tire)."}>
            <Input id="ann-post" value={a.link ?? ""} maxLength={100} disabled={!canEdit} onChange={(e) => onChange({ link: e.target.value })} aria-invalid={!linkOk} />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Başlangıç (boşsa hemen)" htmlFor="ann-start">
            <Input id="ann-start" type="datetime-local" value={toLocal(a.startsAt)} disabled={!canEdit} onChange={(e) => onChange({ startsAt: toIso(e.target.value) })} />
          </Field>
          <Field label="Bitiş (boşsa süresiz)" htmlFor="ann-end">
            <Input id="ann-end" type="datetime-local" value={toLocal(a.endsAt)} disabled={!canEdit} onChange={(e) => onChange({ endsAt: toIso(e.target.value) })} />
          </Field>
        </div>
        {(["tr", "en"] as const).map((l) => (
          <Field key={l} label={`Metin · ${LOCALE_LABELS[l]}`} htmlFor={`ann-${l}`}>
            <Input id={`ann-${l}`} value={a.text[l] ?? ""} maxLength={140} disabled={!canEdit} onChange={(e) => onChange({ text: { ...a.text, [l]: e.target.value } })} />
          </Field>
        ))}
        <details className="rounded-lg border border-line px-3 py-2">
          <summary className="cursor-pointer text-sm">Diğer diller ({LOCALES.filter((l) => l !== "tr" && l !== "en" && a.text[l]?.trim()).length}/9)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {LOCALES.filter((l) => l !== "tr" && l !== "en").map((l) => (
              <Field key={l} label={LOCALE_LABELS[l]} htmlFor={`ann-${l}`}>
                <Input id={`ann-${l}`} value={a.text[l] ?? ""} maxLength={140} disabled={!canEdit} onChange={(e) => onChange({ text: { ...a.text, [l]: e.target.value } })} />
              </Field>
            ))}
          </div>
        </details>
        {a.enabled && !hasText && <p className="text-xs text-danger">Açık duyurunun en az bir dilde metni olmalı.</p>}
        {preview && <div className={`rounded-lg px-3 py-2 text-center text-sm font-medium ${previewCls}`}>{preview}</div>}
      </div>
    </Card>
  );
}

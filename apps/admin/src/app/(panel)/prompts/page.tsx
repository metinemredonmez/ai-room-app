"use client";

import { History, RotateCcw, Send, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Spinner, Textarea } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { PromptTemplate, PromptsState } from "@/lib/types";

// İstem şablonları (API.md §7.26): görsel modeline giden istem, araç başına. Yeni sürüm yayınlanır, önizlenir,
// gerekirse eski sürüme ya da varsayılana dönülür. Kullanıcının yazdığı metni kod temizler ve tırnak içinde yerleştirir;
// şablon yalnız yerini belirler. Yalnız yönetici rolleri görür ve değiştirir.

const LABELS: Record<string, string> = {
  keep: "Ortak cümle: odayı koru",
  redesign: "Anında Yenile",
  furnish: "Boş Odayı Döşe",
  declutter: "Nesne Sil",
  declutter_all: "Nesne Sil — hepsini",
  replace: "Değiştir",
  paint: "Duvar Boyası",
  flooring: "Yeni Zemin",
  exterior: "Dış Cephe",
  garden: "Bahçe & Teras",
  reference: "Referans Stil",
  custom: "Kendi Tarifin",
};
const PLACEHOLDER_TR: Record<string, string> = {
  room: "oda tipi (katalogdaki istem)",
  style: "stilin istemi",
  keep: "ortak “odayı koru” cümlesi",
  extra: "kullanıcının ek isteği (cümle, boş olabilir)",
  what: "silinecek şey (tırnaklı)",
  thing: "değişecek nesne (tırnaklı)",
  replacement: "yerine gelecek (tırnaklı)",
  walls: "hangi duvar: hepsi ya da seçilen",
  color: "renk adı ve kodu",
  floor: "zeminin istemi",
  reference: "referans fotoğraftan okunan stil",
  request: "kullanıcının isteği (tırnaklı)",
};

function issueText(code: string): string {
  const [c, name] = code.replace(/^keep:/, "").split(":");
  if (c === "unknown_placeholder") return `{${name}} bu şablonda kullanılamaz`;
  if (c === "missing_placeholder") return `{${name}} şablonda bulunmalı`;
  if (c === "length") return "Uzunluk 10–1500 karakter olmalı (ortak cümlede en çok 600)";
  if (c === "stray_brace") return "Süslü parantez yalnız {alan} biçiminde kullanılabilir";
  if (c === "control_chars") return "Görünmez kontrol karakteri var";
  return "Geçersiz şablon";
}

export default function PromptsPage() {
  const state = useApi<PromptsState>("/prompts");
  const [key, setKey] = useState("redesign");
  const s = state.data;
  return (
    <>
      <PageHeader
        title="İstem şablonları"
        description="Görsel modeline giden istem, araç başına. Yeni sürüm yayınla, önizle, gerekirse eski sürüme ya da varsayılana dön. Kullanıcının yazdığını kod temizleyip tırnak içinde yerleştirir; şablon yalnız yerini belirler."
      />
      {state.error && !s ? (
        <ErrorState message={state.error.message} onRetry={state.reload} />
      ) : !s ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <nav aria-label="Şablonlar" className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-2 max-lg:flex-row max-lg:flex-wrap">
            {s.templates.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-current={t.key === key}
                onClick={() => setKey(t.key)}
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${t.key === key ? "bg-primary text-primary-fg" : "text-fg hover:bg-surface-2"}`}
              >
                <span className="truncate">{LABELS[t.key] ?? t.key}</span>
                {t.activeVersionId && <span className={`h-2 w-2 shrink-0 rounded-full ${t.key === key ? "bg-primary-fg" : "bg-primary"}`} aria-label="panelden değiştirildi" />}
              </button>
            ))}
          </nav>
          {(() => {
            const t = s.templates.find((x) => x.key === key) ?? s.templates[0];
            return <Editor key={`${t.key}:${t.activeVersionId ?? "default"}`} t={t} onSaved={(next) => state.setData(() => next)} onReload={state.reload} />;
          })()}
        </div>
      )}
    </>
  );
}

function Editor({ t, onSaved, onReload }: { t: PromptTemplate; onSaved: (s: PromptsState) => void; onReload: () => void }) {
  const { toast, confirm } = useFeedback();
  const [text, setText] = useState(t.text);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ prompt: string | null; errors: string[] } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const dirty = text !== t.text;
  const active = t.versions.find((v) => v.id === t.activeVersionId);
  const used = useMemo(() => new Set([...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1])), [text]);

  // Debounced preview: the AI service checks the draft and renders it with sample values (no image, no cost).
  useEffect(() => {
    const id = setTimeout(() => {
      api<{ prompt: string | null; errors: string[] }>("/prompts/preview", { method: "POST", body: { key: t.key, text } })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 450);
    return () => clearTimeout(id);
  }, [t.key, text]);

  function insert(name: string) {
    const el = area.current;
    const token = `{${name}}`;
    if (!el) return setText((v) => v + token);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    setText(text.slice(0, start) + token + text.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function run(path: string, body: unknown, ok: string) {
    setBusy(true);
    try {
      const next = await api<PromptsState>(`/prompts/${t.key}/${path}`, { method: "POST", body });
      setNote("");
      onSaved(next);
      toast("success", ok);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (await confirm({ title: "Şablon bu arada değişti", description: "Başka biri yayınlamış. Güncel hâli yüklensin mi? Buradaki taslak kaybolur.", confirmLabel: "Yükle" })) onReload();
      } else toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function activate(versionId: string | null, label: string) {
    const ok = await confirm({
      title: versionId ? "Bu sürüme dönülsün mü?" : "Varsayılana dönülsün mü?",
      description: `${label} yayına alınacak; yeni tasarımlar hemen bu istemi kullanır. Gerekçe: “${note.trim()}”.`,
      confirmLabel: "Yayına al",
    });
    if (ok) await run("activate", { versionId, reason: note.trim(), expected: t.activeVersionId }, "Yayındaki sürüm değişti.");
  }

  const errors = preview?.errors ?? [];
  const noteOk = note.trim().length >= 3;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card
        title={
          <span className="flex flex-wrap items-center gap-2">
            {LABELS[t.key] ?? t.key}
            <span className="font-mono text-[11px] font-normal text-muted-foreground">{t.key}</span>
            {t.activeVersionId ? <Badge tone="primary">Panelden sürüm yayında</Badge> : <Badge tone="neutral">Varsayılan</Badge>}
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {active
              ? `Yayında: ${fmtDateTime(active.createdAt)}${active.createdBy ? ` · ${active.createdBy}` : ""} · “${active.note}”.`
              : "Yayında: koddaki varsayılan istem."}{" "}
            {t.key === "keep" ? "Bu cümle diğer şablonlarda {keep} yazan yere girer." : "Değişiklik yalnız bu aracın yeni tasarımlarını etkiler; eski sonuçlar değişmez."}
          </p>

          {t.placeholders.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Kullanılabilir alanlar">
              {t.placeholders.map((p) => (
                <button
                  key={p}
                  type="button"
                  title={PLACEHOLDER_TR[p] ?? p}
                  onClick={() => insert(p)}
                  className={`rounded-md border px-2 py-1 font-mono text-xs transition hover:bg-surface-2 ${used.has(p) ? "border-primary text-primary" : "border-line text-fg"}`}
                >
                  {`{${p}}`}
                  {t.required.includes(p) && <span className="ml-0.5 text-danger">*</span>}
                </button>
              ))}
            </div>
          )}
          {t.placeholders.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Alana tıklayınca imleç yerine eklenir. <span className="text-danger">*</span> zorunlu. Üzerine gelince ne tuttuğu görünür.
            </p>
          )}

          <Field label="İstem (İngilizce)" htmlFor="prompt-text" hint={`${text.length}/1500`}>
            <Textarea id="prompt-text" ref={area} rows={6} maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-[13px] leading-relaxed" />
          </Field>

          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <p className="text-xs font-medium text-muted-foreground">Önizleme (örnek değerlerle)</p>
            {errors.length > 0 ? (
              <ul className="mt-1 list-disc pl-5 text-xs text-danger">
                {errors.map((e) => (
                  <li key={e}>{issueText(e)}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 whitespace-pre-wrap text-[13px] text-fg">{preview?.prompt ?? "…"}</p>
            )}
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
            <div className="flex-1">
              <Field label="Not / gerekçe" htmlFor="prompt-note" hint="Sürüm geçmişine ve denetim kaydına yazılır (en az 3 karakter).">
                <Input id="prompt-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Örn. pencere ve kapıyı daha sıkı koru" />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              {text !== t.default && (
                <Button onClick={() => setText(t.default)} title="Varsayılan metni düzenleyiciye yükler; yayınlamaz">
                  <RotateCcw className="h-4 w-4" aria-hidden /> Varsayılanı yükle
                </Button>
              )}
              <Button variant="primary" loading={busy} disabled={!dirty || errors.length > 0 || !noteOk} onClick={() => void run("publish", { text, note: note.trim(), expected: t.activeVersionId }, "Yeni sürüm yayında.")}>
                <Send className="h-4 w-4" aria-hidden /> Yayınla
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card
        title={
          <span className="flex items-center gap-2">
            <History className="h-4 w-4" aria-hidden /> Sürüm geçmişi
          </span>
        }
        actions={
          t.activeVersionId && (
            <Button size="sm" disabled={!noteOk || busy} title={noteOk ? undefined : "Önce not / gerekçe yaz"} onClick={() => void activate(null, "Koddaki varsayılan istem")}>
              <Undo2 className="h-3.5 w-3.5" aria-hidden /> Varsayılana dön
            </Button>
          )
        }
      >
        {t.versions.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Henüz panelden sürüm yayınlanmadı; varsayılan istem kullanılıyor.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {t.versions.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-fg">{fmtDateTime(v.createdAt)}</span>
                  {v.createdBy && <span className="text-muted-foreground">{v.createdBy}</span>}
                  <span className="text-muted-foreground">· “{v.note}”</span>
                  {v.id === t.activeVersionId && <Badge tone="good">Yayında</Badge>}
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setText(v.text)}>
                      Düzenleyiciye yükle
                    </Button>
                    {v.id !== t.activeVersionId && (
                      <Button size="sm" disabled={!noteOk || busy} title={noteOk ? undefined : "Önce not / gerekçe yaz"} onClick={() => void activate(v.id, "Bu sürüm")}>
                        Bu sürüme dön
                      </Button>
                    )}
                  </div>
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap font-mono text-[12px] text-muted-foreground">{v.text}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

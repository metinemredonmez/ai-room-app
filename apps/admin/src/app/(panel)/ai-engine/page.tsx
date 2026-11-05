"use client";

import { ChevronDown, ChevronUp, Plus, RotateCcw, Save, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Select, Spinner } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { EngineChoice, EngineProvider, EngineState } from "@/lib/types";

// Model ve sağlayıcı (API.md §7.27): görsel üretiminde hangi sağlayıcının hangi sırayla, hangi modelle deneneceği.
// Sunucu neyin mümkün olduğunu söyler (anahtarı olan sağlayıcı, izinli model); panel bunların içinden seçer.
// Birincil sağlayıcı hata verirse ya da devresi açıksa sıradaki denenir. Kayıt gerekçe ister ve denetlenir.

const NAMES: Record<string, string> = { gemini: "Google Gemini", replicate: "Replicate", falai: "fal.ai", mock: "Demo (ücretsiz, sahte)" };
const BREAKER: Record<string, { tone: "good" | "danger" | "warn"; text: string }> = {
  closed: { tone: "good", text: "Çalışıyor" },
  open: { tone: "danger", text: "Devre açık" },
  half_open: { tone: "warn", text: "Deneniyor" },
};
const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;

type Row = { name: string; model: string };

function toRows(choice: EngineChoice | null, s: EngineState): Row[] {
  const by = new Map(s.catalog.providers.map((p) => [p.name, p]));
  const chain = choice?.chain ?? s.catalog.default_chain;
  return chain.map((name) => ({ name, model: choice?.models[name] ?? by.get(name)?.default_model ?? "" }));
}

/** Models equal to the server default are not stored, so a later server default change still applies. */
function toChoice(rows: Row[], providers: EngineProvider[]): EngineChoice {
  const by = new Map(providers.map((p) => [p.name, p]));
  return {
    chain: rows.map((r) => r.name),
    models: Object.fromEntries(rows.filter((r) => r.model && r.model !== by.get(r.name)?.default_model).map((r) => [r.name, r.model])),
  };
}

export default function EnginePage() {
  const state = useApi<EngineState>("/ai-engine");
  const s = state.data;
  return (
    <>
      <PageHeader
        title="Model ve sağlayıcı"
        description="Görsel üretiminde hangi sağlayıcının hangi sırayla ve hangi modelle deneneceği. Birincil hata verirse ya da devresi açıksa sıradaki denenir. Değişiklik birkaç saniye içinde yeni tasarımlara geçer."
      />
      {state.error && !s ? (
        <ErrorState message={state.error.message} onRetry={state.reload} />
      ) : !s ? (
        <Spinner />
      ) : (
        <Editor key={s.version ?? "default"} state={s} onSaved={(n) => state.setData(() => n)} onReload={state.reload} />
      )}
    </>
  );
}

function Editor({ state, onSaved, onReload }: { state: EngineState; onSaved: (s: EngineState) => void; onReload: () => void }) {
  const { toast, confirm } = useFeedback();
  const providers = state.catalog.providers;
  const by = useMemo(() => new Map(providers.map((p) => [p.name, p])), [providers]);
  const breaker = useMemo(() => new Map(state.catalog.breakers.map((b) => [b.name, b])), [state.catalog.breakers]);
  const [rows, setRows] = useState<Row[]>(() => toRows(state.choice, state));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const next = toChoice(rows, providers);
  const saved = state.choice ?? toChoice(toRows(null, state), providers);
  const dirty = JSON.stringify(next) !== JSON.stringify(saved);
  const addable = providers.filter((p) => p.usable && !rows.some((r) => r.name === p.name));
  const unusable = providers.filter((p) => !p.usable);
  const primary = rows[0] ? by.get(rows[0].name)?.models.find((m) => m.id === rows[0].model) : undefined;

  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const n = [...r];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  async function save(engine: EngineChoice | null) {
    if (engine && rows[0]?.name !== (state.choice?.chain ?? state.catalog.default_chain)[0]) {
      const ok = await confirm({
        title: "Birincil sağlayıcı değişiyor",
        description: `Yeni tasarımlar önce ${NAMES[rows[0].name] ?? rows[0].name} ile üretilecek${primary ? ` (görsel başı yaklaşık ${usd(primary.cost_usd)})` : ""}. Sonuç kalitesi ve maliyet değişebilir.`,
        confirmLabel: "Kaydet",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const out = await api<EngineState>("/ai-engine", { method: "PATCH", body: { engine, reason: reason.trim(), version: state.version } });
      setReason("");
      onSaved(out);
      toast("success", engine ? "Zincir kaydedildi; yeni tasarımlar birkaç saniye içinde bu sırayı kullanır." : "Sunucu varsayılanına dönüldü.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (await confirm({ title: "Ayar bu arada değişti", description: "Başka biri kaydetmiş. Güncel hâli yüklensin mi?", confirmLabel: "Yükle" })) onReload();
      } else toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  const reasonOk = reason.trim().length >= 3;
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
        {state.choice
          ? `Panel seçimi yayında${state.updatedAt ? ` · ${fmtDateTime(state.updatedAt)}${state.updatedBy ? ` · ${state.updatedBy}` : ""}` : ""}.`
          : `Sunucu varsayılanı kullanılıyor: ${state.catalog.default_chain.map((n) => NAMES[n] ?? n).join(" → ")}.`}{" "}
        Maliyet ve sağlayıcı dağılımı için{" "}
        <Link href="/ai-costs" className="text-primary hover:underline">
          AI maliyeti
        </Link>
        .
      </p>
      {state.ignored.length > 0 && (
        <div className="flex gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <p>Kayıtlı seçim sunucuda uygulanamıyor, bu yüzden sunucu varsayılanı kullanılıyor: {state.ignored.join("; ")}. Zinciri düzeltip kaydet ya da varsayılana dön.</p>
        </div>
      )}

      <Card
        title="Görsel üretim zinciri"
        actions={
          addable.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {addable.map((p) => (
                <Button key={p.name} size="sm" disabled={rows.length >= 4} onClick={() => setRows((r) => [...r, { name: p.name, model: p.default_model }])}>
                  <Plus className="h-3.5 w-3.5" aria-hidden /> {NAMES[p.name] ?? p.name}
                </Button>
              ))}
            </div>
          )
        }
      >
        <div className="flex flex-col gap-3">
          {rows.length === 0 && <p className="py-3 text-center text-sm text-danger">Zincirde en az bir sağlayıcı olmalı.</p>}
          {rows.map((r, i) => {
            const p = by.get(r.name);
            const b = breaker.get(r.name);
            const model = p?.models.find((m) => m.id === r.model);
            return (
              <div key={r.name} className="flex gap-2 rounded-lg border border-line p-3">
                <div className="flex flex-col">
                  <button type="button" aria-label={`${r.name}: yukarı taşı`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-0.5 text-muted-foreground hover:bg-surface-2 disabled:opacity-30">
                    <ChevronUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button type="button" aria-label={`${r.name}: aşağı taşı`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="rounded p-0.5 text-muted-foreground hover:bg-surface-2 disabled:opacity-30">
                    <ChevronDown className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <div className="grid flex-1 items-end gap-3 md:grid-cols-[12rem_1fr_auto]">
                  <div>
                    <p className="text-xs text-muted-foreground">{i === 0 ? "Birincil" : `Yedek ${i}`}</p>
                    <p className="font-medium text-fg">{NAMES[r.name] ?? r.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {b ? <Badge tone={BREAKER[b.state].tone}>{BREAKER[b.state].text}</Badge> : <Badge tone="neutral">Henüz kullanılmadı</Badge>}
                      {!p?.usable && <Badge tone="danger">Kullanılamaz</Badge>}
                    </div>
                  </div>
                  <Field label="Model" htmlFor={`m-${r.name}`} hint={model ? `Görsel başı yaklaşık ${usd(model.cost_usd)}${r.model === p?.default_model ? " · sunucunun modeli" : ""}` : undefined}>
                    <Select id={`m-${r.name}`} value={r.model} onChange={(e) => setRows((rs) => rs.map((x) => (x.name === r.name ? { ...x, model: e.target.value } : x)))}>
                      {(p?.models ?? []).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button size="sm" variant="ghost" className="text-danger" disabled={rows.length <= 1} onClick={() => setRows((rs) => rs.filter((x) => x.name !== r.name))}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden /> Çıkar
                  </Button>
                </div>
              </div>
            );
          })}
          {unusable.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Seçilemeyenler: {unusable.map((p) => `${NAMES[p.name] ?? p.name} (${p.configured ? "burada kullanılamaz" : "sunucuda anahtarı yok"})`).join(", ")}. Yeni sağlayıcı anahtarı
              sunucuda <span className="font-mono">set-secret.sh</span> ile eklenir; yeni model, lisansı ve fiyatı kontrol edildikten sonra{" "}
              <span className="font-mono">IMAGE_MODEL_ALLOWLIST</span> ile listeye girer.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1">
            <Field label="Değişiklik gerekçesi" htmlFor="engine-reason" hint="Denetim kaydına yazılır (en az 3 karakter).">
              <Input id="engine-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Örn. maliyet için fal.ai birincil, Gemini yedek" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            {state.choice && (
              <Button disabled={!reasonOk || busy} onClick={() => void save(null)}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Sunucu varsayılanına dön
              </Button>
            )}
            <Button variant="primary" loading={busy} disabled={!reasonOk || rows.length === 0 || (!dirty && state.choice !== null)} onClick={() => void save(next)}>
              <Save className="h-4 w-4" aria-hidden /> Kaydet
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {dirty ? "Kaydedilmemiş değişiklik var." : state.choice ? "Değişiklik yok." : "Kaydedersen bu sıra panelde sabitlenir; sunucu ayarı değişse de bu sıra kullanılır."}
        </p>
      </Card>
    </div>
  );
}

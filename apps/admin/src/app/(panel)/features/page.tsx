"use client";

import { Save } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Spinner } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { AdminMe, FeaturesState } from "@/lib/types";

// Özellik bayrakları (API.md §7.28): bir özelliği yayından çekmeden kapatmak. Kapalı özellik sunucuda reddedilir
// (eski uygulama hâlâ gösterse bile) ve web/uygulama onu gizler. Hepsi açık başlar. Kayıt gerekçe ister ve denetlenir.

export default function FeaturesPage() {
  const state = useApi<FeaturesState>("/features");
  const me = useApi<AdminMe>("/me");
  const s = state.data;
  return (
    <>
      <PageHeader
        title="Özellikler"
        description="Bir özelliği kod değişikliği olmadan kapat ya da aç. Kapalı özellik sunucuda reddedilir ve web ile uygulamada gizlenir. Değişiklik en geç 30 saniyede her yere yansır."
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

function Editor({ state, canEdit, onSaved, onReload }: { state: FeaturesState; canEdit: boolean; onSaved: (s: FeaturesState) => void; onReload: () => void }) {
  const { toast, confirm } = useFeedback();
  const [flags, setFlags] = useState<Record<string, boolean>>(() => Object.fromEntries(state.features.map((f) => [f.key, f.enabled])));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const changed = state.features.filter((f) => flags[f.key] !== f.enabled);

  async function save() {
    const closing = changed.filter((f) => !flags[f.key]);
    if (closing.length) {
      const ok = await confirm({
        title: "Özellik kapanıyor",
        description: `${closing.map((f) => `“${f.label}”`).join(", ")} kapanacak: sunucu bu istekleri reddeder, web ve uygulama gizler. İstediğin zaman yeniden açabilirsin.`,
        confirmLabel: "Kaydet",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const out = await api<FeaturesState>("/features", { method: "PATCH", body: { features: flags, reason: reason.trim(), version: state.version } });
      setReason("");
      onSaved(out);
      toast("success", "Kaydedildi; en geç 30 saniyede her yere yansır.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (await confirm({ title: "Ayar bu arada değişti", description: "Başka biri kaydetmiş. Güncel hâli yüklensin mi?", confirmLabel: "Yükle" })) onReload();
      } else toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted-foreground">Görüntüleme yetkin var; değiştirmek için yönetici rolü gerekir.</p>}
      <Card>
        <ul className="flex flex-col divide-y divide-line">
          {state.features.map((f) => {
            const on = flags[f.key];
            return (
              <li key={f.key} className="flex items-start gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{f.label}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{f.key}</span>
                    {on !== f.enabled && <Badge tone="warn">Kaydedilmedi</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{f.description}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Etkilenen: {f.where.join(", ")}</p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
                  <span className={on ? "text-fg" : "text-danger"}>{on ? "Açık" : "Kapalı"}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`${f.label}: ${on ? "açık" : "kapalı"}`}
                    disabled={!canEdit}
                    checked={on}
                    onChange={(e) => setFlags((x) => ({ ...x, [f.key]: e.target.checked }))}
                    className="h-5 w-5 accent-[var(--primary)]"
                  />
                </label>
              </li>
            );
          })}
        </ul>
      </Card>
      {canEdit && (
        <Card>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <Field label="Değişiklik gerekçesi" htmlFor="features-reason" hint="Denetim kaydına yazılır (en az 3 karakter).">
                <Input id="features-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Örn. sohbet sağlayıcısı arızalı, geçici olarak kapatıldı" />
              </Field>
            </div>
            <Button variant="primary" loading={busy} disabled={changed.length === 0 || reason.trim().length < 3} onClick={() => void save()}>
              <Save className="h-4 w-4" aria-hidden /> Kaydet
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {changed.length ? `${changed.length} değişiklik kaydedilmedi.` : "Değişiklik yok."}
            {state.updatedAt && ` Son kayıt: ${fmtDateTime(state.updatedAt)}${state.updatedBy ? ` · ${state.updatedBy}` : ""}.`}
          </p>
        </Card>
      )}
    </div>
  );
}

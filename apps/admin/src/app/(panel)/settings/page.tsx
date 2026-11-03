"use client";

import { RotateCw, Save } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import type { BrakeMode, Settings, SettingsResponse } from "@/lib/types";

const BRAKE_LABELS: Record<BrakeMode, string> = {
  off: "Kapalı — bütçe aşılsa da devam et",
  free_single_variant: "Ücretsiz kullanıcıya tek varyant",
  free_paused: "Ücretsiz üretimi durdur",
};

function Toggle({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm text-fg">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
      {label}
    </label>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <p className="mb-4 text-xs text-muted-foreground">{description}</p>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </Card>
  );
}

/** Changed top-level keys only; nested objects are sent whole (the API validates the full object). */
function diff(base: Settings, next: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const key of Object.keys(next) as (keyof Settings)[]) {
    if (JSON.stringify(base[key]) !== JSON.stringify(next[key])) (out as Record<string, unknown>)[key] = next[key];
  }
  return out;
}

function SettingsForm({ initial, defaults, onSaved }: { initial: Settings; defaults: Settings; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [draft, setDraft] = useState<Settings>(initial);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const changes = useMemo(() => diff(initial, draft), [initial, draft]);
  const changedCount = Object.keys(changes).length;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const hint = (key: keyof Settings) => `Varsayılan: ${typeof defaults[key] === "object" ? "—" : String(defaults[key])}`;

  async function save() {
    if (!changedCount) return;
    if (reason.trim().length < 3) {
      toast("error", "Değişiklik gerekçesi en az 3 karakter olmalı.");
      return;
    }
    setSaving(true);
    try {
      await api<{ values: Settings }>("/settings", { method: "PATCH", body: { values: changes, reason: reason.trim() } });
      toast("success", `${changedCount} ayar kaydedildi.`);
      setReason("");
      onSaved();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Kota ve varyantlar" description="Günlük üretim hakları ve tek istekte üretilebilecek en fazla varyant sayısı.">
        <Field label="Ücretsiz günlük hak" hint={hint("freeDailyGenerations")} htmlFor="free">
          <Input id="free" type="number" min={0} max={1000} value={draft.freeDailyGenerations} onChange={(e) => set("freeDailyGenerations", num(e.target.value))} />
        </Field>
        <Field label="PRO günlük hak (adil kullanım)" hint={hint("proDailyGenerations")} htmlFor="pro">
          <Input id="pro" type="number" min={1} max={1000} value={draft.proDailyGenerations} onChange={(e) => set("proDailyGenerations", num(e.target.value))} />
        </Field>
        <Field label="En fazla varyant (ücretsiz)" hint={hint("maxVariantsFree")} htmlFor="vfree">
          <Select id="vfree" value={draft.maxVariantsFree} onChange={(e) => set("maxVariantsFree", Number(e.target.value) as Settings["maxVariantsFree"])}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        <Field label="En fazla varyant (PRO)" hint={hint("maxVariantsPro")} htmlFor="vpro">
          <Select id="vpro" value={draft.maxVariantsPro} onChange={(e) => set("maxVariantsPro", Number(e.target.value) as Settings["maxVariantsPro"])}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
      </Section>

      <Section title="AI bütçesi" description="Günlük AI harcaması bütçeyi aşınca yalnız ücretsiz kullanıcılar etkilenir; PRO kullanıcılar devam eder.">
        <Field label="Günlük bütçe (USD)" hint="0 = sınırsız" htmlFor="budget">
          <Input id="budget" type="number" min={0} step="0.01" value={draft.dailyBudgetUsd} onChange={(e) => set("dailyBudgetUsd", num(e.target.value))} />
        </Field>
        <Field label="Bütçe aşılınca" htmlFor="brake">
          <Select id="brake" value={draft.budgetBrakeMode} onChange={(e) => set("budgetBrakeMode", e.target.value as BrakeMode)}>
            {(Object.keys(BRAKE_LABELS) as BrakeMode[]).map((m) => <option key={m} value={m}>{BRAKE_LABELS[m]}</option>)}
          </Select>
        </Field>
      </Section>

      <Section title="Bakım modu" description="Açıkken yeni üretim 503 ile reddedilir; mesaj uygulamalarda gösterilir.">
        <div className="md:col-span-2">
          <Toggle id="maint" checked={draft.maintenance.enabled} onChange={(v) => set("maintenance", { ...draft.maintenance, enabled: v })} label="Bakım modu açık" />
        </div>
        <Field label="Mesaj (TR)" htmlFor="mtr">
          <Textarea id="mtr" rows={2} maxLength={300} value={draft.maintenance.messageTr} onChange={(e) => set("maintenance", { ...draft.maintenance, messageTr: e.target.value })} />
        </Field>
        <Field label="Mesaj (EN)" htmlFor="men">
          <Textarea id="men" rows={2} maxLength={300} value={draft.maintenance.messageEn} onChange={(e) => set("maintenance", { ...draft.maintenance, messageEn: e.target.value })} />
        </Field>
      </Section>

      <Section title="Duyuru" description="Katalog yanıtıyla tüm istemcilere gider (ör. yeni stil duyurusu).">
        <div className="md:col-span-2">
          <Toggle id="ann" checked={draft.announcement.enabled} onChange={(v) => set("announcement", { ...draft.announcement, enabled: v })} label="Duyuru yayında" />
        </div>
        <Field label="Metin (TR)" htmlFor="atr">
          <Textarea id="atr" rows={2} maxLength={300} value={draft.announcement.textTr} onChange={(e) => set("announcement", { ...draft.announcement, textTr: e.target.value })} />
        </Field>
        <Field label="Metin (EN)" htmlFor="aen">
          <Textarea id="aen" rows={2} maxLength={300} value={draft.announcement.textEn} onChange={(e) => set("announcement", { ...draft.announcement, textEn: e.target.value })} />
        </Field>
      </Section>

      <Section title="KVKK" description="Açıkken üretimden önce kullanıcının güncel 'yapay zekâ ile işleme' onayı aranır (403 consent_required).">
        <div className="md:col-span-2">
          <Toggle id="consent" checked={draft.requireAiConsent} onChange={(v) => set("requireAiConsent", v)} label="AI işleme onayı zorunlu" />
        </div>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-1 rounded-2xl border border-line bg-surface p-4 shadow-lg">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <Field label="Değişiklik gerekçesi (zorunlu, denetim kaydına yazılır)" htmlFor="reason">
              <Input id="reason" value={reason} maxLength={200} placeholder="ör. Kampanya haftası için ücretsiz hakkı artırıyoruz" onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            {changedCount > 0 ? <Badge tone="warn">{changedCount} değişiklik</Badge> : <Badge>Değişiklik yok</Badge>}
            <Button variant="ghost" onClick={() => setDraft(initial)} disabled={!changedCount || saving}>
              Geri al
            </Button>
            <Button variant="primary" onClick={save} loading={saving} disabled={!changedCount}>
              <Save className="h-4 w-4" aria-hidden /> Kaydet
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const res = useApi<SettingsResponse>("/settings");
  return (
    <>
      <PageHeader
        title="Ayarlar"
        description="Çalışma zamanı ayarları — deploy gerekmeden değişir, tüm sunuculara 15 sn içinde yayılır"
        actions={
          <Button onClick={res.reload} loading={res.loading && Boolean(res.data)}>
            <RotateCw className="h-4 w-4" aria-hidden /> Yenile
          </Button>
        }
      />
      {res.error && !res.data ? (
        <ErrorState message={res.error.message} onRetry={res.reload} />
      ) : !res.data ? (
        <Spinner />
      ) : (
        // Re-mount the form after every reload so the draft starts from the saved values.
        <SettingsForm key={JSON.stringify(res.data.values)} initial={res.data.values} defaults={res.data.defaults} onSaved={res.reload} />
      )}
    </>
  );
}

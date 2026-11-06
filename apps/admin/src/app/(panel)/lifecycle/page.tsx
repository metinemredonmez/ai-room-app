"use client";

import { Play, Save, Send } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { LIFECYCLE_RULES, type AdminMe, type LifecycleRule, type LifecycleSettings, type LifecycleState } from "@/lib/types";

// Yaşam döngüsü e-postaları (API.md §7.48): kayıttan sonra ilk tasarımı yapmayana, tek tasarımda kalana ve uzun süre
// gelmeyene giden e-postalar. Hepsi ticari ileti sayılır: yalnız pazarlama izni olan kişiye, abonelikten çıkma
// bağlantısıyla, sessiz saatler dışında ve Toplu Gönderim'le ortak günlük e-posta sınırı içinde gider. Her saat
// başı 20'de kısa bir tur çalışır. SUPPORT görür; ADMIN düzenler, kendine deneme gönderir, turu elle başlatır.

const RULE: Record<LifecycleRule, { title: string; what: (s: LifecycleSettings) => string }> = {
  onboarding: { title: "İlk tasarım hatırlatması", what: (s) => `Kaydolup ${s.onboarding.afterDays} gün içinde hiç tasarım yapmayan kişiye bir kez.` },
  firstResult: { title: "İkinci adım", what: (s) => `Kaydından ${s.firstResult.afterDays} gün sonra yalnız bir tasarımı olan kişiye bir kez.` },
  inactive: { title: "Geri çağırma", what: (s) => `${s.inactive.inactiveDays} gündür gelmeyen (en az bir tasarımı olan) kişiye; en çok ${s.inactive.cooldownDays} günde bir.` },
};
const num = (v: string) => (v === "" ? 0 : Math.trunc(Number(v)));

export default function LifecyclePage() {
  const state = useApi<LifecycleState>("/lifecycle");
  const me = useApi<AdminMe>("/me");
  const s = state.data;
  const canEdit = me.data ? ["ADMIN", "SUPER_ADMIN"].includes(me.data.role) : false;
  return (
    <>
      <PageHeader
        title="Yaşam döngüsü e-postaları"
        description="Kullanıcıyı doğru anda yakalayan otomatik e-postalar. Yalnız pazarlama izni olan kişiye, abonelikten çıkma bağlantısıyla gider; sessiz saatlere ve günlük e-posta sınırına uyar. Her adım kişi başına bir kez (geri çağırma bekleme süresiyle), iki e-posta arasında en az 3 gün olur."
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

function Editor({ state, canEdit, onSaved, onReload }: { state: LifecycleState; canEdit: boolean; onSaved: (s: LifecycleState) => void; onReload: () => void }) {
  const { toast, confirm } = useFeedback();
  const [s, setS] = useState<LifecycleSettings>(state.settings);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const links = useApi<{ items: { path: string; label: string }[] }>("/broadcasts/links");
  const dirty = JSON.stringify(s) !== JSON.stringify(state.settings);
  const e = state.email;

  const setRule = <R extends LifecycleRule>(r: R, patch: Partial<LifecycleSettings[R]>) => setS((x) => ({ ...x, [r]: { ...x[r], ...patch } }));

  async function save() {
    setBusy("save");
    try {
      const out = await api<LifecycleState>("/lifecycle", { method: "PATCH", body: { settings: s, reason: reason.trim(), version: state.version } });
      setReason("");
      onSaved(out);
      toast("success", out.changes?.length ? "Kaydedildi." : "Değişiklik yoktu.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        if (await confirm({ title: "Ayar bu arada değişti", description: "Güncel hâli yüklensin mi? Buradaki kaydedilmemiş değişiklikler gider.", confirmLabel: "Yükle" })) onReload();
      } else toast("error", err instanceof ApiError ? err.message : "Kaydedilemedi.");
    } finally {
      setBusy(null);
    }
  }

  async function test(rule: LifecycleRule, locale: "tr" | "en") {
    setBusy(`test-${rule}-${locale}`);
    try {
      const out = await api<{ sentTo: string }>("/lifecycle/test", { method: "POST", body: { rule, locale, settings: s } });
      toast("success", `Deneme e-postası ${out.sentTo} adresine gönderildi.`);
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Gönderilemedi.");
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    const why = window.prompt("Tur şimdi çalıştırılsın mı? Neden? (denetim kaydına yazılır)");
    if (!why || why.trim().length < 3) return;
    setBusy("run");
    try {
      await api("/jobs/lifecycle/run", { method: "POST", body: { reason: why.trim() } });
      toast("success", "Tur kuyruğa alındı; sonucu Zamanlı işler ekranında görünür.");
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "Başlatılamadı.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Gönderim"
        actions={
          canEdit ? (
            <Button size="sm" variant="ghost" loading={busy === "run"} disabled={busy !== null || dirty} onClick={() => void runNow()}>
              <Play className="h-3.5 w-3.5" aria-hidden /> Turu şimdi çalıştır
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span>
            Bugün giden e-posta: <b className="tabular-nums">{fmtInt(e.sentToday)}</b> / {fmtInt(e.dailyCap)}
          </span>
          <span>
            Sessiz saatler: {e.quietStart}–{e.quietEnd} {e.quietNow && <Badge tone="warn">şu an sessiz</Badge>}
          </span>
          <label className="flex items-center gap-2 whitespace-nowrap">
            Tur başına en çok
            <span className="w-20 shrink-0">
              <Input type="number" min={1} max={200} className="h-8" value={String(s.perRun)} disabled={!canEdit} onChange={(ev) => setS({ ...s, perRun: num(ev.target.value) })} />
            </span>
            e-posta
          </label>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Günlük sınır ve sessiz saatler Toplu Gönderim ile ortaktır;{" "}
          <Link href="/settings" className="text-primary hover:underline">
            Ayarlar
          </Link>{" "}
          ekranından değişir. Tur her saat başı 20&apos;de çalışır, saniyede bir e-posta gönderir.
        </p>
      </Card>

      {LIFECYCLE_RULES.map((rule) => {
        const r = s[rule];
        return (
          <Card
            key={rule}
            title={
              <span className="flex items-center gap-2">
                {RULE[rule].title} {r.enabled ? <Badge tone="good">açık</Badge> : <Badge tone="neutral">kapalı</Badge>}
              </span>
            }
            actions={
              canEdit ? (
                <>
                  <Button size="sm" variant="ghost" loading={busy === `test-${rule}-tr`} disabled={busy !== null} onClick={() => void test(rule, "tr")}>
                    <Send className="h-3.5 w-3.5" aria-hidden /> Deneme (TR)
                  </Button>
                  <Button size="sm" variant="ghost" loading={busy === `test-${rule}-en`} disabled={busy !== null} onClick={() => void test(rule, "en")}>
                    <Send className="h-3.5 w-3.5" aria-hidden /> Deneme (EN)
                  </Button>
                </>
              ) : undefined
            }
          >
            <p className="text-sm text-muted-foreground">{RULE[rule].what(s)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Son 30 gün: {fmtInt(state.last30[rule].sent)} gönderildi{state.last30[rule].failed ? `, ${fmtInt(state.last30[rule].failed)} gönderilemedi` : ""} · Şu an izni olan ve bekleyen: {fmtInt(state.waiting[rule])} kişi
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" role="switch" checked={r.enabled} disabled={!canEdit} onChange={(ev) => setRule(rule, { enabled: ev.target.checked })} className="h-4 w-4 accent-[var(--primary)]" />
                Açık
              </label>
              {rule === "inactive" ? (
                <>
                  <Days label="Kaç gündür gelmeyen" value={s.inactive.inactiveDays} min={7} max={180} disabled={!canEdit} onChange={(v) => setRule("inactive", { inactiveDays: v })} />
                  <Days label="En sık (gün)" value={s.inactive.cooldownDays} min={30} max={365} disabled={!canEdit} onChange={(v) => setRule("inactive", { cooldownDays: v })} />
                </>
              ) : (
                <Days
                  label="Kayıttan kaç gün sonra"
                  value={s[rule].afterDays}
                  min={rule === "onboarding" ? 1 : 2}
                  max={rule === "onboarding" ? 14 : 30}
                  disabled={!canEdit}
                  onChange={(v) => setRule(rule, { afterDays: v })}
                />
              )}
              <Field label="Düğmenin açacağı sayfa" htmlFor={`${rule}-link`}>
                <Select id={`${rule}-link`} value={r.link ?? ""} disabled={!canEdit} onChange={(ev) => setRule(rule, { link: ev.target.value || null })} className="w-56">
                  <option value="">Düğme yok</option>
                  {(links.data?.items ?? []).map((l) => (
                    <option key={l.path} value={l.path}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {(["tr", "en"] as const).map((l) => (
                <Lang key={l} title={l === "tr" ? "Türkçe" : "İngilizce (diğer bütün diller)"}>
                  <Field label="Konu" htmlFor={`${rule}-${l}-subject`}>
                    <Input id={`${rule}-${l}-subject`} value={r.subject[l]} maxLength={80} disabled={!canEdit} onChange={(ev) => setRule(rule, { subject: { ...r.subject, [l]: ev.target.value } })} />
                  </Field>
                  <Field label="Metin (boş satırla paragraf)" htmlFor={`${rule}-${l}-body`}>
                    <Textarea id={`${rule}-${l}-body`} rows={5} value={r.body[l]} maxLength={2000} disabled={!canEdit} onChange={(ev) => setRule(rule, { body: { ...r.body, [l]: ev.target.value } })} />
                  </Field>
                </Lang>
              ))}
            </div>
          </Card>
        );
      })}

      <Card>
        {canEdit ? (
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <Field label="Değişiklik gerekçesi" htmlFor="lc-reason" hint={dirty ? "Kaydedilmemiş değişiklik var. Deneme e-postası kaydedilmemiş hâli gönderir." : undefined}>
                <Input id="lc-reason" value={reason} maxLength={200} onChange={(ev) => setReason(ev.target.value)} />
              </Field>
            </div>
            <Button variant="primary" loading={busy === "save"} disabled={!dirty || reason.trim().length < 3 || busy !== null} onClick={() => void save()}>
              <Save className="h-4 w-4" aria-hidden /> Kaydet
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Bu ekranı düzenlemek için Admin yetkisi gerekir.</p>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {state.updatedAt ? `Son kayıt: ${fmtDateTime(state.updatedAt)}${state.updatedBy ? ` · ${state.updatedBy}` : ""}.` : "Henüz kayıt yok; bütün adımlar kapalı."}
        </p>
      </Card>
    </div>
  );
}

function Days({ label, value, min, max, disabled, onChange }: { label: string; value: number; min: number; max: number; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <span className="w-24">
        <Input type="number" min={min} max={max} className="h-9" value={String(value)} disabled={disabled} onChange={(ev) => onChange(num(ev.target.value))} />
      </span>
    </label>
  );
}

function Lang({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-3">
      <legend className="px-1 text-[13px] font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

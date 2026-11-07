"use client";

import { Loader2, RotateCw, Save, Undo2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ErrorState, PageHeader, Spinner } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { SitePreviewLink } from "@/components/site-preview-link";
import { badgeTone } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, useApi } from "@/lib/api";
import { atLeast, type AdminMe, type AppPlatform, type AppVersion, type BrakeMode, type Settings, type SettingsResponse } from "@/lib/types";

// Ayarlar: çalışma zamanı ayarları. Yayın gerekmeden değişir, bütün sunuculara 15 saniye içinde yayılır.
// SUPPORT okur; ADMIN gerekçeyle değiştirir (denetim kaydına yazılır).

const SEMVER = /^\d+\.\d+\.\d+$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const STORE_HOST: Record<AppPlatform, string> = { ios: "apps.apple.com", android: "play.google.com" };

/** Mirrors the backend check, so mistakes show before saving (the backend still decides). */
function versionProblem(platform: AppPlatform, v: AppVersion): string | null {
  if (!SEMVER.test(v.min) || !SEMVER.test(v.latest)) return "Sürüm 1.4.0 biçiminde olmalı.";
  const cmp = (a: string, b: string) => a.split(".").map(Number).reduce((r, n, i) => r || n - Number(b.split(".")[i]), 0);
  if (cmp(v.min, v.latest) > 0) return "En düşük sürüm, en güncel sürümden büyük olamaz.";
  if (v.storeUrl && !v.storeUrl.startsWith(`https://${STORE_HOST[platform]}/`)) return `Mağaza bağlantısı https://${STORE_HOST[platform]}/ ile başlamalı.`;
  if (v.min !== "0.0.0" && !v.storeUrl) return "Zorunlu güncelleme için mağaza bağlantısı gerekli.";
  return null;
}

function broadcastProblem(b: Settings["broadcast"]): string | null {
  if (!HHMM.test(b.quietStart) || !HHMM.test(b.quietEnd)) return "Sessiz saatler 21:00 biçiminde olmalı.";
  if (!Number.isInteger(b.weeklyMarketingCap) || b.weeklyMarketingCap < 1 || b.weeklyMarketingCap > 14) return "Haftalık pazarlama sınırı 1–14 olmalı.";
  if (!Number.isInteger(b.emailDailyCap) || b.emailDailyCap < 1 || b.emailDailyCap > 10_000) return "Günlük e-posta sınırı 1–10.000 olmalı.";
  return null;
}

const BRAKE_LABELS: Record<BrakeMode, string> = {
  off: "Kapalı — bütçe aşılsa da devam et",
  free_single_variant: "Ücretsiz kullanıcıya tek varyant",
  free_paused: "Ücretsiz üretimi durdur",
};

/** Changed top-level keys only; nested objects are sent whole (the API validates the full object). */
function diff(base: Settings, next: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const key of Object.keys(next) as (keyof Settings)[]) {
    if (JSON.stringify(base[key]) !== JSON.stringify(next[key])) (out as Record<string, unknown>)[key] = next[key];
  }
  return out;
}

function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary/40 has-[:checked]:bg-primary-soft/40 has-[:disabled]:cursor-default">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function F({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Group({ title, description, changed, children }: { title: string; description: string; changed: boolean; children: ReactNode }) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {changed && (
          <CardAction>
            <Badge className={badgeTone.warn}>Değişti</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

function NumberSelect({ id, value, onChange, options }: { id: string; value: number; onChange: (v: number) => void; options: number[] }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((n) => (
          <SelectItem key={n} value={String(n)}>
            {n}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SettingsForm({ initial, defaults, writable, onSaved }: { initial: Settings; defaults: Settings; writable: boolean; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [draft, setDraft] = useState<Settings>(initial);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const changes = useMemo(() => diff(initial, draft), [initial, draft]);
  const changedCount = Object.keys(changes).length;
  const changed = (...keys: (keyof Settings)[]) => keys.some((k) => k in changes);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const def = (key: keyof Settings) => `Varsayılan: ${typeof defaults[key] === "object" ? "—" : String(defaults[key])}`;
  const b = draft.broadcast;
  const setB = (patch: Partial<Settings["broadcast"]>) => set("broadcast", { ...b, ...patch });

  async function save() {
    if (!changedCount) return;
    const problem = (["ios", "android"] as const).map((p) => versionProblem(p, draft.appVersions[p])).find(Boolean) ?? broadcastProblem(draft.broadcast);
    if (problem) {
      toast("error", problem);
      return;
    }
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
    <fieldset disabled={!writable || saving} className="flex min-w-0 flex-col gap-5">
      {!writable && <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">Ayarları yalnız yönetici (ADMIN) değiştirebilir; burada görüntülüyorsun.</p>}

      <div className="grid gap-5 xl:grid-cols-2">
        <Group title="Kota ve varyantlar" description="Günlük üretim hakları ve tek istekte üretilebilecek en fazla varyant." changed={changed("freeDailyGenerations", "proDailyGenerations", "maxVariantsFree", "maxVariantsPro", "welcomeCredits")}>
          <F label="Ücretsiz günlük hak" htmlFor="free" hint={def("freeDailyGenerations")}>
            <Input id="free" type="number" min={0} max={1000} value={draft.freeDailyGenerations} onChange={(e) => set("freeDailyGenerations", num(e.target.value))} />
          </F>
          <F label="PRO günlük hak (adil kullanım)" htmlFor="pro" hint={def("proDailyGenerations")}>
            <Input id="pro" type="number" min={1} max={1000} value={draft.proDailyGenerations} onChange={(e) => set("proDailyGenerations", num(e.target.value))} />
          </F>
          <F label="En fazla varyant (ücretsiz)" htmlFor="vfree" hint={def("maxVariantsFree")}>
            <NumberSelect id="vfree" value={draft.maxVariantsFree} onChange={(v) => set("maxVariantsFree", v as Settings["maxVariantsFree"])} options={[1, 2, 3, 4]} />
          </F>
          <F label="En fazla varyant (PRO)" htmlFor="vpro" hint={def("maxVariantsPro")}>
            <NumberSelect id="vpro" value={draft.maxVariantsPro} onChange={(v) => set("maxVariantsPro", v as Settings["maxVariantsPro"])} options={[1, 2, 3, 4]} />
          </F>
          <div className="md:col-span-2">
            <F
              label="Hoş geldin kredisi"
              htmlFor="welcome"
              hint={`Kayıt olup e-postasını (ya da Apple/Google hesabını) doğrulayan yeni hesaba bir kez verilir; aynı kimlik hesabı silip yeniden açsa da tekrar almaz. 0 = kapalı. ${def("welcomeCredits")}`}
            >
              <Input id="welcome" type="number" min={0} max={50} value={draft.welcomeCredits} onChange={(e) => set("welcomeCredits", num(e.target.value))} className="md:w-1/2" />
            </F>
          </div>
        </Group>

        <Group title="AI bütçesi" description="Günlük AI harcaması bütçeyi aşınca yalnız ücretsiz kullanıcılar etkilenir; PRO kullanıcılar devam eder." changed={changed("dailyBudgetUsd", "budgetBrakeMode")}>
          <F label="Günlük bütçe (USD)" htmlFor="budget" hint="0 = sınırsız">
            <Input id="budget" type="number" min={0} step="0.01" value={draft.dailyBudgetUsd} onChange={(e) => set("dailyBudgetUsd", num(e.target.value))} />
          </F>
          <F label="Bütçe aşılınca" htmlFor="brake">
            <Select value={draft.budgetBrakeMode} onValueChange={(v) => set("budgetBrakeMode", v as BrakeMode)}>
              <SelectTrigger id="brake" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(BRAKE_LABELS) as BrakeMode[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {BRAKE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>
        </Group>

        <Group
          title="Toplu gönderim ve e-posta"
          description="Pazarlama bildirimleri ve e-postaları için sınırlar. Toplu gönderim, yaşam döngüsü e-postaları ve bekleme listesi bu sınırlara uyar."
          changed={changed("broadcast")}
        >
          <F label="Kişi başı haftalık pazarlama bildirimi" htmlFor="weeklyCap" hint="Son 7 günde bir kişiye en fazla bu kadar pazarlama bildirimi gider (1–14).">
            <Input id="weeklyCap" type="number" min={1} max={14} value={b.weeklyMarketingCap} onChange={(e) => setB({ weeklyMarketingCap: num(e.target.value) })} />
          </F>
          <F label="Günlük e-posta sınırı" htmlFor="emailCap" hint="Bütün gönderimlerin toplamı. Paylaşılan posta sunucusunun itibarı için düşük tut (1–10.000).">
            <Input id="emailCap" type="number" min={1} max={10000} value={b.emailDailyCap} onChange={(e) => setB({ emailDailyCap: num(e.target.value) })} />
          </F>
          <F label="Sessiz saat başlangıcı" htmlFor="quietStart" hint="İstanbul saati; bu aralıkta pazarlama gönderilmez.">
            <Input id="quietStart" type="time" value={b.quietStart} onChange={(e) => setB({ quietStart: e.target.value })} />
          </F>
          <F label="Sessiz saat bitişi" htmlFor="quietEnd">
            <Input id="quietEnd" type="time" value={b.quietEnd} onChange={(e) => setB({ quietEnd: e.target.value })} />
          </F>
          {broadcastProblem(b) && (
            <p className="text-xs text-danger md:col-span-2" role="alert">
              {broadcastProblem(b)}
            </p>
          )}
        </Group>

        <Group title="KVKK" description="Açıkken üretimden önce kullanıcının güncel “yapay zekâ ile işleme” onayı aranır." changed={changed("requireAiConsent")}>
          <div className="md:col-span-2">
            <Toggle id="consent" checked={draft.requireAiConsent} onChange={(v) => set("requireAiConsent", v)} label="AI işleme onayı zorunlu" hint="Onayı olmayan kullanıcı üretimde 403 consent_required alır ve uygulama onay ekranını açar." />
          </div>
        </Group>

        <Group title="Bakım modu" description="İki ayrı anahtar; aşağıdaki mesaj ikisinde de gösterilir." changed={changed("maintenance")}>
          <div className="grid gap-3 md:col-span-2">
            <Toggle
              id="maint"
              checked={draft.maintenance.enabled}
              onChange={(v) => set("maintenance", { ...draft.maintenance, enabled: v })}
              label="Yeni üretimi durdur"
              hint="Uygulamalarda ve web’de yeni tasarım 503 ile reddedilir; mesaj uygulamalarda gösterilir."
            />
            <Toggle
              id="maintSite"
              checked={draft.maintenance.site}
              onChange={(v) => set("maintenance", { ...draft.maintenance, site: v })}
              label="Web sitesini kapat (bakım sayfası)"
              hint="casalume.app’in bütün sayfaları 503 ve bu mesajla bakım sayfası gösterir (Türkçe ziyaretçiye TR, diğerlerine EN). Uygulamalar etkilenmez. 15 saniye içinde yayılır."
            />
          </div>
          <F label="Mesaj (TR)" htmlFor="mtr" hint={`${draft.maintenance.messageTr.length}/300`}>
            <Textarea id="mtr" rows={2} maxLength={300} value={draft.maintenance.messageTr} onChange={(e) => set("maintenance", { ...draft.maintenance, messageTr: e.target.value })} />
          </F>
          <F label="Mesaj (EN)" htmlFor="men" hint={`${draft.maintenance.messageEn.length}/300`}>
            <Textarea id="men" rows={2} maxLength={300} value={draft.maintenance.messageEn} onChange={(e) => set("maintenance", { ...draft.maintenance, messageEn: e.target.value })} />
          </F>
          <SitePreviewLink writable={writable} />
        </Group>

        <Group title="Uygulama duyurusu" description="Katalog yanıtıyla bütün uygulamalara gider (ör. yeni stil duyurusu). Web sitesinin duyuru şeridi Ana sayfa ve SSS’ten yönetilir." changed={changed("announcement")}>
          <div className="md:col-span-2">
            <Toggle id="ann" checked={draft.announcement.enabled} onChange={(v) => set("announcement", { ...draft.announcement, enabled: v })} label="Duyuru yayında" />
          </div>
          <F label="Metin (TR)" htmlFor="atr" hint={`${draft.announcement.textTr.length}/300`}>
            <Textarea id="atr" rows={2} maxLength={300} value={draft.announcement.textTr} onChange={(e) => set("announcement", { ...draft.announcement, textTr: e.target.value })} />
          </F>
          <F label="Metin (EN)" htmlFor="aen" hint={`${draft.announcement.textEn.length}/300`}>
            <Textarea id="aen" rows={2} maxLength={300} value={draft.announcement.textEn} onChange={(e) => set("announcement", { ...draft.announcement, textEn: e.target.value })} />
          </F>
        </Group>
      </div>

      <Group
        title="Zorunlu güncelleme"
        description="En düşük sürümün altındaki mobil uygulamalar her istekte 426 alır ve mağazaya yönlendirilir; en güncel sürümden eski olanlar kapatılabilir bir uyarı görür. 0.0.0 = kapalı. Mağaza bağlantıları bekleme listesinde de kullanılır."
        changed={changed("appVersions")}
      >
        {(["ios", "android"] as const).map((p) => {
          const v = draft.appVersions[p];
          const setV = (patch: Partial<AppVersion>) => set("appVersions", { ...draft.appVersions, [p]: { ...v, ...patch } });
          const problem = versionProblem(p, v);
          return (
            <div key={p} className="grid gap-3 rounded-lg border p-4">
              <p className="text-sm font-semibold">{p === "ios" ? "iOS (App Store)" : "Android (Google Play)"}</p>
              <div className="grid grid-cols-2 gap-3">
                <F label="En düşük sürüm" htmlFor={`${p}-min`}>
                  <Input id={`${p}-min`} value={v.min} inputMode="decimal" placeholder="1.4.0" onChange={(e) => setV({ min: e.target.value.trim() })} />
                </F>
                <F label="En güncel sürüm" htmlFor={`${p}-latest`}>
                  <Input id={`${p}-latest`} value={v.latest} inputMode="decimal" placeholder="1.6.2" onChange={(e) => setV({ latest: e.target.value.trim() })} />
                </F>
              </div>
              <F label="Mağaza bağlantısı" htmlFor={`${p}-store`}>
                <Input id={`${p}-store`} value={v.storeUrl} placeholder={`https://${STORE_HOST[p]}/...`} onChange={(e) => setV({ storeUrl: e.target.value.trim() })} />
              </F>
              {problem && (
                <p className="text-xs text-danger" role="alert">
                  {problem}
                </p>
              )}
            </div>
          );
        })}
      </Group>

      {writable && (
        <div className="sticky bottom-3 z-10 rounded-xl border bg-card p-4 shadow-lg">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="reason">Değişiklik gerekçesi (zorunlu, denetim kaydına yazılır)</Label>
              <Input id="reason" value={reason} maxLength={200} placeholder="Ör. kampanya haftası için ücretsiz hakkı artırıyoruz" onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {changedCount > 0 ? <Badge className={badgeTone.warn}>{changedCount} değişiklik</Badge> : <Badge className={badgeTone.neutral}>Değişiklik yok</Badge>}
              <Button variant="ghost" onClick={() => setDraft(initial)} disabled={!changedCount || saving}>
                <Undo2 aria-hidden /> Geri al
              </Button>
              <Button onClick={save} disabled={!changedCount || saving}>
                {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Kaydet
              </Button>
            </div>
          </div>
        </div>
      )}
    </fieldset>
  );
}

export default function SettingsPage() {
  const res = useApi<SettingsResponse>("/settings");
  const me = useApi<AdminMe>("/me");
  return (
    <>
      <PageHeader
        title="Ayarlar"
        description="Çalışma zamanı ayarları: yayın gerekmeden değişir, bütün sunuculara 15 saniye içinde yayılır."
        actions={
          <Button variant="outline" onClick={res.reload} disabled={res.loading && Boolean(res.data)}>
            {res.loading && res.data ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />} Yenile
          </Button>
        }
      />
      {res.error && !res.data ? (
        <ErrorState message={res.error.message} onRetry={res.reload} />
      ) : !res.data || (!me.data && !me.error) ? (
        <Spinner />
      ) : (
        // Re-mount the form after every reload so the draft starts from the saved values.
        <SettingsForm key={JSON.stringify(res.data.values)} initial={res.data.values} defaults={res.data.defaults} writable={atLeast(me.data?.role, "ADMIN")} onSaved={res.reload} />
      )}
    </>
  );
}

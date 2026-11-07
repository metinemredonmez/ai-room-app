"use client";

import { AlertTriangle, Loader2, Play, Plus, RotateCw, Save, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { ErrorState, PageHeader, Spinner } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { badgeTone } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, useApi } from "@/lib/api";
import { atLeast, type AdminMe, type CoachSettings, type CoachStatus, type CrisisLine, type SettingsResponse, type SpokenReply, type VoiceProvider } from "@/lib/types";

// AI koç (API.md §7.54): the coach's voice, the day's allowance and the crisis lines. Saved through the same runtime
// settings as everything else (PATCH /settings with a reason, audited). SUPPORT reads; ADMIN changes.
// The coach's tone of voice is a prompt template (İstem şablonları → "coach").

const ELEVEN_VOICE = /^[A-Za-z0-9]{10,40}$/;
const MODEL_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const PHONE = /^[0-9+][0-9 ]{1,18}$/;
// OpenAI's built-in voices (the panel lists them; the backend only checks the shape).
const OPENAI_VOICES = ["alloy", "ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse"];
const NAMES: Record<VoiceProvider, string> = { elevenlabs: "ElevenLabs", openai: "OpenAI" };
const CHAINS: Record<string, VoiceProvider[]> = {
  "elevenlabs,openai": ["elevenlabs", "openai"],
  "openai,elevenlabs": ["openai", "elevenlabs"],
  elevenlabs: ["elevenlabs"],
  openai: ["openai"],
};
const CHAIN_LABEL: Record<string, string> = {
  "elevenlabs,openai": "ElevenLabs, düşerse OpenAI",
  "openai,elevenlabs": "OpenAI, düşerse ElevenLabs",
  elevenlabs: "Yalnız ElevenLabs",
  openai: "Yalnız OpenAI",
};

/** Mirrors the backend rules so mistakes show before saving (the backend still decides). */
function problem(c: CoachSettings): string | null {
  const v = c.voice;
  if (!MODEL_ID.test(v.elevenlabs.model) || !MODEL_ID.test(v.openai.model)) return "Model adı geçersiz.";
  for (const id of [v.elevenlabs.voiceTr, v.elevenlabs.voiceEn]) if (id && !ELEVEN_VOICE.test(id)) return "ElevenLabs ses kimliği 10–40 harf ve rakam olmalı.";
  const tiers = [c.quota.free, c.quota.pro];
  if (tiers.some((t) => !Number.isInteger(t.messages) || t.messages < 0 || t.messages > 1000)) return "Mesaj hakkı 0–1000 olmalı.";
  if (tiers.some((t) => !Number.isInteger(t.listenSeconds) || t.listenSeconds < 0 || t.listenSeconds > 36000)) return "Dinleme hakkı 0–36000 saniye olmalı.";
  if (c.limitTextTr.trim().length < 5 || c.limitTextEn.trim().length < 5) return "Hak bitti metni en az 5 karakter olmalı.";
  for (const lines of [c.crisis.linesTr, c.crisis.linesEn]) {
    if (!lines.length) return "Her dilde en az bir kriz hattı olmalı.";
    if (lines.some((l) => l.label.trim().length < 2 || !PHONE.test(l.phone.trim()))) return "Kriz hattında ad ve geçerli bir numara olmalı.";
    if (lines.some((l) => ["182", "175"].includes(l.phone.replace(/\s/g, "")))) return "182 ve 175 kriz hattı değildir (randevu ve tüketici hatları).";
  }
  return null;
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

function Group({ title, description, changed, children, wide }: { title: string; description: ReactNode; changed: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <Card className={`gap-4 ${wide ? "xl:col-span-2" : ""}`}>
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

function VoiceStatus({ status, settings }: { status: CoachStatus | null; settings: CoachSettings }) {
  if (!status) return null;
  const missingKey = settings.voice.chain.filter((p) => !status.configuredProviders.includes(p));
  const noVoice = (["tr", "en"] as const).filter((l) => !status.assigned[l].length);
  const cost = status.last30Days.reduce((a, r) => a + r.costUsd, 0);
  return (
    <Card className="gap-3 xl:col-span-2">
      <CardHeader>
        <CardTitle>Durum</CardTitle>
        <CardDescription>Kaydedilmiş ayarlara göre. Anahtarlar yalnız sunucudaki .env dosyasında durur; burada görünmez.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap gap-2">
          {(["elevenlabs", "openai"] as const).map((p) => (
            <Badge key={p} className={status.configuredProviders.includes(p) ? badgeTone.good : badgeTone.neutral}>
              {NAMES[p]}: {status.configuredProviders.includes(p) ? "anahtar var" : "anahtar yok"}
            </Badge>
          ))}
          <Badge className={badgeTone.neutral}>
            Önbellek: {status.cache.files} ses · {(status.cache.bytes / 1024 / 1024).toFixed(1)} MB
          </Badge>
          <Badge className={badgeTone.neutral}>Son 30 gün ses maliyeti: ${cost.toFixed(2)}</Badge>
        </div>
        {settings.voice.enabled && (missingKey.length > 0 || noVoice.length > 0) && (
          <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-warn">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {noVoice.length > 0 && <>Ses seçilmedi ({noVoice.map((l) => l.toUpperCase()).join(", ")}): bu dilde “Dinle” hata verir. </>}
              {missingKey.length > 0 && <>{missingKey.map((p) => NAMES[p]).join(", ")} anahtarı sunucuda yok; sırada atlanır. Anahtarı yalnız sen `set-secret.sh` ile girersin.</>}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Lines({ id, lines, onChange }: { id: string; lines: CrisisLine[]; onChange: (l: CrisisLine[]) => void }) {
  return (
    <div className="grid gap-2">
      {lines.map((l, i) => (
        <div key={i} className="flex gap-2">
          <Input aria-label="Hat adı" value={l.label} maxLength={60} onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <Input aria-label="Numara" className="w-28" inputMode="tel" value={l.phone} maxLength={19} onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
          <Button type="button" variant="ghost" size="icon" aria-label="Hattı kaldır" disabled={lines.length <= 1} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <Button id={id} type="button" variant="outline" size="sm" className="justify-self-start" disabled={lines.length >= 5} onClick={() => onChange([...lines, { label: "", phone: "" }])}>
        <Plus aria-hidden /> Hat ekle
      </Button>
    </div>
  );
}

function CoachForm({ initial, defaults, writable, status, onSaved }: { initial: CoachSettings; defaults: CoachSettings; writable: boolean; status: CoachStatus | null; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [draft, setDraft] = useState<CoachSettings>(initial);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);
  const part = (k: keyof CoachSettings) => JSON.stringify(draft[k]) !== JSON.stringify(initial[k]);
  const v = draft.voice;
  const setV = (patch: Partial<CoachSettings["voice"]>) => setDraft((d) => ({ ...d, voice: { ...d.voice, ...patch } }));
  const setEl = (patch: Partial<CoachSettings["voice"]["elevenlabs"]>) => setV({ elevenlabs: { ...v.elevenlabs, ...patch } });
  const setOa = (patch: Partial<CoachSettings["voice"]["openai"]>) => setV({ openai: { ...v.openai, ...patch } });
  const setTier = (tier: "free" | "pro", patch: Partial<CoachSettings["quota"]["free"]>) =>
    setDraft((d) => ({ ...d, quota: { ...d.quota, [tier]: { ...d.quota[tier], ...patch } } }));
  const num = (s: string) => (s === "" ? 0 : Number(s));

  async function save() {
    const p = problem(draft);
    if (p) return toast("error", p);
    if (reason.trim().length < 3) return toast("error", "Değişiklik gerekçesi en az 3 karakter olmalı.");
    setSaving(true);
    try {
      await api("/settings", { method: "PATCH", body: { values: { coach: draft }, reason: reason.trim() } });
      toast("success", "Koç ayarları kaydedildi.");
      setReason("");
      onSaved();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function preview(provider: VoiceProvider, locale: "tr" | "en") {
    const key = `${provider}:${locale}`;
    setPlaying(key);
    try {
      const out = await api<SpokenReply>("/coach/preview", { method: "POST", body: { provider, locale } });
      audio.current?.pause();
      audio.current = new Audio(out.url);
      audio.current.onended = () => setPlaying(null);
      await audio.current.play();
    } catch (e) {
      setPlaying(null);
      toast("error", e instanceof ApiError ? e.message : "Ses çalınamadı.");
    }
  }

  const previewButton = (provider: VoiceProvider, locale: "tr" | "en", voice: string) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!voice || dirty || playing !== null || !writable}
      title={dirty ? "Önce kaydet: dinleme kayıtlı ayarla yapılır" : undefined}
      onClick={() => void preview(provider, locale)}
    >
      {playing === `${provider}:${locale}` ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />} Dinle ({locale.toUpperCase()})
    </Button>
  );

  return (
    <fieldset disabled={!writable || saving} className="flex min-w-0 flex-col gap-5">
      {!writable && <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">Koç ayarlarını yalnız yönetici (ADMIN) değiştirebilir; burada görüntülüyorsun.</p>}
      <div className="grid gap-5 xl:grid-cols-2">
        <VoiceStatus status={status} settings={initial} />

        <Group
          title="Koçun sesi"
          description="Koç yalnız kendi cevabını okur. Aynı cevap bir kez seslendirilir, sonra önbellekten gelir. Ses dosyaları özel depoda durur, süreli ve imzalı bağlantıyla açılır."
          changed={part("voice")}
          wide
        >
          <label htmlFor="voice-on" className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary/40 has-[:checked]:bg-primary-soft/40 md:col-span-2">
            <input id="voice-on" type="checkbox" checked={v.enabled} onChange={(e) => setV({ enabled: e.target.checked })} className="mt-0.5 size-4 accent-[var(--primary)]" />
            <span>
              <span className="block text-sm font-medium">Sesli okuma açık</span>
              <span className="block text-xs text-muted-foreground">Kapalıyken sohbet yazılı sürer, “Dinle” düğmesi görünmez.</span>
            </span>
          </label>
          <F label="Sağlayıcı sırası" htmlFor="chain" hint="İlk sağlayıcı cevap vermezse ikincisi denenir. İkinci sağlayıcının sesi önbelleğe alınmaz.">
            <Select value={v.chain.join(",")} onValueChange={(x) => setV({ chain: CHAINS[x] ?? v.chain })}>
              <SelectTrigger id="chain" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(CHAINS).map((k) => (
                  <SelectItem key={k} value={k}>
                    {CHAIN_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>
          <F label="Önbellek süresi (gün)" htmlFor="cache" hint={`Bu süre dinlenmeyen ses dosyası gece silinir. Varsayılan: ${defaults.voice.cacheDays}`}>
            <Input id="cache" type="number" min={1} max={90} value={v.cacheDays} onChange={(e) => setV({ cacheDays: num(e.target.value) })} />
          </F>

          <div className="grid gap-4 rounded-lg border p-4 md:col-span-2 md:grid-cols-2">
            <p className="text-sm font-medium md:col-span-2">ElevenLabs</p>
            <F label="Türkçe ses kimliği" htmlFor="el-tr" hint="ElevenLabs → Voices → sesin kimliği. “Default” ve “Legacy” etiketli sesleri seçme; 31 Aralık 2026'da kapanıyorlar.">
              <div className="flex gap-2">
                <Input id="el-tr" value={v.elevenlabs.voiceTr} placeholder="seçilmedi" maxLength={40} onChange={(e) => setEl({ voiceTr: e.target.value.trim() })} />
                {previewButton("elevenlabs", "tr", initial.voice.elevenlabs.voiceTr)}
              </div>
            </F>
            <F label="İngilizce ses kimliği (diğer diller de)" htmlFor="el-en">
              <div className="flex gap-2">
                <Input id="el-en" value={v.elevenlabs.voiceEn} placeholder="seçilmedi" maxLength={40} onChange={(e) => setEl({ voiceEn: e.target.value.trim() })} />
                {previewButton("elevenlabs", "en", initial.voice.elevenlabs.voiceEn)}
              </div>
            </F>
            <F label="Model" htmlFor="el-model" hint={`Varsayılan: ${defaults.voice.elevenlabs.model}`}>
              <Input id="el-model" value={v.elevenlabs.model} maxLength={80} onChange={(e) => setEl({ model: e.target.value.trim() })} />
            </F>
            <div className="grid grid-cols-2 gap-4">
              <F label="Kararlılık (0–1)" htmlFor="el-stab">
                <Input id="el-stab" type="number" step={0.05} min={0} max={1} value={v.elevenlabs.stability} onChange={(e) => setEl({ stability: num(e.target.value) })} />
              </F>
              <F label="Hız (0,7–1,2)" htmlFor="el-speed">
                <Input id="el-speed" type="number" step={0.05} min={0.7} max={1.2} value={v.elevenlabs.speed} onChange={(e) => setEl({ speed: num(e.target.value) })} />
              </F>
            </div>
          </div>

          <div className="grid gap-4 rounded-lg border p-4 md:col-span-2 md:grid-cols-2">
            <p className="text-sm font-medium md:col-span-2">OpenAI</p>
            {(["tr", "en"] as const).map((l) => {
              const key = l === "tr" ? "voiceTr" : "voiceEn";
              return (
                <F key={l} label={l === "tr" ? "Türkçe ses" : "İngilizce ses (diğer diller de)"} htmlFor={`oa-${l}`}>
                  <div className="flex gap-2">
                    <Select value={v.openai[key] || "none"} onValueChange={(x) => setOa({ [key]: x === "none" ? "" : x })}>
                      <SelectTrigger id={`oa-${l}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">seçilmedi</SelectItem>
                        {OPENAI_VOICES.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {previewButton("openai", l, initial.voice.openai[key])}
                  </div>
                </F>
              );
            })}
            <F label="Model" htmlFor="oa-model" hint={`Varsayılan: ${defaults.voice.openai.model}. Eski tts-1 6 Ocak 2027'de kapanıyor, kullanma.`}>
              <Input id="oa-model" value={v.openai.model} maxLength={80} onChange={(e) => setOa({ model: e.target.value.trim() })} />
            </F>
          </div>
        </Group>

        <Group title="Günlük hak" description="İstanbul gününe göre. Kriz mesajları haktan düşmez; cevap gelmezse hak iade edilir." changed={part("quota")}>
          {(["free", "pro"] as const).map((t) => (
            <div key={t} className="grid gap-4">
              <p className="text-sm font-medium">{t === "free" ? "Ücretsiz" : "Pro"}</p>
              <F label="Mesaj" htmlFor={`${t}-msg`} hint={`Varsayılan: ${defaults.quota[t].messages}`}>
                <Input id={`${t}-msg`} type="number" min={0} max={1000} value={draft.quota[t].messages} onChange={(e) => setTier(t, { messages: num(e.target.value) })} />
              </F>
              <F label="Dinleme (saniye)" htmlFor={`${t}-sec`} hint={`≈ ${Math.round(draft.quota[t].listenSeconds / 60)} dk · varsayılan ${defaults.quota[t].listenSeconds} sn`}>
                <Input id={`${t}-sec`} type="number" min={0} max={36000} value={draft.quota[t].listenSeconds} onChange={(e) => setTier(t, { listenSeconds: num(e.target.value) })} />
              </F>
            </div>
          ))}
        </Group>

        <Group title="Hak bitince" description="Kullanıcının gördüğü metin (Türkçe kullanıcılara Türkçe, diğerlerine İngilizce)." changed={part("limitTextTr") || part("limitTextEn")}>
          <F label="Türkçe" htmlFor="lim-tr">
            <Textarea id="lim-tr" rows={3} maxLength={300} value={draft.limitTextTr} onChange={(e) => setDraft((d) => ({ ...d, limitTextTr: e.target.value }))} />
          </F>
          <F label="İngilizce" htmlFor="lim-en">
            <Textarea id="lim-en" rows={3} maxLength={300} value={draft.limitTextEn} onChange={(e) => setDraft((d) => ({ ...d, limitTextEn: e.target.value }))} />
          </F>
        </Group>

        <Group
          title="Kriz hatları"
          description="İntihar, kendine zarar ya da şiddet işareti taşıyan mesaja AI çağrılmadan ve hak düşmeden bu hatlar gösterilir. Yalnız doğrulanmış numaralar: Türkiye'de ayrı bir intihar hattı yok, hayati tehlikede 112. 182 hastane randevu hattıdır."
          changed={part("crisis")}
          wide
        >
          <F label="Türkçe" htmlFor="crisis-tr-add">
            <Lines id="crisis-tr-add" lines={draft.crisis.linesTr} onChange={(linesTr) => setDraft((d) => ({ ...d, crisis: { ...d.crisis, linesTr } }))} />
          </F>
          <F label="Diğer diller" htmlFor="crisis-en-add">
            <Lines id="crisis-en-add" lines={draft.crisis.linesEn} onChange={(linesEn) => setDraft((d) => ({ ...d, crisis: { ...d.crisis, linesEn } }))} />
          </F>
        </Group>

        <Card className="gap-2 xl:col-span-2">
          <CardHeader>
            <CardTitle>Koçun üslubu</CardTitle>
            <CardDescription>
              Koçun nasıl konuştuğu bir istem şablonudur: <Link className="underline" href="/prompts">İstem şablonları → coach</Link>. Güvenlik kuralları (dil, kapsam, kullanıcı metninin talimat sayılmaması, kriz) kodda kalır, şablondan değişmez.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {writable && dirty && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 shadow-lg">
          <F label="Değişiklik gerekçesi" htmlFor="reason">
            <Input id="reason" className="w-80 max-w-full" value={reason} maxLength={200} placeholder="ör. Türkçe ses seçildi" onChange={(e) => setReason(e.target.value)} />
          </F>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Kaydet
          </Button>
          <Button variant="ghost" onClick={() => setDraft(initial)} disabled={saving}>
            <Undo2 aria-hidden /> Vazgeç
          </Button>
        </div>
      )}
    </fieldset>
  );
}

export default function CoachPage() {
  const res = useApi<SettingsResponse>("/settings");
  const status = useApi<CoachStatus>("/coach");
  const me = useApi<AdminMe>("/me");
  const reload = () => {
    res.reload();
    status.reload();
  };
  return (
    <>
      <PageHeader
        title="AI koç"
        description="Koçun sesi, günlük hak ve kriz hatları. Yayın gerekmeden değişir, 15 saniye içinde bütün sunuculara yayılır."
        actions={
          <Button variant="outline" onClick={reload} disabled={res.loading && Boolean(res.data)}>
            {res.loading && res.data ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />} Yenile
          </Button>
        }
      />
      {res.error && !res.data ? (
        <ErrorState message={res.error.message} onRetry={res.reload} />
      ) : !res.data || (!me.data && !me.error) ? (
        <Spinner />
      ) : (
        <CoachForm
          key={JSON.stringify(res.data.values.coach)}
          initial={res.data.values.coach}
          defaults={res.data.defaults.coach}
          writable={atLeast(me.data?.role, "ADMIN")}
          status={status.data ?? null}
          onSaved={reload}
        />
      )}
    </>
  );
}

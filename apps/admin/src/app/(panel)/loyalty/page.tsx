"use client";

import { CalendarHeart, Flame, Play, Repeat, Save } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Spinner } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { AdminMe, LoyaltyMessage, LoyaltyRule, LoyaltySettings, LoyaltyState } from "@/lib/types";

// Sadakat kuralları (API.md §7.35): kendiliğinden verilen hediyeler. Giriş serisi o günün ilk isteğinde sayılır;
// yıldönümü ve geri dönüş her gün 11:00'de (İstanbul) verilir. Yalnız doğrulanmış gerçek kullanıcılar alır; kimse aynı
// dönem için iki kez almaz. Hepsi kapalı başlar. Kayıt gerekçe ister ve denetlenir.

export default function LoyaltyPage() {
  const state = useApi<LoyaltyState>("/loyalty");
  const me = useApi<AdminMe>("/me");
  const s = state.data;
  return (
    <>
      <PageHeader
        title="Sadakat kuralları"
        description="Kendiliğinden verilen hediye krediler: üst üste gelen, hesabının yıldönümü olan ve bir süredir gelmeyen kullanıcılara. Yalnız e-postası doğrulanmış kullanıcılar alır; kimse aynı dönem için iki kez almaz. Her hediye bildirimle gider ve kredi hareketlerinde “Hediye” olarak görünür."
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

function Editor({ state, canEdit, onSaved, onReload }: { state: LoyaltyState; canEdit: boolean; onSaved: (s: LoyaltyState) => void; onReload: () => void }) {
  const { toast, confirm } = useFeedback();
  const [settings, setSettings] = useState<LoyaltySettings>(state.settings);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const dirty = JSON.stringify(settings) !== JSON.stringify(state.settings);

  const set = <R extends LoyaltyRule>(rule: R, patch: Partial<LoyaltySettings[R]>) => setSettings((x) => ({ ...x, [rule]: { ...x[rule], ...patch } }));
  const num = (v: string) => (v === "" ? 0 : Math.trunc(Number(v)));

  async function save() {
    setBusy("save");
    try {
      const out = await api<LoyaltyState>("/loyalty", { method: "PATCH", body: { settings, reason: reason.trim(), version: state.version } });
      setReason("");
      onSaved(out);
      toast("success", "Kaydedildi; en geç 15 saniyede geçerli olur.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (await confirm({ title: "Kurallar bu arada değişti", description: "Başka biri kaydetmiş. Güncel hâli yüklensin mi? (Kaydedilmemiş değişikliklerin gider.)", confirmLabel: "Yükle" })) onReload();
      } else toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    const t = state.today;
    const ok = await confirm({
      title: "Bugünün hediyeleri şimdi verilsin mi?",
      description: `Açık kurallara göre şu an: yıldönümü ${t.anniversary} kişi, geri dönüş ${t.winback} kişi (bekleyen ${t.winbackWaiting}). Krediler hemen eklenir ve bildirim gider. Bugün zaten alan kimse yeniden almaz; saat 11:00'deki iş de kimseye ikinci kez vermez.`,
      confirmLabel: "Şimdi ver",
    });
    if (!ok) return;
    const why = window.prompt("Neden şimdi? (denetim kaydına yazılır)");
    if (!why || why.trim().length < 3) return;
    setBusy("run");
    try {
      const out = await api<{ anniversary: number; winback: number }>("/loyalty/run", { method: "POST", body: { reason: why.trim() } });
      toast("success", `Verildi: yıldönümü ${out.anniversary}, geri dönüş ${out.winback} kişi.`);
      onReload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Çalıştırılamadı.");
    } finally {
      setBusy(null);
    }
  }

  const st = state.stats;
  const s = settings;
  return (
    <div className="flex flex-col gap-4">
      {!canEdit && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted-foreground">Görüntüleme yetkin var; değiştirmek için yönetici rolü gerekir.</p>}

      <RuleCard
        icon={<Flame className="h-4 w-4" aria-hidden />}
        title="Giriş serisi"
        hint="Kullanıcı üst üste bu kadar gün uygulamayı ya da siteyi açınca (İstanbul takvimi) hediye alır; serinin her katında yeniden (7, 14, 21… gün). Bir gün kaçarsa seri baştan başlar."
        enabled={s.streak.enabled}
        saved={state.settings.streak.enabled}
        canEdit={canEdit}
        onToggle={(v) => set("streak", { enabled: v })}
        stats={st.streak}
      >
        <NumberField id="streak-days" label="Gün (3–60)" value={s.streak.days} min={3} max={60} disabled={!canEdit} onChange={(v) => set("streak", { days: num(v) })} />
        <NumberField id="streak-credits" label="Kredi (1–20)" value={s.streak.credits} min={1} max={20} disabled={!canEdit} onChange={(v) => set("streak", { credits: num(v) })} />
        <MessageFields id="streak" value={s.streak.message} disabled={!canEdit} onChange={(m) => set("streak", { message: m })} placeholder={`Teşekkürler! Hesabına ${s.streak.credits} hediye kredi eklendi.`} />
      </RuleCard>

      <RuleCard
        icon={<CalendarHeart className="h-4 w-4" aria-hidden />}
        title="Hesap yıldönümü"
        hint="Hesabın açıldığı günün her yıl dönümünde hediye. (Doğum günü için doğum tarihi toplamak gerekir; KVKK gereği toplamıyoruz.)"
        enabled={s.anniversary.enabled}
        saved={state.settings.anniversary.enabled}
        canEdit={canEdit}
        onToggle={(v) => set("anniversary", { enabled: v })}
        stats={st.anniversary}
        today={state.settings.anniversary.enabled ? `Bugün ${fmtInt(state.today.anniversary)} kişi alacak.` : `Açık olsaydı bugün ${fmtInt(state.today.anniversary)} kişi alırdı.`}
      >
        <NumberField id="ann-credits" label="Kredi (1–50)" value={s.anniversary.credits} min={1} max={50} disabled={!canEdit} onChange={(v) => set("anniversary", { credits: num(v) })} />
        <MessageFields id="anniversary" value={s.anniversary.message} disabled={!canEdit} onChange={(m) => set("anniversary", { message: m })} placeholder={`Birlikte bir yıl daha! Hesabına ${s.anniversary.credits} hediye kredi eklendi.`} />
      </RuleCard>

      <RuleCard
        icon={<Repeat className="h-4 w-4" aria-hidden />}
        title="Kendiliğinden geri dönüş"
        hint="Bu kadar gündür gelmeyenlere hediye ve “Seni özledik” bildirimi. Aynı kişi bekleme süresi dolmadan yeniden almaz; günde en çok belirlediğin kadar kişi alır (en son bırakanlar önce)."
        enabled={s.winback.enabled}
        saved={state.settings.winback.enabled}
        canEdit={canEdit}
        onToggle={(v) => set("winback", { enabled: v })}
        stats={st.winback}
        today={
          state.settings.winback.enabled
            ? `Bugün ${fmtInt(state.today.winback)} kişi alacak (bekleyen ${fmtInt(state.today.winbackWaiting)}).`
            : `Açık olsaydı bugün ${fmtInt(state.today.winback)} kişi alırdı (bekleyen ${fmtInt(state.today.winbackWaiting)}).`
        }
      >
        <NumberField id="wb-days" label="Kaç gündür gelmeyen (7–365)" value={s.winback.inactiveDays} min={7} max={365} disabled={!canEdit} onChange={(v) => set("winback", { inactiveDays: num(v) })} />
        <NumberField id="wb-credits" label="Kredi (1–20)" value={s.winback.credits} min={1} max={20} disabled={!canEdit} onChange={(v) => set("winback", { credits: num(v) })} />
        <NumberField id="wb-cooldown" label="Yeniden alabilmesi için gün (30–365)" value={s.winback.cooldownDays} min={30} max={365} disabled={!canEdit} onChange={(v) => set("winback", { cooldownDays: num(v) })} />
        <NumberField id="wb-cap" label="Günde en çok kişi (1–2000)" value={s.winback.dailyCap} min={1} max={2000} disabled={!canEdit} onChange={(v) => set("winback", { dailyCap: num(v) })} />
        <MessageFields id="winback" value={s.winback.message} disabled={!canEdit} onChange={(m) => set("winback", { message: m })} placeholder={`Hesabına ${s.winback.credits} hediye kredi ekledik; yeni bir tasarım dene.`} />
      </RuleCard>

      {canEdit && (
        <Card>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <Field label="Değişiklik gerekçesi" htmlFor="loyalty-reason" hint="Denetim kaydına yazılır (en az 3 karakter).">
                <Input id="loyalty-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Örn. geri dönüş hediyesini kış için açtık" />
              </Field>
            </div>
            <Button variant="primary" loading={busy === "save"} disabled={!dirty || reason.trim().length < 3 || busy !== null} onClick={() => void save()}>
              <Save className="h-4 w-4" aria-hidden /> Kaydet
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {dirty ? "Kaydedilmemiş değişiklik var." : "Değişiklik yok."}
            {state.updatedAt ? ` Son kayıt: ${fmtDateTime(state.updatedAt)}${state.updatedBy ? ` · ${state.updatedBy}` : ""}.` : " Henüz kaydedilmedi; hepsi kapalı."}
          </p>
        </Card>
      )}

      <Card title="Günlük iş">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">
            Yıldönümü ve geri dönüş hediyeleri her gün saat 11.00’de (İstanbul) verilir.{" "}
            {state.lastRun
              ? `Son çalışma: ${fmtDateTime(state.lastRun.at)} · ${state.lastRun.status === "ok" ? `yıldönümü ${String(state.lastRun.details.anniversary ?? 0)}, geri dönüş ${String(state.lastRun.details.winback ?? 0)} kişi` : "hata"}.`
              : "Henüz çalışmadı."}
          </p>
          {canEdit && (
            <Button variant="secondary" loading={busy === "run"} disabled={busy !== null || dirty || (!state.settings.anniversary.enabled && !state.settings.winback.enabled)} onClick={() => void runNow()}>
              <Play className="h-4 w-4" aria-hidden /> Şimdi ver
            </Button>
          )}
        </div>
        {dirty && canEdit && <p className="mt-2 text-xs text-muted-foreground">Önce değişiklikleri kaydet.</p>}
      </Card>
    </div>
  );
}

function RuleCard({
  icon,
  title,
  hint,
  enabled,
  saved,
  canEdit,
  onToggle,
  stats,
  today,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  enabled: boolean;
  saved: boolean;
  canEdit: boolean;
  onToggle: (v: boolean) => void;
  stats: { last30: number; credits30: number; total: number };
  today?: string;
  children: ReactNode;
}) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {icon} {title} {enabled !== saved && <Badge tone="warn">Kaydedilmedi</Badge>}
        </span>
      }
      actions={
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <span className={enabled ? "text-fg" : "text-muted-foreground"}>{enabled ? "Açık" : "Kapalı"}</span>
          <input type="checkbox" role="switch" aria-label={`${title}: ${enabled ? "açık" : "kapalı"}`} checked={enabled} disabled={!canEdit} onChange={(e) => onToggle(e.target.checked)} className="h-5 w-5 accent-[var(--primary)]" />
        </label>
      }
    >
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{children}</div>
      <p className="mt-3 text-xs text-muted-foreground">
        Son 30 gün: {fmtInt(stats.last30)} kişi, {fmtInt(stats.credits30)} kredi · toplam {fmtInt(stats.total)} hediye.{today ? ` ${today}` : ""}
      </p>
    </Card>
  );
}

function NumberField({ id, label, value, min, max, disabled, onChange }: { id: string; label: string; value: number; min: number; max: number; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <Field label={label} htmlFor={id}>
      <Input id={id} type="number" inputMode="numeric" min={min} max={max} value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function MessageFields({ id, value, disabled, onChange, placeholder }: { id: string; value: LoyaltyMessage; disabled: boolean; onChange: (m: LoyaltyMessage) => void; placeholder: string }) {
  return (
    <>
      <Field label="Bildirim metni (Türkçe, isteğe bağlı)" htmlFor={`${id}-tr`} hint="Boşsa hazır metin gider.">
        <Input id={`${id}-tr`} value={value.tr} maxLength={140} disabled={disabled} onChange={(e) => onChange({ ...value, tr: e.target.value })} placeholder={placeholder} />
      </Field>
      <Field label="Bildirim metni (İngilizce)" htmlFor={`${id}-en`} hint="Diğer diller bunu görür.">
        <Input id={`${id}-en`} value={value.en} maxLength={140} disabled={disabled} onChange={(e) => onChange({ ...value, en: e.target.value })} placeholder="Leave empty for the default text" />
      </Field>
    </>
  );
}

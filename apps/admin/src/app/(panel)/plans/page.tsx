"use client";

import { Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Button, Card, ErrorState, Field, Input, PageHeader, Spinner, Textarea } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { AdminMe, PlanCatalog, PlanCatalogState, PlanCycleId } from "@/lib/types";

// Planlar ve paketler (API.md §7.21, §7.50): ödeme ekranında ve web'in Fiyatlar sayfasında ne görüneceği, kredi
// paketinin kaç hak verdiği. Ücreti mağaza alır ve uygulama mağazanın yerel fiyatını gösterir; buradaki web fiyatı
// yalnız sitede bilgi olarak görünür. Değişiklik gerekçe ister ve denetlenir.

const CYCLES: { id: PlanCycleId; label: string }[] = [
  { id: "weekly", label: "Haftalık" },
  { id: "monthly", label: "Aylık" },
  { id: "yearly", label: "Yıllık" },
];
const MAX_PACKS = 6;
const MAX_FEATURES = 8;

type DraftCycle = { cycle: PlanCycleId; active: boolean; highlight: boolean; ios: string; android: string; price: string; badgeTr: string; badgeEn: string };
type DraftPack = { uid: string; saved: boolean; key: string; nameTr: string; nameEn: string; credits: string; ios: string; android: string; highlight: boolean; active: boolean; price: string };
const WEB = (process.env.NEXT_PUBLIC_WEB_URL ?? "https://casalume.app").replace(/\/$/, "");
type Draft = { nameTr: string; nameEn: string; taglineTr: string; taglineEn: string; featuresTr: string; featuresEn: string; cycles: DraftCycle[]; packs: DraftPack[] };

let uidSeq = 0;
const uid = () => `p${++uidSeq}`;

function toDraft(c: PlanCatalog): Draft {
  return {
    nameTr: c.plan.nameTr,
    nameEn: c.plan.nameEn,
    taglineTr: c.plan.taglineTr,
    taglineEn: c.plan.taglineEn,
    featuresTr: c.plan.featuresTr.join("\n"),
    featuresEn: c.plan.featuresEn.join("\n"),
    cycles: CYCLES.map(({ id }) => {
      const cy = c.plan.cycles.find((x) => x.cycle === id);
      return {
        cycle: id,
        active: cy?.active ?? false,
        highlight: cy?.highlight ?? false,
        ios: cy?.iosProductId ?? "",
        android: cy?.androidProductId ?? "",
        price: cy?.webPriceTRY != null ? String(cy.webPriceTRY) : "",
        badgeTr: cy?.badgeTr ?? "",
        badgeEn: cy?.badgeEn ?? "",
      };
    }),
    packs: c.packs.map((p) => ({ uid: uid(), saved: true, key: p.key, nameTr: p.nameTr, nameEn: p.nameEn, credits: String(p.credits), ios: p.iosProductId ?? "", android: p.androidProductId ?? "", highlight: p.highlight, active: p.active, price: p.webPriceTRY != null ? String(p.webPriceTRY) : "" })),
  };
}

const orNull = (v: string) => v.trim() || null;
/** "349,99" or "349.99" → 349.99; empty → null (a bad number is left for the server to refuse). */
const price = (v: string) => (v.trim() ? Number(v.trim().replace(",", ".")) : null);
const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);

function fromDraft(d: Draft): PlanCatalog {
  return {
    plan: {
      nameTr: d.nameTr.trim(),
      nameEn: d.nameEn.trim(),
      taglineTr: d.taglineTr.trim(),
      taglineEn: d.taglineEn.trim(),
      featuresTr: lines(d.featuresTr),
      featuresEn: lines(d.featuresEn),
      // All three periods are always sent: a period off sale is kept as inactive (an empty list means "never set up").
      cycles: d.cycles.map((c) => ({
        cycle: c.cycle,
        active: c.active,
        highlight: c.highlight,
        iosProductId: orNull(c.ios),
        androidProductId: orNull(c.android),
        webPriceTRY: price(c.price),
        badgeTr: c.badgeTr.trim(),
        badgeEn: c.badgeEn.trim(),
      })),
    },
    packs: d.packs.map((p) => ({
      key: p.key.trim(),
      nameTr: p.nameTr.trim(),
      nameEn: p.nameEn.trim(),
      credits: Number(p.credits),
      iosProductId: orNull(p.ios),
      androidProductId: orNull(p.android),
      highlight: p.highlight,
      active: p.active,
      webPriceTRY: price(p.price),
    })),
  };
}

export default function PlansPage() {
  const state = useApi<PlanCatalogState>("/billing/catalog");
  const me = useApi<AdminMe>("/me");
  const s = state.data;
  return (
    <>
      <PageHeader
        title="Planlar ve paketler"
        description="Uygulamanın ödeme ekranında ve web'in Fiyatlar sayfasında görünen Pro planı, abonelik dönemleri ve kredi paketleri. Ücreti mağaza alır; web fiyatı yalnız sitede bilgi olarak görünür."
        actions={
          <a href={`${WEB}/tr/fiyatlar`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
            Sitedeki Fiyatlar sayfası ↗
          </a>
        }
      />
      {state.error && !s ? (
        <ErrorState message={state.error.message} onRetry={state.reload} />
      ) : !s || !me.data ? (
        <Spinner />
      ) : (
        <Editor key={s.version ?? "default"} state={s} canEdit={["ADMIN", "SUPER_ADMIN"].includes(me.data.role)} onSaved={state.setData} onReload={state.reload} />
      )}
    </>
  );
}

function Editor({ state, canEdit, onSaved, onReload }: { state: PlanCatalogState; canEdit: boolean; onSaved: (u: (p: PlanCatalogState | null) => PlanCatalogState) => void; onReload: () => void }) {
  const { toast, confirm } = useFeedback();
  const [draft, setDraft] = useState<Draft>(() => toDraft(state.catalog));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const next = useMemo(() => fromDraft(draft), [draft]);
  // Compared in the editor's own form, so a stored catalog with fewer periods does not count as changed.
  const baseline = useMemo(() => JSON.stringify(fromDraft(toDraft(state.catalog))), [state.catalog]);
  const dirty = JSON.stringify(next) !== baseline;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setCycle = (i: number, patch: Partial<DraftCycle>) =>
    setDraft((d) => ({ ...d, cycles: d.cycles.map((c, j) => (j === i ? { ...c, ...patch } : patch.highlight ? { ...c, highlight: false } : c)) }));
  const setPack = (u: string, patch: Partial<DraftPack>) =>
    setDraft((d) => ({ ...d, packs: d.packs.map((p) => (p.uid === u ? { ...p, ...patch } : patch.highlight ? { ...p, highlight: false } : p)) }));
  const addPack = () =>
    setDraft((d) => {
      let n = d.packs.length + 1;
      while (d.packs.some((p) => p.key === `pack_${n}`)) n++;
      return { ...d, packs: [...d.packs, { uid: uid(), saved: false, key: `pack_${n}`, nameTr: "", nameEn: "", credits: "10", ios: "", android: "", highlight: false, active: false, price: "" }] };
    });

  async function save() {
    const bad = [...draft.cycles.map((c) => c.price), ...draft.packs.map((p) => p.price)].find((v) => v.trim() && !(Number(v.trim().replace(",", ".")) > 0));
    if (bad !== undefined) {
      toast("error", `“${bad}” geçerli bir fiyat değil; 349,99 gibi yaz.`);
      return;
    }
    const removed = state.catalog.packs.filter((p) => !next.packs.some((x) => x.key === p.key));
    const changedCredits = next.packs.filter((p) => state.catalog.packs.some((x) => x.key === p.key && x.credits !== p.credits));
    if (removed.length || changedCredits.length) {
      const parts = [
        ...changedCredits.map((p) => `“${p.nameTr || p.key}” artık ${fmtInt(p.credits)} hak verecek.`),
        ...removed.map((p) => `“${p.nameTr || p.key}” katalogdan çıkacak; önceden yapılmış satın almalar yine ${fmtInt(p.credits)} hak verir.`),
      ];
      if (!(await confirm({ title: "Kredi paketleri değişiyor", description: parts.join(" "), confirmLabel: "Kaydet" }))) return;
    }
    setSaving(true);
    try {
      const saved = await api<PlanCatalogState>("/billing/catalog", { method: "PATCH", body: { catalog: next, reason: reason.trim(), version: state.version } });
      setReason("");
      onSaved(() => saved);
      toast("success", "Katalog kaydedildi; ödeme ekranı birkaç saniye içinde güncellenir.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (await confirm({ title: "Katalog bu arada değişti", description: "Başka biri kaydetmiş. Güncel hâli yüklensin mi? Buradaki değişikliklerin kaybolur.", confirmLabel: "Yükle" })) onReload();
      } else toast("error", e instanceof ApiError ? e.message : "Kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  const ro = !canEdit;
  const featureCount = (v: string) => lines(v).length;
  return (
    <div className="flex flex-col gap-4">
      {!state.saved && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
          Katalog henüz kaydedilmedi: dönemler, web fiyatları ve kredi paketleri sunucudaki varsayılandan geliyor. İlk kayıttan sonra buradan yönetilir.
        </p>
      )}
      {ro && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted-foreground">Görüntüleme yetkin var; değiştirmek için yönetici rolü gerekir.</p>}

      <Card title="Pro plan">
        <fieldset disabled={ro} className="grid gap-4 md:grid-cols-2">
          <Field label="Ad (Türkçe)" htmlFor="p-name-tr">
            <Input id="p-name-tr" value={draft.nameTr} maxLength={40} onChange={(e) => set("nameTr", e.target.value)} />
          </Field>
          <Field label="Ad (İngilizce)" htmlFor="p-name-en">
            <Input id="p-name-en" value={draft.nameEn} maxLength={40} onChange={(e) => set("nameEn", e.target.value)} />
          </Field>
          <Field label="Kısa açıklama (Türkçe)" htmlFor="p-tag-tr">
            <Input id="p-tag-tr" value={draft.taglineTr} maxLength={120} onChange={(e) => set("taglineTr", e.target.value)} />
          </Field>
          <Field label="Kısa açıklama (İngilizce)" htmlFor="p-tag-en">
            <Input id="p-tag-en" value={draft.taglineEn} maxLength={120} onChange={(e) => set("taglineEn", e.target.value)} />
          </Field>
          <Field label="Özellikler (Türkçe)" htmlFor="p-feat-tr" hint={`Her satır bir madde · ${featureCount(draft.featuresTr)}/${MAX_FEATURES}`}>
            <Textarea id="p-feat-tr" rows={5} value={draft.featuresTr} onChange={(e) => set("featuresTr", e.target.value)} />
          </Field>
          <Field label="Özellikler (İngilizce)" htmlFor="p-feat-en" hint={`Diğer dillerdeki kullanıcılar İngilizcesini görür · ${featureCount(draft.featuresEn)}/${MAX_FEATURES}`}>
            <Textarea id="p-feat-en" rows={5} value={draft.featuresEn} onChange={(e) => set("featuresEn", e.target.value)} />
          </Field>
        </fieldset>
      </Card>

      <Card title="Abonelik dönemleri">
        <fieldset disabled={ro} className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Ürün kimliği App Store Connect ve Google Play Console&apos;daki kimliktir. Satışta olmayan dönem ne ödeme ekranında ne sitede görünür. Pro erişimi her dönemde aynıdır.
            Web fiyatı sitedeki plan kartında yazar; mağazadaki fiyatla aynı tut (satıştaki dönem için zorunlu). Rozet boş kalabilir; varsayılan rozetler diğer dillere çevrilmiş görünür, yazdığın rozet diğer dillerde İngilizcesiyle çıkar.
          </p>
          {draft.cycles.map((c, i) => {
            const label = CYCLES.find((x) => x.id === c.cycle)!.label;
            const missingPrice = c.active && price(c.price) === null;
            return (
              <div key={c.cycle} className="grid gap-3 rounded-lg border border-line p-3">
                <div className="grid items-end gap-3 md:grid-cols-[8rem_1fr_1fr_9rem]">
                  <div>
                    <p className="text-sm font-medium text-fg">{label}</p>
                    <label className="mt-1 flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={c.active} onChange={(e) => setCycle(i, { active: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" /> Satışta
                    </label>
                  </div>
                  <Field label="iOS ürün kimliği" htmlFor={`c-ios-${c.cycle}`}>
                    <Input id={`c-ios-${c.cycle}`} value={c.ios} maxLength={128} placeholder="casalume_pro_monthly" className="font-mono text-xs" onChange={(e) => setCycle(i, { ios: e.target.value })} />
                  </Field>
                  <Field label="Android ürün kimliği" htmlFor={`c-and-${c.cycle}`}>
                    <Input id={`c-and-${c.cycle}`} value={c.android} maxLength={128} className="font-mono text-xs" onChange={(e) => setCycle(i, { android: e.target.value })} />
                  </Field>
                  <Field label="Web fiyatı (TL)" htmlFor={`c-price-${c.cycle}`}>
                    <Input
                      id={`c-price-${c.cycle}`}
                      value={c.price}
                      inputMode="decimal"
                      placeholder="349,99"
                      aria-invalid={missingPrice}
                      className={missingPrice ? "border-danger" : undefined}
                      onChange={(e) => setCycle(i, { price: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="grid items-end gap-3 md:grid-cols-[8rem_1fr_1fr_9rem]">
                  <span className="hidden md:block" />
                  <Field label="Rozet (Türkçe)" htmlFor={`c-btr-${c.cycle}`}>
                    <Input id={`c-btr-${c.cycle}`} value={c.badgeTr} maxLength={20} placeholder="POPÜLER" onChange={(e) => setCycle(i, { badgeTr: e.target.value })} />
                  </Field>
                  <Field label="Rozet (İngilizce)" htmlFor={`c-ben-${c.cycle}`}>
                    <Input id={`c-ben-${c.cycle}`} value={c.badgeEn} maxLength={20} placeholder="POPULAR" onChange={(e) => setCycle(i, { badgeEn: e.target.value })} />
                  </Field>
                  <label className="flex h-9 items-center gap-2 text-xs">
                    <input type="radio" name="cycle-highlight" checked={c.highlight} onChange={() => setCycle(i, { highlight: true })} className="h-4 w-4 accent-[var(--primary)]" /> Öne çıkan
                  </label>
                </div>
                {missingPrice && <p className="text-xs text-danger">Satıştaki dönem için web fiyatı gerekli.</p>}
              </div>
            );
          })}
        </fieldset>
      </Card>

      <Card
        title="Kredi paketleri"
        actions={
          canEdit && (
            <Button size="sm" onClick={addPack} disabled={draft.packs.length >= MAX_PACKS}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> Paket ekle
            </Button>
          )
        }
      >
        <fieldset disabled={ro} className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Tek seferlik satın alma; aldığı hak kullanıcının kredisine eklenir. Satıştan kaldırılan ya da silinen paket, önceden yapılmış satın almalara yine hakkını verir.
            {state.retiredProducts > 0 && ` Katalogdan çıkmış ${fmtInt(state.retiredProducts)} ürün bu yüzden hâlâ tanınıyor.`}
          </p>
          {draft.packs.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Kredi paketi yok.</p>}
          {draft.packs.map((p) => (
            <div key={p.uid} className="grid gap-3 rounded-lg border border-line p-3 md:grid-cols-4">
              <Field label="Anahtar" htmlFor={`k-${p.uid}`} hint={p.saved ? "Kaydedildikten sonra değişmez" : "küçük harf, rakam, _"}>
                <Input id={`k-${p.uid}`} value={p.key} maxLength={32} readOnly={p.saved} className="font-mono text-xs" onChange={(e) => setPack(p.uid, { key: e.target.value })} />
              </Field>
              <Field label="Ad (Türkçe)" htmlFor={`ntr-${p.uid}`}>
                <Input id={`ntr-${p.uid}`} value={p.nameTr} maxLength={40} onChange={(e) => setPack(p.uid, { nameTr: e.target.value })} />
              </Field>
              <Field label="Ad (İngilizce)" htmlFor={`nen-${p.uid}`}>
                <Input id={`nen-${p.uid}`} value={p.nameEn} maxLength={40} onChange={(e) => setPack(p.uid, { nameEn: e.target.value })} />
              </Field>
              <Field label="Verdiği hak" htmlFor={`cr-${p.uid}`}>
                <Input id={`cr-${p.uid}`} type="number" min={1} max={10000} value={p.credits} onChange={(e) => setPack(p.uid, { credits: e.target.value })} />
              </Field>
              <Field label="iOS ürün kimliği" htmlFor={`pi-${p.uid}`}>
                <Input id={`pi-${p.uid}`} value={p.ios} maxLength={128} className="font-mono text-xs" onChange={(e) => setPack(p.uid, { ios: e.target.value })} />
              </Field>
              <Field label="Android ürün kimliği" htmlFor={`pa-${p.uid}`}>
                <Input id={`pa-${p.uid}`} value={p.android} maxLength={128} className="font-mono text-xs" onChange={(e) => setPack(p.uid, { android: e.target.value })} />
              </Field>
              <Field label="Web fiyatı (TL)" htmlFor={`pp-${p.uid}`} hint="İsteğe bağlı; boşsa sitede “uygulamada” yazar">
                <Input id={`pp-${p.uid}`} value={p.price} inputMode="decimal" placeholder="99,99" onChange={(e) => setPack(p.uid, { price: e.target.value })} />
              </Field>
              <span className="hidden md:block" />
              <div className="flex flex-wrap items-center gap-4 text-xs md:col-span-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={p.active} onChange={(e) => setPack(p.uid, { active: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" /> Satışta
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="pack-highlight" checked={p.highlight} onChange={() => setPack(p.uid, { highlight: true })} className="h-4 w-4 accent-[var(--primary)]" /> Öne çıkan
                </label>
                {canEdit && (
                  <Button size="sm" variant="ghost" className="ml-auto text-danger" onClick={() => setDraft((d) => ({ ...d, packs: d.packs.filter((x) => x.uid !== p.uid) }))}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden /> Kaldır
                  </Button>
                )}
              </div>
            </div>
          ))}
        </fieldset>
      </Card>

      <Card title="Günlük sınırlar">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <p>
            <span className="font-medium">Ücretsiz:</span> günde {fmtInt(state.limits.free.dailyGenerations)} tasarım, tek seferde {fmtInt(state.limits.free.maxVariants)} seçenek
          </p>
          <p>
            <span className="font-medium">Pro:</span> günde {fmtInt(state.limits.pro.dailyGenerations)} tasarım, tek seferde {fmtInt(state.limits.pro.maxVariants)} seçenek
          </p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Ödeme ekranı bu sayıları da gösterir. Değiştirmek için{" "}
          <Link href="/settings" className="text-primary hover:underline">
            Ayarlar
          </Link>
          .
        </p>
      </Card>

      {canEdit && (
        <Card>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <Field label="Değişiklik gerekçesi" htmlFor="plans-reason" hint="Denetim kaydına yazılır (en az 3 karakter).">
                <Input id="plans-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Örn. yıllık plan satışa açıldı" />
              </Field>
            </div>
            <Button variant="primary" onClick={save} loading={saving} disabled={!dirty || reason.trim().length < 3}>
              <Save className="h-4 w-4" aria-hidden /> Kaydet
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {dirty ? "Kaydedilmemiş değişiklik var." : "Değişiklik yok."}
            {state.updatedAt && ` Son kayıt: ${fmtDateTime(state.updatedAt)}${state.updatedBy ? ` · ${state.updatedBy}` : ""}.`}
          </p>
        </Card>
      )}
    </div>
  );
}

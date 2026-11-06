"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/common";
import { useApi } from "@/lib/api";
import type { AdminMe } from "@/lib/types";

// Dışa aktarma (API.md §7.44): iş tabloları CSV olarak (Excel'de Türkçe karakterler doğru görünür). Kullanıcılar
// e-postayla değil kimlikle yer alır; denetim kaydı yalnız SUPER_ADMIN içindir. Her dışa aktarma denetlenir.

const KINDS = [
  { id: "billing-events", label: "Ödeme olayları (RevenueCat)", hint: "Tarih, olay türü, ürün, tutar, mağaza, ortam, durum, kullanıcı kimliği." },
  { id: "subscriptions", label: "Abonelikler", hint: "Aralıkta güncellenen abonelikler: ürün, mağaza, durum, bitiş." },
  { id: "ai-costs", label: "AI maliyeti (günlük)", hint: "Gün × sağlayıcı × iş türü: çağrı, görsel, USD." },
  { id: "partners", label: "Ortaklar raporu", hint: "Tüm zamanlar: ziyaret, kayıt, ödeyen, net gelir, komisyon (aralık kullanılmaz)." },
  { id: "audit", label: "Denetim kaydı (yalnız SUPER_ADMIN)", hint: "Kim, ne zaman, ne yaptı, gerekçe; IP yalnız ilk kısmıyla." },
  { id: "waitlist", label: "Bekleme listesi (yalnız SUPER_ADMIN)", hint: "Onaylı adresler, onay tarihine göre: e-posta, dil, telefon, izin metni sürümü." },
] as const;

const day = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);

export default function ExportsPage() {
  const me = useApi<AdminMe>("/me");
  const { toast } = useFeedback();
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("billing-events");
  // Lazy initialisers: the default range (last 30 days) is computed once, not on every render.
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(() => day(new Date()));
  const [busy, setBusy] = useState(false);
  const isSuper = me.data?.role === "SUPER_ADMIN";
  const k = KINDS.find((x) => x.id === kind)!;

  async function download() {
    setBusy(true);
    try {
      const qs = kind === "partners" ? "" : `?from=${from}&to=${to}`;
      const res = await fetch(`/api/admin/exports/${kind}${qs}`, { cache: "no-store", credentials: "same-origin" });
      const text = await res.text();
      if (!res.ok) {
        let message = "Dışa aktarılamadı.";
        try {
          message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
        } catch {
          /* not JSON */
        }
        throw new Error(message);
      }
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `casalume-${kind}${kind === "partners" ? "" : `-${from}_${to}`}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast("success", res.headers.get("x-export-truncated") ? "İndirildi (ilk 50 000 satır; aralığı daralt)." : "İndirildi.");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Dışa aktarma (CSV)" description="İş tablolarını CSV olarak indir. Kullanıcılar e-postayla değil kimlikle yer alır. Her dışa aktarma denetim kaydına girer." />
      <Card>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Ne" htmlFor="ex-kind" hint={k.hint}>
            <Select id="ex-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {KINDS.filter((x) => (x.id !== "audit" && x.id !== "waitlist") || isSuper).map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Başlangıç" htmlFor="ex-from">
            <Input id="ex-from" type="date" value={from} disabled={kind === "partners"} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Bitiş (dahil)" htmlFor="ex-to" hint="En çok 366 gün, 50 000 satır.">
            <Input id="ex-to" type="date" value={to} disabled={kind === "partners"} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Button variant="primary" className="mt-4" loading={busy} onClick={() => void download()}>
          <Download className="h-4 w-4" aria-hidden /> CSV indir
        </Button>
      </Card>
    </>
  );
}

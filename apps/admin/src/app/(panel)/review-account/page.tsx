"use client";

import { Copy, KeyRound, Power, TabletSmartphone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Spinner } from "@/components/common";
import { api, ApiError, useApi } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { ReviewAccountStatus } from "@/lib/types";

// Mağaza inceleme hesabı (API.md §7.40): App Store ve Google Play incelemecileri için süreli giriş. Parola sunucuda
// üretilir ve yalnız bir kez gösterilir; süre bitince giriş reddedilir. Yeni dönem yeni parola demektir. ADMIN ve üstü.

export default function ReviewAccountPage() {
  const state = useApi<ReviewAccountStatus>("/review-account");
  const s = state.data;
  return (
    <>
      <PageHeader
        title="Mağaza inceleme hesabı"
        description="App Store ve Google Play incelemecilerinin uygulamaya girebilmesi için süreli bir hesap. Burada parola üret, App Store Connect ve Play Console'a yapıştır; inceleme bitince kapat."
      />
      {state.error && !s ? (
        <ErrorState message={state.error.message} onRetry={state.reload} />
      ) : !s ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <StatusCard s={s} onChanged={state.reload} />
          <IssueCard exists={s.exists} onIssued={state.reload} />
        </div>
      )}
    </>
  );
}

function StatusCard({ s, onChanged }: { s: ReviewAccountStatus; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);

  async function close() {
    const ok = await confirm({ title: "İnceleme dönemi bitirilsin mi?", description: "Hesaba giriş hemen reddedilir ve açık oturumlar kapanır. Yeni inceleme için yeniden parola üretirsin.", confirmLabel: "Bitir", destructive: true });
    if (!ok) return;
    const reason = window.prompt("Neden? (denetim kaydına yazılır)");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await api("/review-account/close", { method: "POST", body: { reason: reason.trim() } });
      toast("success", "İnceleme dönemi bitti.");
      onChanged();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Yapılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={<span className="flex items-center gap-2"><TabletSmartphone className="h-4 w-4" aria-hidden /> Durum</span>}>
      <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">Giriş e-postası</dt>
        <dd className="flex items-center gap-2 font-mono text-xs">
          {s.email}
          <button type="button" className="text-muted-foreground hover:text-fg" aria-label="E-postayı kopyala" onClick={() => void navigator.clipboard.writeText(s.email).then(() => toast("success", "Kopyalandı."))}>
            <Copy className="h-3.5 w-3.5" aria-hidden />
          </button>
        </dd>
        <dt className="text-muted-foreground">Durum</dt>
        <dd>{!s.exists ? <Badge tone="neutral">Henüz yok</Badge> : s.active ? <Badge tone="good">Açık</Badge> : <Badge tone="neutral">Kapalı</Badge>}</dd>
        {s.exists && (
          <>
            <dt className="text-muted-foreground">Geçerlilik</dt>
            <dd>{s.reviewUntil ? fmtDateTime(s.reviewUntil) : "—"}</dd>
            <dt className="text-muted-foreground">Kredi / tasarım</dt>
            <dd className="tabular-nums">{fmtInt(s.credits)} kredi · {fmtInt(s.designs)} tasarım</dd>
            <dt className="text-muted-foreground">Son giriş</dt>
            <dd className="text-xs">{s.lastLogin ? `${fmtDateTime(s.lastLogin.at)} · ${s.lastLogin.ok ? "başarılı" : "başarısız"} · ${s.lastLogin.device} · ${s.lastLogin.ipPrefix}` : "Henüz giriş yok"}</dd>
            <dt className="text-muted-foreground">Açık oturum</dt>
            <dd className="tabular-nums">{fmtInt(s.openSessions)}</dd>
          </>
        )}
      </dl>
      {s.exists && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/users/${s.id}`} className="text-sm text-primary hover:underline">Kullanıcı ayrıntısı, oturumlar ve tasarımlar →</Link>
          {s.active && (
            <Button size="sm" variant="danger" loading={busy} onClick={() => void close()} className="ml-auto">
              <Power className="h-3.5 w-3.5" aria-hidden /> Şimdi bitir
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function IssueCard({ exists, onIssued }: { exists: boolean; onIssued: () => void }) {
  const { toast, confirm } = useFeedback();
  const [days, setDays] = useState("14");
  const [credits, setCredits] = useState("50");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ email: string; password: string; reviewUntil: string } | null>(null);
  const d = Number(days);
  const c = Number(credits);
  const valid = Number.isInteger(d) && d >= 1 && d <= 30 && Number.isInteger(c) && c >= 0 && c <= 200 && reason.trim().length >= 3;

  async function issue() {
    if (exists) {
      const ok = await confirm({ title: "Yeni inceleme dönemi", description: "Yeni bir parola üretilir; eski parola ve hesaptaki açık oturumlar geçersiz olur. Mağazalardaki inceleme notunu da yeni parolayla güncellemen gerekir.", confirmLabel: "Yeni parola üret" });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const out = await api<{ email: string; password: string; reviewUntil: string }>("/review-account", { method: "POST", body: { days: d, credits: c, reason: reason.trim() } });
      setIssued(out);
      setReason("");
      onIssued();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Üretilemedi.");
    } finally {
      setBusy(false);
    }
  }

  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast("success", "Kopyalandı."));

  return (
    <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4" aria-hidden /> {exists ? "Yeni inceleme dönemi" : "İnceleme hesabı oluştur"}</span>}>
      {issued ? (
        <div className="grid gap-3">
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-fg">Parola yalnız şimdi görünüyor. Kopyala ve mağazalara yapıştır; sayfadan çıkınca bir daha gösterilmez.</p>
          <dl className="grid grid-cols-[6rem_1fr_auto] items-center gap-2 text-sm">
            <dt className="text-muted-foreground">E-posta</dt>
            <dd className="font-mono text-xs">{issued.email}</dd>
            <Button size="sm" variant="ghost" onClick={() => copy(issued.email)}><Copy className="h-3.5 w-3.5" aria-hidden /></Button>
            <dt className="text-muted-foreground">Parola</dt>
            <dd className="font-mono text-sm tracking-wide">{issued.password}</dd>
            <Button size="sm" variant="ghost" onClick={() => copy(issued.password)}><Copy className="h-3.5 w-3.5" aria-hidden /></Button>
            <dt className="text-muted-foreground">Geçerli</dt>
            <dd className="col-span-2 text-xs">{fmtDateTime(issued.reviewUntil)} tarihine kadar</dd>
          </dl>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            <li>App Store Connect → Uygulama → App Review Information → <b>Sign-in required</b>: e-posta ve parola.</li>
            <li>Google Play Console → Uygulama içeriği → <b>Uygulama erişimi</b>: aynı bilgiler.</li>
            <li>Not alanına: “E-posta ve şifre ile giriş yapın; hesapta PRO ve kredi tanımlıdır.”</li>
          </ul>
          <Button variant="secondary" onClick={() => setIssued(null)} className="justify-self-start">Kapat</Button>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Süre (gün, 1–30)" htmlFor="ra-days" hint="İnceleme genelde 1–3 gün sürer; ret ve yeniden gönderim için pay bırak.">
              <Input id="ra-days" type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            <Field label="Kredi (0–200)" htmlFor="ra-credits" hint="PRO süre boyunca açık; kredi tasarım denemeleri için.">
              <Input id="ra-credits" type="number" min={0} max={200} value={credits} onChange={(e) => setCredits(e.target.value)} />
            </Field>
          </div>
          <Field label="Gerekçe" htmlFor="ra-reason" hint="Denetim kaydına yazılır (parola yazılmaz).">
            <Input id="ra-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Örn. iOS 1.0.0 ilk gönderim" />
          </Field>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void issue()} className="justify-self-start">
            {exists ? "Yeni parola üret" : "Hesabı oluştur"}
          </Button>
        </div>
      )}
    </Card>
  );
}

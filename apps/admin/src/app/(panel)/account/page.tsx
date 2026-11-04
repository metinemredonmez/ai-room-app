"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Copy, Download, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { useState } from "react";
import { ErrorState, PageHeader, Spinner } from "@/components/common";
import { useFeedback } from "@/components/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { api, ApiError, useApi } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/format";
import type { AdminMe } from "@/lib/types";

export default function AccountPage() {
  const me = useApi<AdminMe>("/me");

  return (
    <>
      <PageHeader title="Hesabım" description="Profil, rol ve iki adımlı doğrulama" />
      {me.error && !me.data ? (
        <ErrorState message={me.error.message} onRetry={me.reload} />
      ) : !me.data ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Profil</CardTitle>
              <CardDescription>Ad ve e-posta mobil uygulamadaki hesabınla aynıdır.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[8rem_1fr] gap-y-3 text-sm">
                <dt className="text-muted-foreground">Ad</dt>
                <dd className="font-medium">{me.data.name ?? "—"}</dd>
                <dt className="text-muted-foreground">E-posta</dt>
                <dd className="font-medium break-all">{me.data.email}</dd>
                <dt className="text-muted-foreground">Rol</dt>
                <dd>
                  <Badge>{ROLE_LABELS[me.data.role]}</Badge>
                </dd>
              </dl>
            </CardContent>
          </Card>
          <SecurityCard me={me.data} onChanged={me.reload} />
        </div>
      )}
    </>
  );
}

function SecurityCard({ me, onChanged }: { me: AdminMe; onChanged: () => void }) {
  const { toast } = useFeedback();
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  async function regenerate() {
    setBusy(true);
    try {
      const res = await api<{ backupCodes: string[] }>("/me/backup-codes", { method: "POST", body: { otp } });
      setCodes(res.backupCodes);
      setOtp("");
      onChanged();
      toast("success", "Yeni yedek kodlar oluşturuldu; eskileri artık geçersiz.");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "İşlem başarısız.");
      setOtp("");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const text = `Casalume yönetim paneli yedek kodları (${me.email})\nHer kod bir kez kullanılabilir.\n\n${codes!.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "casalume-yonetim-yedek-kodlar.txt" });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>İki adımlı doğrulama</CardTitle>
        <CardDescription>Telefonun yanında değilken giriş için tek kullanımlık yedek kodlar.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {me.mfa.enrolled ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-good">
              <ShieldCheck className="size-4" aria-hidden /> Doğrulayıcı kurulu
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-medium text-danger">
              <ShieldOff className="size-4" aria-hidden /> Doğrulayıcı kurulu değil
            </span>
          )}
          {me.mfa.enrolled && <span className="text-muted-foreground">· {me.mfa.backupCodesRemaining} yedek kod kaldı</span>}
        </div>

        {!me.mfa.required && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            Bu ortamda doğrulama kodu kapalı (geliştirme ayarı). Canlı ortamda girişte kod istenir.
          </p>
        )}

        {codes ? (
          <div className="grid gap-3">
            <p className="text-sm font-medium">Yeni yedek kodların. Bir kez gösterilir; güvenli bir yere kaydet.</p>
            <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-muted p-3 font-mono text-sm">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => toast("success", "Kodlar kopyalandı."))}
              >
                <Copy aria-hidden /> Kopyala
              </Button>
              <Button variant="outline" size="sm" onClick={download}>
                <Download aria-hidden /> İndir (.txt)
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCodes(null)}>
                Kaydettim, kapat
              </Button>
            </div>
          </div>
        ) : me.mfa.enrolled ? (
          <div className="grid gap-2">
            <Label htmlFor="stepup">Yedek kodları yenilemek için güncel doğrulama kodu</Label>
            <InputOTP id="stepup" maxLength={6} pattern={REGEXP_ONLY_DIGITS} value={otp} onChange={setOtp}>
              <InputOTPGroup>
                {[0, 1, 2].map((i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                {[3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <p className="text-xs text-muted-foreground">Eski yedek kodların hepsi geçersiz olur.</p>
            <div>
              <Button onClick={regenerate} disabled={busy || otp.length !== 6} className="mt-1">
                <KeyRound aria-hidden /> Yedek kodları yenile
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

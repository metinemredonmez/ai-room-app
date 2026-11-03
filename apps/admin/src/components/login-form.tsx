"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";

/** Only same-app relative paths are allowed as post-login targets (no open redirect). */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || raw.startsWith("/api")) return "/";
  return raw;
}

export function LoginForm({ expired, next }: { expired: boolean; next: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(otp)) {
      setError("Doğrulama kodu 6 haneli olmalı.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, otp }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(data?.error?.message ?? "Giriş yapılamadı.");
        setOtp("");
        return;
      }
      window.location.assign(safeNext(next));
    } catch {
      setError("Sunucuya ulaşılamadı. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-fg">AI</span>
          <h1 className="text-xl font-semibold text-fg">AI Room Admin</h1>
          <p className="text-sm text-muted">Yönetim paneline giriş</p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5" noValidate>
          {expired && !error && (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="status">
              Oturumun sona erdi. Lütfen tekrar giriş yap.
            </p>
          )}
          {error && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <Field label="E-posta" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Parola" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Doğrulama kodu (TOTP)" htmlFor="otp" hint="Kimlik doğrulayıcı uygulamandaki 6 haneli kod.">
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="tracking-[0.4em]"
            />
          </Field>
          <Button type="submit" variant="primary" loading={loading} className="mt-1">
            <KeyRound className="h-4 w-4" aria-hidden /> Giriş yap
          </Button>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Yönetici girişi iki aşamalı doğrulama gerektirir.
          </p>
        </form>
      </div>
    </main>
  );
}

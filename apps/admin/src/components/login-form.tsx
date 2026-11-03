"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import {
  Coins,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Scale,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";

/** Only same-app relative paths are allowed as post-login targets (no open redirect). */
function safeNext(raw: string | null): string {
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.startsWith("/\\") ||
    raw.startsWith("/api")
  )
    return "/";
  return raw;
}

const FEATURES = [
  { icon: Sparkles, text: "Tasarım moderasyonu ve içerik bildirimleri" },
  { icon: Coins, text: "AI maliyeti ve günlük bütçe" },
  { icon: Scale, text: "KVKK başvuruları ve yasal metinler" },
  { icon: ShieldCheck, text: "İki aşamalı doğrulama ve denetim kaydı" },
];

export function LoginForm({
  expired,
  next,
  mfa,
}: {
  expired: boolean;
  next: string | null;
  mfa: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (mfa && !/^\d{6}$/.test(otp)) {
      setError("Doğrulama kodu 6 haneli olmalı.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mfa ? { email, password, otp } : { email, password },
        ),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
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
    <main className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />

      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Logo />
            <span className="font-semibold">AI Room</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">
            Tekrar hoş geldin
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Yönetim paneline giriş yap.
          </p>

          <form
            ref={formRef}
            onSubmit={onSubmit}
            className="mt-8 flex flex-col gap-5"
            noValidate
          >
            {expired && !error && (
              <p
                className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn"
                role="status"
              >
                Oturumun sona erdi. Lütfen tekrar giriş yap.
              </p>
            )}
            {error && (
              <p
                className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
                role="alert"
              >
                {error}
              </p>
            )}

            <div className="grid gap-2">
              <Label htmlFor="email">E-posta</Label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="ad@airoom.app"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 pl-9"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">Parola</Label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 pr-10 pl-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={
                    showPassword ? "Parolayı gizle" : "Parolayı göster"
                  }
                  aria-pressed={showPassword}
                  className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
            </div>

            {mfa && (
              <div className="grid gap-2">
                <Label htmlFor="otp">Doğrulama kodu</Label>
                <InputOTP
                  id="otp"
                  maxLength={6}
                  pattern={REGEXP_ONLY_DIGITS}
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={setOtp}
                  onComplete={() => {
                    if (email && password) formRef.current?.requestSubmit();
                  }}
                  containerClassName="justify-between"
                >
                  <InputOTPGroup>
                    {[0, 1, 2].map((i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="size-12 text-lg"
                      />
                    ))}
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    {[3, 4, 5].map((i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="size-12 text-lg"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
                <p className="text-xs text-muted-foreground">
                  Doğrulayıcı uygulamandaki 6 haneli kod.
                </p>
              </div>
            )}

            <Button type="submit" size="lg" disabled={loading} className="h-11">
              {loading ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : null}
              {loading ? "Giriş yapılıyor…" : "Giriş yap"}
            </Button>
          </form>

          <p className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden /> Yalnız yetkili ekip
            içindir; her işlem denetim kaydına girer.
          </p>
        </div>
      </section>
    </main>
  );
}

function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`flex size-9 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground ${className}`}
    >
      AI
    </span>
  );
}

/** Fixed deep-emerald panel (same in light and dark) with a line drawing of a room. */
function BrandPanel() {
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#0f3d33] p-10 text-white lg:flex xl:p-14">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 85% 10%, rgba(224,122,79,0.35), transparent 70%), radial-gradient(70% 60% at 10% 100%, rgba(63,178,143,0.45), transparent 70%)",
        }}
      />
      <div className="relative flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-white/15 text-sm font-bold ring-1 ring-white/25 backdrop-blur">
          AI
        </span>
        <span className="font-semibold">AI Room</span>
      </div>

      <RoomDrawing />

      <div className="relative max-w-md">
        <h2 className="text-3xl leading-tight font-semibold tracking-tight xl:text-4xl">
          Odaları yapay zekâ tasarlar, gerisi burada yönetilir.
        </h2>
        <ul className="mt-8 flex flex-col gap-3.5">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li
              key={text}
              className="flex items-center gap-3 text-sm text-white/85"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                <Icon className="size-4" aria-hidden />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-white/60">
        © {new Date().getFullYear()} AI Room · Yönetim paneli
      </p>
    </aside>
  );
}

function RoomDrawing() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 300"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="relative mx-auto h-auto max-h-[34vh] w-full max-w-md text-white/30"
    >
      {/* floor and wall */}
      <path d="M10 230 H390" />
      {/* window */}
      <rect x="230" y="40" width="110" height="120" rx="6" />
      <path d="M285 40 V160 M230 100 H340" />
      {/* sofa */}
      <path d="M60 230 V190 a14 14 0 0 1 14 -14 H196 a14 14 0 0 1 14 14 V230" />
      <path d="M78 176 V150 a12 12 0 0 1 12 -12 H180 a12 12 0 0 1 12 12 V176" />
      <path d="M60 205 H210 M135 205 V176" />
      {/* lamp */}
      <path d="M260 230 V178 M244 178 H276 L268 150 H252 Z" />
      {/* plant */}
      <path d="M340 230 l-6 -26 h28 l-6 26 z" />
      <path d="M348 204 C340 186 330 180 322 176 M348 204 C350 184 358 172 368 166 M348 204 C348 190 346 176 342 164" />
      {/* frame */}
      <rect x="90" y="70" width="70" height="46" rx="3" />
      <path d="M98 108 l16 -18 12 12 8 -8 18 14" />
    </svg>
  );
}

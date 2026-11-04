"use client";

import Link from "@/components/locale-link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Crown, LogOut, Menu, Sparkles, User as UserIcon, X } from "lucide-react";
import { formatDate } from "@/lib/format";
import { splitLocale, fmt } from "@/lib/i18n";
import { useApp } from "./app-provider";
import { Logo } from "./logo";
import { btn } from "./ui";
import { LanguagePicker } from "./language-picker";
import { PalettePicker } from "./palette-picker";

function CreditsPill() {
  const { user, t, locale } = useApp();
  if (!user) return null;
  if (user.plan === "PRO") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent"
        title={user.planExpiresAt ? fmt(t.credits.proUntil, { date: formatDate(user.planExpiresAt, locale) }) : undefined}
      >
        <Crown className="h-3.5 w-3.5" aria-hidden /> {t.credits.pro}
      </span>
    );
  }
  return (
    <Link
      href="/fiyatlar"
      className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-medium text-primary hover:brightness-95"
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      {fmt(t.credits.pill, { free: user.dailyFreeRemaining, credits: user.credits })}
    </Link>
  );
}

/** Static shell shown while the pathname-dependent header streams in. */
export function HeaderFallback() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Logo />
      </div>
    </header>
  );
}

export function SiteHeader() {
  const { t, user, logout, href } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const links = [
    { href: "/studio", label: t.nav.studio },
    { href: "/tasarimlarim", label: t.nav.designs },
    { href: "/sohbet", label: t.nav.chat },
    { href: "/fiyatlar", label: t.nav.pricing },
  ];

  const path = splitLocale(pathname).path;
  const isActive = (to: string) => path === to || path.startsWith(`${to}/`);
  const signedIn = user && !user.isGuest;

  async function onLogout() {
    await logout();
    setOpen(false);
    router.push(href("/"));
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Logo />
        <nav className="ml-6 hidden items-center gap-1 lg:flex" aria-label="Ana menü">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium transition ${
                isActive(l.href) ? "bg-surface text-text shadow-card" : "text-muted hover:text-text"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block">
            <CreditsPill />
          </div>
          <PalettePicker />
          <LanguagePicker />
          {signedIn ? (
            <div className="hidden items-center gap-1 lg:flex">
              <span className="inline-flex max-w-40 items-center gap-1.5 truncate px-2 text-sm text-muted">
                <UserIcon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{user.name || user.email}</span>
              </span>
              <button type="button" onClick={onLogout} className={`${btn.base} ${btn.subtle} ${btn.sm}`}>
                <LogOut className="h-4 w-4" aria-hidden /> {t.nav.logout}
              </button>
            </div>
          ) : (
            <Link href="/giris" className={`${btn.base} ${btn.ghost} ${btn.sm} hidden lg:inline-flex`}>
              {t.nav.login}
            </Link>
          )}
          <Link href="/studio" className={`${btn.base} ${btn.primary} ${btn.sm} hidden lg:inline-flex`}>
            {t.nav.tryFree}
          </Link>
          <button
            type="button"
            className={`${btn.base} ${btn.ghost} ${btn.icon} lg:hidden`}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={t.nav.menu}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-bg px-4 pb-5 pt-3 lg:hidden">
          <div className="mb-3">
            <CreditsPill />
          </div>
          <nav className="flex flex-col gap-1" aria-label="Mobil menü">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`rounded-2xl px-4 py-3 text-base font-medium ${isActive(l.href) ? "bg-surface" : ""}`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex gap-2">
            {signedIn ? (
              <button type="button" onClick={onLogout} className={`${btn.base} ${btn.ghost} ${btn.md} flex-1`}>
                <LogOut className="h-4 w-4" aria-hidden /> {t.nav.logout}
              </button>
            ) : (
              <Link href="/giris" onClick={() => setOpen(false)} className={`${btn.base} ${btn.ghost} ${btn.md} flex-1`}>
                {t.nav.login}
              </Link>
            )}
            <Link href="/studio" onClick={() => setOpen(false)} className={`${btn.base} ${btn.primary} ${btn.md} flex-1`}>
              {t.nav.tryFree}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

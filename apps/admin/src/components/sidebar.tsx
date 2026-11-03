"use client";

import { Activity, Coins, CreditCard, Flag, LayoutDashboard, ListChecks, LogOut, Menu, Palette, ScrollText, SlidersHorizontal, Sparkles, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "Gösterge paneli", icon: LayoutDashboard },
  { href: "/users", label: "Kullanıcılar", icon: Users },
  { href: "/designs", label: "Tasarımlar", icon: Sparkles },
  { href: "/styles", label: "Stiller", icon: Palette },
  { href: "/reports", label: "İçerik bildirimleri", icon: Flag },
  { href: "/ai-costs", label: "AI maliyeti", icon: Coins },
  { href: "/billing", label: "Ödeme olayları", icon: CreditCard },
  { href: "/settings", label: "Ayarlar", icon: SlidersHorizontal },
  { href: "/jobs", label: "Zamanlı işler", icon: ListChecks },
  { href: "/audit", label: "Denetim kaydı", icon: ScrollText },
  { href: "/system", label: "Sistem", icon: Activity },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<{ email: string | null; name: string | null } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => setProfile(p))
      .catch(() => setProfile(null));
  }, []);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5" aria-label="Ana menü">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
              active ? "bg-primary-soft font-medium text-primary" : "text-fg hover:bg-surface-2"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-line pt-3">
      <p className="truncate px-3 text-sm font-medium text-fg">{profile?.name ?? "Yönetici"}</p>
      <p className="truncate px-3 text-xs text-muted">{profile?.email ?? "—"}</p>
      <button
        type="button"
        onClick={logout}
        disabled={loggingOut}
        className="mt-2 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg hover:bg-surface-2 disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" aria-hidden /> Çıkış yap
      </button>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-2 px-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-fg">AI</span>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-fg">AI Room</p>
        <p className="text-xs text-muted">Yönetim paneli</p>
      </div>
    </div>
  );

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-2.5 lg:hidden">
        {brand}
        <button
          type="button"
          aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2 text-fg hover:bg-surface-2"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col gap-5 border-r border-line bg-surface py-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="hidden lg:block">{brand}</div>
        <div className="flex flex-1 flex-col px-2">{nav}</div>
        <div className="px-2">{footer}</div>
      </aside>
    </>
  );
}

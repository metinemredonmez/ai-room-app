"use client";

import Link from "@/components/locale-link";
import { useApp } from "./app-provider";
import { Logo } from "./logo";

export function SiteFooter() {
  const { t } = useApp();
  const cols = [
    {
      title: t.footer.product,
      links: [
        { href: "/studio", label: t.nav.studio },
        { href: "/sohbet", label: t.nav.chat },
        { href: "/fiyatlar", label: t.nav.pricing },
        { href: "/blog", label: t.nav.blog },
      ],
    },
    {
      title: t.footer.company,
      links: [
        { href: "/#nasil", label: t.footer.about },
        { href: "/destek", label: t.footer.support },
        { href: "mailto:support@casalume.app", label: t.footer.contact },
      ],
    },
    {
      title: t.footer.legal,
      links: [
        { href: "/yasal/kvkk", label: t.footer.kvkk },
        { href: "/yasal/kosullar", label: t.footer.terms },
        { href: "/yasal/yapay-zeka", label: t.footer.aiConsent },
        { href: "/hesap-silme", label: t.footer.deleteAccount },
      ],
    },
  ];
  return (
    <footer className="mt-24 border-t border-border bg-surface/50">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted">{t.brandTagline}</p>
          <p className="mt-4 max-w-xs text-xs text-muted">{t.footer.note}</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h3 className="text-sm font-medium text-text">{c.title}</h3>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-sm text-muted hover:text-text">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border py-5 text-center text-xs text-muted">
        © 2026 Casalume · {t.footer.rights}
      </div>
    </footer>
  );
}

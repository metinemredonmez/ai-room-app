"use client";

import Link from "next/link";
import { BeforeAfter } from "@/components/before-after";
import { LogoMark } from "@/components/logo";
import { useApp } from "@/components/app-provider";
import { fmt } from "@/lib/i18n";

// Public before/after share page (API.md §7.23 client sharing). No account: the API answers the token,
// the counter ticks server-side. An expired or revoked token renders the invalid state, not a broken page.

export function ShareView({ shared, appUrl }: { shared: { title: string; views: number; before: { url: string }; after: { url: string } | null } | null; appUrl: string }) {
  const { t } = useApp();
  void appUrl;

  if (!shared || !shared.after) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
        <LogoMark className="h-10" />
        <h1 className="mt-6 font-display text-2xl font-light">{t.share.expiredTitle}</h1>
        <p className="mt-2 text-sm text-muted">{t.share.expiredText}</p>
        <Link href="/" className="mt-6 text-sm font-medium text-primary hover:underline">
          {t.share.cta}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <LogoMark className="h-8" />
        <span className="text-xs text-muted">{fmt(t.share.views, { n: shared.views })}</span>
      </header>
      <h1 className="mt-6 font-display text-3xl font-light sm:text-4xl">{shared.title}</h1>
      <p className="mt-2 text-sm text-muted">{t.share.subtitle}</p>
      <div className="mt-6">
        <BeforeAfter
          before={shared.before.url}
          after={shared.after.url}
          beforeLabel={t.result.before}
          afterLabel={t.result.after}
          sliderLabel={t.result.sliderLabel}
        />
      </div>
      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm text-muted">{t.share.footer}</p>
        <Link href="/" className="text-sm font-medium text-primary hover:underline">
          {t.share.cta}
        </Link>
      </footer>
    </div>
  );
}

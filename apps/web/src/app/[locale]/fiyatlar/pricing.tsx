"use client";

import { useState } from "react";
import { CircleCheck, Coins, FlaskConical, LoaderCircle, Smartphone } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { formatDate, formatTRY } from "@/lib/format";
import type { User } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { ErrorNotice } from "@/components/error-notice";
import Link from "@/components/locale-link";
import { PlanCards } from "@/components/landing";
import { StoreLinks } from "@/components/store-links";
import { btn, card } from "@/components/ui";
import { fmt } from "@/lib/i18n";
import type { WaitlistStatus } from "@/lib/waitlist";

/** The demo PRO switch exists only on a development backend; a production build never shows it. */
const DEMO = process.env.NODE_ENV === "development";

export function Pricing({ waitlist }: { waitlist: WaitlistStatus }) {
  const { t, locale, catalog, catalogError, reloadCatalog, user, ensureSession, setUser } = useApp();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const live = Boolean(waitlist.stores.ios || waitlist.stores.android);
  const packs = catalog?.pricing?.packs ?? [];

  async function devUpgrade() {
    setBusy(true);
    setError(null);
    try {
      await ensureSession();
      const updated = await api.post<User>("/billing/dev-upgrade");
      setUser(updated);
      setDone(true);
    } catch (e) {
      setError(
        e instanceof ApiError && (e.status === 403 || e.status === 404)
          ? new ApiError(e.status, "forbidden", t.pricing.demoUnavailable)
          : e,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-display font-light sm:text-6xl">{t.pricing.title}</h1>
        <p className="mt-3 text-muted">{t.pricing.subtitle}</p>
        {user?.plan === "PRO" && user.planExpiresAt && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent-soft px-4 py-2 text-sm font-medium text-accent">
            <CircleCheck className="h-4 w-4" aria-hidden /> {fmt(t.credits.proUntil, { date: formatDate(user.planExpiresAt, locale) })}
          </p>
        )}
      </div>

      <div className="mt-12">
        {catalog ? (
          <PlanCards
            plans={catalog.plans}
            pricing={catalog.pricing}
            footer={() =>
              user?.plan === "PRO" ? (
                <p className="mt-6 text-sm font-medium text-primary">{t.pricing.current}</p>
              ) : (
                <a href="#abonelik" className={`${btn.base} ${btn.primary} ${btn.md} mt-6`}>
                  {t.pricing.subscribe}
                </a>
              )
            }
          />
        ) : catalogError ? (
          <ErrorNotice error={catalogError} onRetry={reloadCatalog} />
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-72 animate-pulse rounded-3xl bg-surface-2" />
            ))}
          </div>
        )}
      </div>

      <section id="abonelik" className={`${card} mx-auto mt-12 max-w-3xl scroll-mt-24 p-6 sm:p-8`}>
        <h2 className="flex items-center gap-2 text-xl font-medium">
          <Smartphone className="h-5 w-5 text-primary" aria-hidden /> {t.pricing.storeTitle}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t.pricing.storeText}</p>
        <div className="mt-5">
          <StoreLinks stores={waitlist.stores} />
        </div>
        {!live && (
          <p className="mt-4 text-sm text-muted">
            {t.pricing.storeSoon}{" "}
            {waitlist.enabled && (
              <Link href="/#uygulama" className="font-medium text-primary hover:underline">
                {t.pricing.joinWaitlist}
              </Link>
            )}
          </p>
        )}
      </section>

      {packs.length > 0 && (
        <section className="mx-auto mt-12 max-w-3xl">
          <h2 className="flex items-center gap-2 text-xl font-medium">
            <Coins className="h-5 w-5 text-accent" aria-hidden /> {t.pricing.packsTitle}
          </h2>
          <p className="mt-1 text-sm text-muted">{t.pricing.packsText}</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {packs.map((p) => (
              <div key={p.key} className={`${card} p-5 ${p.highlight ? "ring-2 ring-primary" : ""}`}>
                <p className="font-medium">{p.name}</p>
                {p.name !== fmt(t.pricing.credits, { n: p.credits }) && <p className="mt-1 text-sm text-muted">{fmt(t.pricing.credits, { n: p.credits })}</p>}
                <p className="mt-3 text-2xl font-display font-light">
                  {p.priceTRY != null ? formatTRY(p.priceTRY, locale) : <span className="text-base text-muted">{t.pricing.inApp}</span>}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {DEMO && (
        <div id="demo" className={`${card} mx-auto mt-12 max-w-2xl scroll-mt-24 p-6`}>
          <h2 className="flex items-center gap-2 font-medium">
            <FlaskConical className="h-5 w-5 text-accent" aria-hidden /> {t.pricing.demoTitle}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t.pricing.demoText}</p>
          <div className="mt-4 space-y-3">
            {error ? <ErrorNotice error={error} /> : null}
            {done ? (
              <p className="flex items-center gap-2 text-sm font-medium text-primary">
                <CircleCheck className="h-4 w-4" aria-hidden /> {t.pricing.demoDone}
              </p>
            ) : (
              <button type="button" onClick={devUpgrade} disabled={busy} className={`${btn.base} ${btn.accent} ${btn.md}`}>
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t.pricing.demoButton}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import {
  ArrowRight,
  Calculator,
  Check,
  Crown,
  House,
  Layers,
  MessageCircleMore,
  Palette,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { formatTRY } from "@/lib/format";
import type { Plan } from "@/lib/types";
import { useApp } from "./app-provider";
import { HeroShowcase } from "./room-illustration";
import { btn, card } from "./ui";

const FEATURE_ICONS = [Sparkles, Palette, Calculator, ShoppingBag, MessageCircleMore, House, ShieldCheck, Layers];

export function PlanCards({ plans, footer }: { plans: Plan[]; footer?: (p: Plan) => React.ReactNode }) {
  const { t, locale, user } = useApp();
  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
      <div className={`${card} flex flex-col p-6`}>
        <h3 className="text-lg font-bold">{t.pricing.free}</h3>
        <p className="mt-3 text-3xl font-extrabold">{t.pricing.freePrice}</p>
        <ul className="mt-5 flex-1 space-y-2.5 text-sm">
          {t.pricing.freeFeatures.map((f) => (
            <li key={f} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> {f}
            </li>
          ))}
        </ul>
        {user && user.plan === "FREE" && <p className="mt-5 text-sm font-semibold text-primary">{t.pricing.current}</p>}
      </div>
      {plans.map((p) => (
        <div key={p.id} className={`${card} relative flex flex-col p-6 ${p.badge ? "ring-2 ring-primary" : ""}`}>
          {p.badge && (
            <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">{p.badge}</span>
          )}
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Crown className="h-4 w-4 text-accent" aria-hidden /> {p.name}
          </h3>
          <p className="mt-3 text-3xl font-extrabold">
            {formatTRY(p.priceTRY, locale)}
            <span className="ml-1 text-sm font-medium text-muted">{t.pricing.perPeriod(t.pricing.period[p.period])}</span>
          </p>
          <ul className="mt-5 flex-1 space-y-2.5 text-sm">
            {t.pricing.proFeatures.map((f) => (
              <li key={f} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> {f}
              </li>
            ))}
          </ul>
          {footer?.(p)}
        </div>
      ))}
    </div>
  );
}

export function Landing() {
  const { t, catalog } = useApp();
  const L = t.landing;

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--accent-soft), transparent 70%)" }}
        />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div className="animate-float-in">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> {L.badge}
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">{L.heroTitle}</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{L.heroText}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/studio" className={`${btn.base} ${btn.primary} ${btn.lg}`}>
                {L.ctaPrimary} <ArrowRight className="h-5 w-5" aria-hidden />
              </Link>
              <a href="#nasil" className={`${btn.base} ${btn.ghost} ${btn.lg}`}>
                {L.ctaSecondary}
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              {L.trust.map((x) => (
                <li key={x} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" aria-hidden /> {x}
                </li>
              ))}
            </ul>
          </div>
          <HeroShowcase beforeLabel={L.before} afterLabel={L.after} />
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{L.featuresTitle}</h2>
          <p className="mt-3 text-muted">{L.featuresText}</p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {L.features.map((f, i) => {
            const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
            const highlight = i === 1 || i === 2 || i === 3;
            return (
              <div key={f.title} className={`${card} p-6 transition hover:-translate-y-0.5`}>
                <span
                  className={`grid h-11 w-11 place-items-center rounded-2xl ${highlight ? "bg-accent-soft text-accent" : "bg-primary-soft text-primary"}`}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-4 font-bold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.text}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section id="nasil" className="scroll-mt-20 bg-surface/60 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{L.howTitle}</h2>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {L.how.map((s, i) => (
              <li key={s.title} className={`${card} p-6`}>
                <span className="text-5xl font-extrabold text-primary/25">0{i + 1}</span>
                <h3 className="mt-2 text-lg font-bold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Styles */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{L.stylesTitle}</h2>
        <p className="mt-3 text-muted">{L.stylesText}</p>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {catalog
            ? catalog.styles.map((s) => (
                <Link
                  key={s.id}
                  href={`/studio?style=${encodeURIComponent(s.id)}`}
                  className="group overflow-hidden rounded-3xl border border-border bg-surface shadow-card transition hover:-translate-y-0.5"
                >
                  <div className="flex h-24">
                    {(s.palette.length ? s.palette : ["#ddd"]).slice(0, 4).map((c, i) => (
                      <span key={`${c}-${i}`} className="flex-1" style={{ background: /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ddd" }} />
                    ))}
                  </div>
                  <div className="p-3.5">
                    <p className="flex items-center gap-1.5 font-semibold">
                      {s.name}
                      {s.isPro && <Crown className="h-3.5 w-3.5 text-accent" aria-label="PRO" />}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{s.description}</p>
                  </div>
                </Link>
              ))
            : Array.from({ length: 10 }, (_, i) => <div key={i} className="h-40 animate-pulse rounded-3xl bg-surface-2" />)}
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{L.pricingTitle}</h2>
        <p className="mt-3 text-muted">{L.pricingText}</p>
        <div className="mt-10">
          {catalog ? (
            <PlanCards
              plans={catalog.plans}
              footer={() => (
                <Link href="/fiyatlar" className={`${btn.base} ${btn.primary} ${btn.md} mt-6`}>
                  {t.pricing.choose}
                </Link>
              )}
            />
          ) : (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-72 animate-pulse rounded-3xl bg-surface-2" />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* FAQ */}
      <section id="sss" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{L.faqTitle}</h2>
        <div className="mt-8 space-y-3">
          {L.faq.map((f) => (
            <details key={f.q} className={`${card} group p-5`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {f.q}
                <span className="text-xl text-muted transition group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-[2rem] bg-primary px-6 py-14 text-center text-white sm:px-12">
          <div
            className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full opacity-40 blur-2xl"
            style={{ background: "var(--accent)" }}
          />
          <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-4xl">{L.finalTitle}</h2>
          <Link
            href="/studio"
            className={`${btn.base} ${btn.lg} relative mt-8 bg-white text-primary hover:bg-white/90`}
          >
            {L.finalCta} <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}

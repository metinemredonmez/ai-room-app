"use client";

import Link from "@/components/locale-link";
import {
  ArrowRight,
  Calculator,
  Check,
  Crown,
  House,
  Layers,
  MessageCircleMore,
  Palette,
  Ruler,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { formatTRY } from "@/lib/format";
import type { SiteContent } from "@/lib/site-content";
import type { WaitlistStatus } from "@/lib/waitlist";
import type { Plan } from "@/lib/types";
import { useApp } from "./app-provider";
import { BeforeAfter } from "./before-after";
import { WaitlistForm } from "./waitlist-form";
import { btn, card } from "./ui";
import { fmt } from "@/lib/i18n";

const FEATURE_ICONS = [Sparkles, Palette, Calculator, ShoppingBag, MessageCircleMore, House, ShieldCheck, Layers];

export function PlanCards({ plans, footer }: { plans: Plan[]; footer?: (p: Plan) => React.ReactNode }) {
  const { t, locale, user } = useApp();
  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
      <div className={`${card} flex flex-col p-6`}>
        <h3 className="text-lg font-medium">{t.pricing.free}</h3>
        <p className="mt-3 text-4xl font-display font-light">{t.pricing.freePrice}</p>
        <ul className="mt-5 flex-1 space-y-2.5 text-sm">
          {t.pricing.freeFeatures.map((f) => (
            <li key={f} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> {f}
            </li>
          ))}
        </ul>
        {user && user.plan === "FREE" && <p className="mt-5 text-sm font-medium text-primary">{t.pricing.current}</p>}
      </div>
      {plans.map((p) => (
        <div key={p.id} className={`${card} relative flex flex-col p-6 ${p.badge ? "ring-2 ring-primary" : ""}`}>
          {p.badge && (
            <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-medium text-white">{p.badge}</span>
          )}
          <h3 className="flex items-center gap-2 text-lg font-medium">
            <Crown className="h-4 w-4 text-accent" aria-hidden /> {p.name}
          </h3>
          <p className="mt-3 text-4xl font-display font-light">
            {formatTRY(p.priceTRY, locale)}
            <span className="ml-1 text-sm font-medium text-muted">{fmt(t.pricing.perPeriod, { p: t.pricing.period[p.period] })}</span>
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

/** A real before/after pair from public/landing (Pexels photo → Casalume result). */
const pair = (key: string) => ({ before: `/landing/${key}-once.webp`, after: `/landing/${key}-sonra.webp` });

export function Landing({ content, waitlist }: { content: SiteContent; waitlist: WaitlistStatus }) {
  const { t, catalog } = useApp();
  // Texts changed in the admin replace the built-in translation; hidden sections are left out (API.md §7.46).
  const L = { ...t.landing, ...content.texts };
  const show = content.sections;
  const secondaryHref = show.gallery ? "#ornekler" : show.how ? "#nasil" : null;
  const W = t.waitlist;
  const live = Boolean(waitlist.stores.ios || waitlist.stores.android);
  const showApp = show.app && (waitlist.enabled || live);
  const hero = pair("hero");

  return (
    <div>
      {/* Hero: a real redesigned room fills the background, the live before/after sits on top */}
      <section className="relative isolate overflow-hidden">
        <img src="/landing/salon-sonra.webp" alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-bg via-bg/92 to-bg/55" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div className="animate-float-in">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3.5 py-1.5 text-xs font-medium text-primary backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> {L.badge}
            </span>
            <h1 className="mt-5 text-5xl font-display font-light leading-[1.05] sm:text-6xl lg:text-7xl">{L.heroTitle}</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{L.heroText}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/studio" className={`${btn.base} ${btn.primary} ${btn.lg}`}>
                {L.ctaPrimary} <ArrowRight className="h-5 w-5" aria-hidden />
              </Link>
              {secondaryHref && (
                <a href={secondaryHref} className={`${btn.base} ${btn.ghost} ${btn.lg}`}>
                  {L.ctaSecondary}
                </a>
              )}
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              {L.trust.map((x) => (
                <li key={x} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" aria-hidden /> {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[2rem] bg-surface/70 p-2 shadow-card ring-1 ring-border backdrop-blur">
            <BeforeAfter before={hero.before} after={hero.after} beforeLabel={L.before} afterLabel={L.after} sliderLabel={`${L.before} / ${L.after}`} />
          </div>
        </div>
      </section>

      {/* Real results gallery */}
      {show.gallery && (
        <section id="ornekler" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-4xl font-display font-light sm:text-5xl">{L.galleryTitle}</h2>
            <p className="mt-3 text-muted">{L.galleryText}</p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {L.gallery.map((g) => {
              const p = pair(g.key);
              return (
                <figure key={g.key} className={`${card} overflow-hidden p-2`}>
                  <BeforeAfter before={p.before} after={p.after} beforeLabel={L.before} afterLabel={L.after} sliderLabel={`${g.title}: ${L.before} / ${L.after}`} />
                  <figcaption className="flex items-baseline justify-between gap-3 px-3 pb-2 pt-3">
                    <span className="font-medium">{g.title}</span>
                    <span className="text-sm text-muted">{g.meta}</span>
                  </figcaption>
                </figure>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted">{L.aiNote}</p>
        </section>
      )}

      {/* Tools as photo tiles */}
      {show.tools && (
        <section className="bg-surface-2/60 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <h2 className="text-4xl font-display font-light sm:text-5xl">{L.toolsTitle}</h2>
              <p className="mt-3 text-muted">{L.toolsText}</p>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {L.tools.map((tile) => (
                <Link
                  key={tile.tool}
                  href={`/studio?tool=${tile.tool}`}
                  className="group relative isolate flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-3xl p-5 text-white shadow-card"
                >
                  <img src={`/landing/${tile.key}-sonra.webp`} alt="" loading="lazy" className="absolute inset-0 -z-20 h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                  <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
                  <h3 className="text-lg font-medium">{tile.name}</h3>
                  <p className="mt-1 text-sm text-white/85">{tile.text}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium">
                    {L.ctaPrimary} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              ))}
            </div>
            <p className="mt-6 text-sm text-muted">{L.moreTools}</p>
          </div>
        </section>
      )}

      {/* Features */}
      {show.features && (
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-4xl font-display font-light sm:text-5xl">{L.featuresTitle}</h2>
            <p className="mt-3 text-muted">{L.featuresText}</p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {L.features.map((f, i) => {
              const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
              return (
                <div key={f.title} className={`${card} p-6 transition hover:-translate-y-0.5`}>
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary-soft text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 font-medium">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.text}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* For architects and interior designers */}
      {show.pro && (
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className={`${card} grid overflow-hidden lg:grid-cols-2`}>
            <img src="/landing/yatak-sonra.webp" alt="" loading="lazy" className="h-full min-h-72 w-full object-cover" />
            <div className="p-8 sm:p-12">
              <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
                <Ruler className="h-3.5 w-3.5" aria-hidden /> {L.proBadge}
              </span>
              <h2 className="mt-4 text-4xl font-display font-light">{L.proTitle}</h2>
              <p className="mt-3 leading-relaxed text-muted">{L.proText}</p>
              <ul className="mt-6 space-y-3 text-sm">
                {L.proPoints.map((x) => (
                  <li key={x} className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> {x}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* How it works */}
      {show.how && (
        <section id="nasil" className="scroll-mt-20 bg-surface-2/60 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-4xl font-display font-light sm:text-5xl">{L.howTitle}</h2>
            <ol className="mt-10 grid gap-5 md:grid-cols-3">
              {L.how.map((s, i) => (
                <li key={s.title} className={`${card} p-6`}>
                  <span className="text-6xl font-display font-light text-primary/30">0{i + 1}</span>
                  <h3 className="mt-2 text-lg font-medium">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/* Styles with their real preview photos */}
      {show.styles && (
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-4xl font-display font-light sm:text-5xl">{L.stylesTitle}</h2>
          <p className="mt-3 text-muted">{L.stylesText}</p>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {catalog
              ? catalog.styles.map((s) => (
                  <Link
                    key={s.id}
                    href={`/studio?style=${encodeURIComponent(s.id)}`}
                    className="group overflow-hidden rounded-3xl border border-border bg-surface shadow-card transition hover:-translate-y-0.5"
                  >
                    <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
                      {s.previewUrl ? (
                        <img src={s.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                      ) : (
                        <div className="flex h-full">
                          {(s.palette.length ? s.palette : ["#ddd"]).slice(0, 4).map((c, i) => (
                            <span key={`${c}-${i}`} className="flex-1" style={{ background: /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ddd" }} />
                          ))}
                        </div>
                      )}
                      <div className="absolute bottom-2 left-2 flex gap-1">
                        {s.palette.slice(0, 4).map((c, i) => (
                          <span key={`${c}-${i}`} className="h-3 w-3 rounded-full ring-2 ring-white/80" style={{ background: /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ddd" }} />
                        ))}
                      </div>
                    </div>
                    <div className="p-3.5">
                      <p className="flex items-center gap-1.5 font-medium">
                        {s.name}
                        {s.isPro && <Crown className="h-3.5 w-3.5 text-accent" aria-label="PRO" />}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted">{s.description}</p>
                    </div>
                  </Link>
                ))
              : Array.from({ length: 10 }, (_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-3xl bg-surface-2" />)}
          </div>
        </section>
      )}

      {/* Pricing */}
      {show.pricing && (
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-4xl font-display font-light sm:text-5xl">{L.pricingTitle}</h2>
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
      )}

      {/* Mobile app: store links once they exist, the waiting list until then (API.md §7.47) */}
      {showApp && (
        <section id="uygulama" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-4 pt-16 sm:px-6">
          <div className={`${card} grid gap-8 p-8 sm:p-12 lg:grid-cols-[1fr_1.1fr] lg:items-center`}>
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
                <Smartphone className="h-3.5 w-3.5" aria-hidden /> {W.badge}
              </span>
              <h2 className="mt-4 text-4xl font-display font-light">{W.title}</h2>
              <p className="mt-3 leading-relaxed text-muted">{live ? W.textLive : W.textSoon}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                {([["ios", "App Store"], ["android", "Google Play"]] as const).map(([k, label]) =>
                  waitlist.stores[k] ? (
                    <a key={k} href={waitlist.stores[k]!} target="_blank" rel="noopener noreferrer" className={`${btn.base} ${btn.ghost} ${btn.md}`}>
                      {label} <ArrowRight className="h-4 w-4" aria-hidden />
                    </a>
                  ) : (
                    <span key={k} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted">
                      {label} <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{W.soon}</span>
                    </span>
                  ),
                )}
              </div>
            </div>
            {waitlist.enabled && <WaitlistForm source="home" />}
          </div>
        </section>
      )}

      {/* FAQ */}
      {show.faq && (
        <section id="sss" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16 sm:px-6">
          <h2 className="text-4xl font-display font-light sm:text-5xl">{L.faqTitle}</h2>
          <div className="mt-8 space-y-3">
            {L.faq.map((f) => (
              <details key={f.q} className={`${card} group p-5`}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {f.q}
                  <span className="text-xl text-muted transition group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Final CTA over a real exterior */}
      <section className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
        <div className="relative isolate overflow-hidden rounded-[2rem] px-6 py-20 text-center text-white sm:px-12">
          <img src="/landing/cephe-sonra.webp" alt="" loading="lazy" className="absolute inset-0 -z-20 h-full w-full object-cover" />
          <div className="absolute inset-0 -z-10 bg-black/55" />
          <h2 className="relative text-4xl font-display font-light sm:text-5xl">{L.finalTitle}</h2>
          <Link href="/studio" className={`${btn.base} ${btn.lg} relative mt-8 bg-white text-text hover:bg-white/90`}>
            {L.finalCta} <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}

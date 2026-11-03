"use client";

import { ExternalLink, Hammer, ShoppingBag } from "lucide-react";
import { safeHref } from "@/lib/api";
import { formatRange } from "@/lib/format";
import type { Analysis } from "@/lib/types";
import { useApp } from "./app-provider";

const HEX = /^#[0-9a-fA-F]{6}$/;

export function AnalysisPanel({ analysis }: { analysis: Analysis }) {
  const { t, locale } = useApp();
  const { totals } = analysis;
  return (
    <section className="animate-float-in space-y-6 rounded-3xl border border-border bg-surface p-5 shadow-card sm:p-7" aria-label={t.analysis.title}>
      <div>
        <h3 className="text-lg font-bold">{t.analysis.title}</h3>
        <p className="mt-1 whitespace-pre-line text-sm text-muted">{analysis.summary}</p>
        {analysis.palette.length > 0 && (
          <div className="mt-4 flex items-center gap-2" aria-label={t.analysis.palette}>
            {analysis.palette.filter((c) => HEX.test(c)).map((c) => (
              <span key={c} className="h-7 w-7 rounded-full border border-border" style={{ background: c }} title={c} />
            ))}
          </div>
        )}
      </div>

      {analysis.items.length > 0 && (
        <div>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <ShoppingBag className="h-4 w-4" aria-hidden /> {t.analysis.items}
          </h4>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {analysis.items.map((item, i) => (
              <li key={`${item.name}-${i}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {item.name}
                    {item.quantity > 1 && <span className="ml-2 text-sm font-normal text-muted">× {item.quantity}</span>}
                  </p>
                  <p className="text-sm text-muted">{[item.category, item.material, item.color].filter(Boolean).join(" · ")}</p>
                </div>
                <p className="shrink-0 text-sm font-bold text-primary">{formatRange(item.priceMinTRY, item.priceMaxTRY, locale)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {item.links.map((l) => {
                    const href = safeHref(l.url);
                    return href ? (
                      <a
                        key={l.store + href}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium hover:border-primary hover:text-primary"
                      >
                        {l.store} <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    ) : null;
                  })}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.renovation.length > 0 && (
        <div>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <Hammer className="h-4 w-4" aria-hidden /> {t.analysis.renovation}
          </h4>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {analysis.renovation.map((r, i) => (
              <li key={`${r.task}-${i}`} className="flex items-center gap-3 p-4 text-sm">
                <span className="flex-1 font-medium">{r.task}</span>
                <span className="text-muted">
                  {r.quantity} {r.unit}
                </span>
                <span className="font-bold">{formatRange(r.costMinTRY, r.costMaxTRY, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl bg-primary-soft p-5">
        <h4 className="text-sm font-bold text-primary">{t.analysis.totals}</h4>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">{t.analysis.furniture}</dt>
            <dd className="font-semibold">{formatRange(totals.furnitureMinTRY, totals.furnitureMaxTRY, locale)}</dd>
          </div>
          <div>
            <dt className="text-muted">{t.analysis.renovationTotal}</dt>
            <dd className="font-semibold">{formatRange(totals.renovationMinTRY, totals.renovationMaxTRY, locale)}</dd>
          </div>
          <div>
            <dt className="text-muted">{t.analysis.grand}</dt>
            <dd className="text-lg font-extrabold text-primary">{formatRange(totals.grandMinTRY, totals.grandMaxTRY, locale)}</dd>
          </div>
        </dl>
      </div>
      <p className="text-xs text-muted">{analysis.disclaimer}</p>
    </section>
  );
}

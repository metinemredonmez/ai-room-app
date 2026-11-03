"use client";

// Hand-built SVG charts following the dataviz method: thin marks (≤24px bars, 2px lines),
// 4px rounded data-ends, 2px surface gaps, hairline solid grid, one y-axis, hover + keyboard
// tooltips that only enhance (every chart has a table view), text in ink tokens — never series colour.

import { AlertTriangle, Table2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { fmtCompact, fmtDay, fmtInt } from "@/lib/format";

const AXIS_FONT = 11;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

function niceScale(maxValue: number, ticks = 4, minStep = 1) {
  if (maxValue <= 0) return { max: ticks * minStep, step: minStep };
  const raw = maxValue / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const niceStep = step < minStep ? minStep : step;
  return { max: Math.ceil(maxValue / niceStep) * niceStep, step: niceStep };
}

/** Column path: rounded (r) at the top data-end, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  table: ReactNode;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="rounded-2xl border border-line bg-surface">
      <figcaption className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-fg">{title}</p>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-pressed={showTable}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg"
        >
          <Table2 className="h-3.5 w-3.5" aria-hidden /> {showTable ? "Grafik" : "Tablo"}
        </button>
      </figcaption>
      <div className="p-4">
        {legend && !showTable && <div className="mb-3 flex flex-wrap gap-4 text-xs text-[var(--chart-ink-2)]">{legend}</div>}
        {showTable ? <div className="max-h-80 overflow-auto">{table}</div> : children}
      </div>
    </figure>
  );
}

export function LegendItem({ color, label, icon }: { color: string; label: string; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} aria-hidden />
      {icon}
      {label}
    </span>
  );
}

function Tooltip({ left, top, title, rows }: { left: number; top: number; title: string; rows: { color?: string; value: string; label: string }[] }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-[140px] -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-2 text-xs shadow-lg"
      style={{ left, top }}
    >
      <p className="mb-1 text-[var(--chart-ink-2)]">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2">
          {r.color && <span className="inline-block h-0.5 w-3 rounded" style={{ background: r.color }} aria-hidden />}
          <span className="tabular font-semibold text-fg">{r.value}</span>
          <span className="text-[var(--chart-ink-2)]">{r.label}</span>
        </p>
      ))}
    </div>
  );
}

type DailyDesigns = { date: string; designs: number; failed: number };

const SUCCESS_COLOR = "var(--series-1)";
const FAILED_COLOR = "var(--status-critical)";

export function DailyDesignsChart({ data }: { data: DailyDesigns[] }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = 220;
  const margin = { top: 18, right: 8, bottom: 26, left: 36 };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const n = data.length;
  const { max, step } = niceScale(Math.max(0, ...data.map((d) => d.designs)));
  const band = n ? plotW / n : 0;
  const barW = Math.max(1, Math.min(24, band * 0.7));
  const y = (v: number) => margin.top + plotH - (v / max) * plotH;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const peak = data.reduce((best, d, i) => (d.designs > (data[best]?.designs ?? -1) ? i : best), 0);

  return (
    <ChartCard
      title="Günlük tasarımlar"
      subtitle="Başarılı ve başarısız üretimler, gün bazında"
      legend={
        <>
          <LegendItem color={SUCCESS_COLOR} label="Başarılı" />
          <LegendItem color={FAILED_COLOR} label="Başarısız" icon={<AlertTriangle className="h-3 w-3 text-[var(--status-critical)]" aria-hidden />} />
        </>
      }
      table={
        <table className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-medium">Gün</th>
              <th className="py-1 text-right font-medium">Toplam</th>
              <th className="py-1 text-right font-medium">Başarılı</th>
              <th className="py-1 text-right font-medium">Başarısız</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {data.map((d) => (
              <tr key={d.date} className="border-t border-line">
                <td className="py-1">{fmtDay(d.date, true)}</td>
                <td className="py-1 text-right">{fmtInt(d.designs)}</td>
                <td className="py-1 text-right">{fmtInt(Math.max(0, d.designs - d.failed))}</td>
                <td className="py-1 text-right">{fmtInt(d.failed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && n > 0 && (
          <svg width={width} height={height} role="img" aria-label="Günlük tasarım sayıları sütun grafiği">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={margin.left} x2={width - margin.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} strokeWidth={1} />
                <text x={margin.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={AXIS_FONT} fill="var(--chart-muted)" className="tabular">
                  {fmtCompact(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = margin.left + i * band + (band - barW) / 2;
              const ok = Math.max(0, d.designs - d.failed);
              const okTop = y(ok);
              const okH = margin.top + plotH - okTop;
              const failTop = y(ok + d.failed);
              // 2px surface gap between the two stacked segments.
              const failH = Math.max(0, okTop - failTop - (ok > 0 ? 2 : 0));
              const dim = active !== null && active !== i;
              return (
                <g key={d.date} opacity={dim ? 0.45 : 1}>
                  {ok > 0 && <path d={d.failed > 0 ? `M${x},${okTop}h${barW}v${okH}h${-barW}Z` : columnPath(x, okTop, barW, okH, 4)} fill={SUCCESS_COLOR} />}
                  {d.failed > 0 && <path d={columnPath(x, failTop, barW, failH, 4)} fill={FAILED_COLOR} />}
                </g>
              );
            })}
            {data[peak] && data[peak].designs > 0 && (
              <text
                x={margin.left + peak * band + band / 2}
                y={y(data[peak].designs) - 5}
                textAnchor="middle"
                fontSize={AXIS_FONT}
                fill="var(--chart-ink-2)"
                className="tabular"
              >
                {fmtInt(data[peak].designs)}
              </text>
            )}
            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <text key={`x-${d.date}`} x={margin.left + i * band + band / 2} y={height - 8} textAnchor="middle" fontSize={AXIS_FONT} fill="var(--chart-muted)">
                  {fmtDay(d.date)}
                </text>
              ) : null,
            )}
            {data.map((d, i) => (
              <rect
                key={`hit-${d.date}`}
                x={margin.left + i * band}
                y={margin.top}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${fmtDay(d.date, true)}: ${d.designs} tasarım, ${d.failed} başarısız`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            ))}
          </svg>
        )}
        {active !== null && data[active] && (
          <Tooltip
            left={Math.min(Math.max(margin.left + active * band + band / 2, 80), width - 80)}
            top={Math.max(y(data[active].designs) - 6, 60)}
            title={fmtDay(data[active].date, true)}
            rows={[
              { value: fmtInt(data[active].designs), label: "toplam" },
              { color: SUCCESS_COLOR, value: fmtInt(Math.max(0, data[active].designs - data[active].failed)), label: "başarılı" },
              { color: FAILED_COLOR, value: fmtInt(data[active].failed), label: "başarısız" },
            ]}
          />
        )}
      </div>
    </ChartCard>
  );
}

/** Single-series daily line (change over time): no legend, title names the series; table view + keyboard tooltip. */
export function DailyLineChart({
  title,
  subtitle,
  ariaLabel,
  valueLabel,
  columnLabel,
  data,
  format = fmtInt,
  axisFormat = fmtCompact,
  minStep = 1,
}: {
  title: string;
  subtitle?: string;
  ariaLabel: string;
  valueLabel: string;
  columnLabel: string;
  data: { date: string; value: number }[];
  format?: (v: number) => string;
  axisFormat?: (v: number) => string;
  /** Smallest y-axis step (1 for counts; e.g. 0.01 for currency). */
  minStep?: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = 220;
  const scale = niceScale(Math.max(0, ...data.map((d) => d.value)), 4, minStep);
  // Left margin grows with the longest y-axis label (e.g. "$0.004") so nothing is clipped.
  const longestTick = Math.max(...Array.from({ length: Math.round(scale.max / scale.step) + 1 }, (_, i) => axisFormat(i * scale.step).length));
  const margin = { top: 18, right: 52, bottom: 26, left: Math.max(36, 12 + longestTick * 6.6) };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const n = data.length;
  const { max, step } = scale;
  const x = (i: number) => margin.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => margin.top + plotH - (v / max) * plotH;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.value)}`).join("");
  const area = n ? `${line}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z` : "";
  const last = data[n - 1];

  function pick(clientX: number, rect: DOMRect) {
    if (!n) return;
    const rel = clientX - rect.left - margin.left;
    setActive(Math.max(0, Math.min(n - 1, Math.round(n <= 1 ? 0 : (rel / plotW) * (n - 1)))));
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      table={
        <table className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-medium">Gün</th>
              <th className="py-1 text-right font-medium">{columnLabel}</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {data.map((d) => (
              <tr key={d.date} className="border-t border-line">
                <td className="py-1">{fmtDay(d.date, true)}</td>
                <td className="py-1 text-right">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && n > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel}
            onMouseMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => setActive(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={margin.left} x2={width - margin.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} strokeWidth={1} />
                <text x={margin.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={AXIS_FONT} fill="var(--chart-muted)" className="tabular">
                  {axisFormat(t)}
                </text>
              </g>
            ))}
            <path d={area} fill="var(--series-1)" opacity={0.1} />
            <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <text key={`x-${d.date}`} x={x(i)} y={height - 8} textAnchor="middle" fontSize={AXIS_FONT} fill="var(--chart-muted)">
                  {fmtDay(d.date)}
                </text>
              ) : null,
            )}
            {active !== null && <line x1={x(active)} x2={x(active)} y1={margin.top} y2={margin.top + plotH} stroke="var(--chart-axis)" strokeWidth={1} />}
            {last && (
              <>
                <circle cx={x(n - 1)} cy={y(last.value)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
                <text x={x(n - 1) + 8} y={y(last.value)} dy="0.32em" fontSize={AXIS_FONT} fill="var(--chart-ink-2)" className="tabular">
                  {format(last.value)}
                </text>
              </>
            )}
            {active !== null && active !== n - 1 && data[active] && (
              <circle cx={x(active)} cy={y(data[active].value)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
            )}
            <rect
              x={margin.left}
              y={margin.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              tabIndex={0}
              aria-label="Grafikte gezinmek için sol ve sağ ok tuşlarını kullan"
              onFocus={() => setActive((a) => a ?? n - 1)}
              onBlur={() => setActive(null)}
              onKeyDown={onKey}
            />
          </svg>
        )}
        {active !== null && data[active] && (
          <Tooltip
            left={Math.min(Math.max(x(active), 80), width - 80)}
            top={Math.max(y(data[active].value) - 8, 50)}
            title={fmtDay(data[active].date, true)}
            rows={[{ color: "var(--series-1)", value: format(data[active].value), label: valueLabel }]}
          />
        )}
      </div>
    </ChartCard>
  );
}

export function NewUsersChart({ data }: { data: { date: string; newUsers: number }[] }) {
  return (
    <DailyLineChart
      title="Yeni kullanıcılar"
      subtitle="Günlük yeni kayıt ve misafir hesaplar"
      ariaLabel="Günlük yeni kullanıcı çizgi grafiği"
      valueLabel="yeni kullanıcı"
      columnLabel="Yeni kullanıcı"
      data={data.map((d) => ({ date: d.date, value: d.newUsers }))}
    />
  );
}

/** Horizontal bars for nominal categories: one colour for every bar, value at the tip. */
export function BarList({ title, subtitle, rows }: { title: string; subtitle?: string; rows: { key: string; label: string; value: number }[] }) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...sorted.map((r) => r.value));
  const total = sorted.reduce((s, r) => s + r.value, 0);
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      table={
        <table className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-medium">Ad</th>
              <th className="py-1 text-right font-medium">Adet</th>
              <th className="py-1 text-right font-medium">Pay</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {sorted.map((r) => (
              <tr key={r.key} className="border-t border-line">
                <td className="py-1">{r.label}</td>
                <td className="py-1 text-right">{fmtInt(r.value)}</td>
                <td className="py-1 text-right">{total ? `%${Math.round((r.value / total) * 100)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Bu aralıkta veri yok.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {sorted.map((r) => (
            <li
              key={r.key}
              className="grid grid-cols-[minmax(90px,140px)_1fr] items-center gap-3 rounded-md px-1 py-1 hover:bg-surface-2"
              title={`${r.label}: ${fmtInt(r.value)}`}
            >
              <span className="truncate text-xs text-fg">{r.label}</span>
              <span className="flex items-center gap-2">
                <span
                  className="h-3 rounded-r-[4px]"
                  style={{ width: `max(2px, calc(${(r.value / max) * 100}% - 48px))`, background: "var(--series-1)" }}
                  aria-hidden
                />
                <span className="tabular text-xs text-[var(--chart-ink-2)]">{fmtInt(r.value)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

export function StatTile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-fg">{fmtInt(value)}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </div>
  );
}

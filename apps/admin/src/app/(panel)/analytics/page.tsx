"use client";

import { AlertTriangle, Info } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BarList, DailyLineChart } from "@/components/charts";
import { Card, ErrorState, PageHeader, Spinner, Table, td, th } from "@/components/common";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useApi } from "@/lib/api";
import { fmtDay, fmtInt, toolLabel } from "@/lib/format";
import type { AdminMe, BillingEnv, CohortAnalytics, EngagementAnalytics, RevenueAnalytics } from "@/lib/types";

// Analiz (API.md §7.20): gelir (RevenueCat olayları), etkileşim ve haftalık kohort tutma. Gelir yalnız ADMIN ve üstüne
// açık; SUPPORT/EDITOR etkileşim ve kohortu görür.

type Tab = "revenue" | "engagement" | "cohorts";
const TABS: { id: Tab; label: string; adminOnly?: boolean }[] = [
  { id: "revenue", label: "Gelir", adminOnly: true },
  { id: "engagement", label: "Etkileşim" },
  { id: "cohorts", label: "Kohortlar" },
];
const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd = (v: number) => usdFmt.format(v);
const usdAxis = (v: number) => `$${Number(v.toPrecision(3))}`;
const pct = (v: number | null) => (v === null ? "—" : `%${v.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`);
const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const STORE_LABELS: Record<string, string> = {
  APP_STORE: "App Store",
  MAC_APP_STORE: "Mac App Store",
  PLAY_STORE: "Google Play",
  AMAZON: "Amazon",
  STRIPE: "Stripe",
  PROMOTIONAL: "Promosyon",
};
const AI_LABELS: Record<string, string> = { chat: "Tasarım sohbeti", analyze: "Alışveriş/bütçe analizi", segment: "Nesne seçimi", describe: "Referans stil" };
const STATUS_LABELS: Record<string, string> = { active: "Aktif", cancelled: "İptal edildi (süresi dolana kadar açık)", grace: "Ödeme ek süresinde", billing_issue: "Ödeme sorunu" };

function Range<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={String(value)}
      onValueChange={(v) => {
        const hit = options.find((o) => String(o.value) === v);
        if (hit) onChange(hit.value);
      }}
      aria-label={label}
    >
      {options.map((o) => (
        <ToggleGroupItem key={String(o.value)} value={String(o.value)} className="px-3">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold text-fg">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const Icon = tone === "warn" ? AlertTriangle : Info;
  return (
    <p className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${tone === "warn" ? "bg-warn-soft text-warn" : "bg-surface-2 text-muted-foreground"}`} role="status">
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden /> <span>{children}</span>
    </p>
  );
}

export default function AnalyticsPage() {
  const me = useApi<AdminMe>("/me");
  const isAdmin = me.data ? ADMIN_ROLES.has(me.data.role) : false;
  const tabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab = picked && tabs.some((t) => t.id === picked) ? picked : isAdmin ? "revenue" : "engagement";

  return (
    <>
      <PageHeader
        title="Analiz"
        description="Gelir, etkileşim ve kullanıcıların geri gelip gelmediği. Günler ve haftalar İstanbul saatine göre; yönetici hesapları sayılmaz."
        actions={me.data ? <Range label="Bölüm" value={tab} options={tabs.map((t) => ({ value: t.id, label: t.label }))} onChange={setPicked} /> : undefined}
      />
      {me.error && !me.data ? (
        <ErrorState message={me.error.message} onRetry={me.reload} />
      ) : !me.data ? (
        <Spinner />
      ) : tab === "revenue" ? (
        <RevenueSection />
      ) : tab === "engagement" ? (
        <EngagementSection />
      ) : (
        <CohortSection />
      )}
    </>
  );
}

function RevenueSection() {
  const [days, setDays] = useState(30);
  const [env, setEnv] = useState<BillingEnv>("PRODUCTION");
  const res = useApi<RevenueAnalytics>("/analytics/revenue", { days, env });
  const r = res.data;
  const t = r?.totals;
  const subs = r?.subscriptions;
  const empty = t && !t.grossUsd && !t.refunds && !t.trials && !subs?.active;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Range label="Tarih aralığı" value={days} onChange={setDays} options={[7, 30, 90, 365].map((d) => ({ value: d, label: d === 365 ? "1 yıl" : `${d} gün` }))} />
        <Range
          label="Ortam"
          value={env}
          onChange={setEnv}
          options={[
            { value: "PRODUCTION", label: "Canlı" },
            { value: "SANDBOX", label: "Test (sandbox)" },
          ]}
        />
      </div>
      {res.error && !r ? (
        <ErrorState message={res.error.message} onRetry={res.reload} />
      ) : !r || !t || !subs ? (
        <Spinner />
      ) : (
        <div className={`flex flex-col gap-4 transition-opacity ${res.loading ? "opacity-60" : ""}`}>
          {empty && (
            <Note>
              {env === "PRODUCTION"
                ? "Bu aralıkta canlı mağaza ödemesi yok. Mağaza hesapları ve RevenueCat bağlandıkça satın almalar burada görünür; denemeleri “Test (sandbox)” ile görebilirsin."
                : "Bu aralıkta test (sandbox) ödemesi yok."}
            </Note>
          )}
          {r.truncated && <Note tone="warn">Aralıkta çok fazla olay var; ilk 50.000 olay sayıldı. Daha kısa bir aralık seç.</Note>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Net gelir" value={usd(t.netUsd)} note={`Brüt ${usd(t.grossUsd)} · iade ${usd(t.refundsUsd)}`} />
            <Metric label="Tahmini ele geçen" value={usd(t.proceedsUsd)} note="Mağaza payı ve vergi düşülmüş (olay bildirdiyse)" />
            <Metric label="MRR (aylık yinelenen)" value={usd(subs.mrrUsd)} note={`${fmtInt(subs.renewing)} yenilenecek abonelik${subs.priced < subs.renewing ? ` · ${fmtInt(subs.renewing - subs.priced)} tanesinin fiyatı bilinmiyor` : ""}`} />
            <Metric label="Şu an erişimi olan abone" value={fmtInt(subs.active)} note={`${fmtInt(subs.trials)} deneme · ${fmtInt(subs.byStatus.cancelled ?? 0)} iptal etti`} />
          </div>
          <DailyLineChart
            title="Günlük net gelir"
            subtitle="USD, satın alma − iade; İstanbul saatine göre gün"
            ariaLabel="Günlük net gelir çizgi grafiği"
            valueLabel="USD"
            columnLabel="Net gelir"
            data={r.daily.map((d) => ({ date: d.date, value: d.netUsd }))}
            format={usd}
            axisFormat={usdAxis}
            minStep={0.01}
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Yeni ücretli abonelik" value={fmtInt(t.newSubscriptions)} note={`${fmtInt(t.trials)} deneme başladı`} />
            <Metric label="Denemeden ücretliye geçen" value={fmtInt(t.trialConversions)} note={t.trials ? `Başlayan denemelerin ${pct(share(t.trialConversions, t.trials))}'i (dönemler kayabilir)` : "Bu aralıkta deneme yok"} />
            <Metric label="Yenileme · kredi paketi" value={`${fmtInt(t.renewals)} · ${fmtInt(t.creditPacks)}`} note={t.arppuUsd === null ? "Ödeme yapan yok" : `${fmtInt(t.payers)} ödeyen · kişi başı ${usd(t.arppuUsd)}`} />
            <Metric label="İade · iptal · süresi dolan" value={`${fmtInt(t.refunds)} · ${fmtInt(t.cancellations)} · ${fmtInt(t.expirations)}`} note="İptal: yenilemeyi kapattı, dönem sonuna kadar erişimi sürer" />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="Ürüne göre" className="xl:col-span-2">
              {r.byProduct.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Bu aralıkta satış yok.</p>
              ) : (
                <Table head={<tr><th className={th}>Ürün</th><th className={`${th} text-right`}>Satış</th><th className={`${th} text-right`}>Net gelir</th></tr>}>
                  {r.byProduct.map((p) => (
                    <tr key={p.productId}>
                      <td className={`${td} font-mono text-xs`}>{p.productId}</td>
                      <td className={`${td} text-right tabular`}>{fmtInt(p.purchases)}</td>
                      <td className={`${td} text-right tabular`}>{usd(p.revenueUsd)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            <Card title="Mağaza ve para birimi">
              {r.byStore.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Bu aralıkta satış yok.</p>
              ) : (
                <Table head={<tr><th className={th}>Kaynak</th><th className={`${th} text-right`}>Net</th></tr>}>
                  {r.byStore.map((s) => (
                    <tr key={s.store}>
                      <td className={td}>{STORE_LABELS[s.store] ?? s.store}</td>
                      <td className={`${td} text-right tabular`}>{usd(s.revenueUsd)}</td>
                    </tr>
                  ))}
                  {r.byCurrency.map((c) => (
                    <tr key={c.currency}>
                      <td className={`${td} text-muted-foreground`}>{c.currency} (ödenen para birimi)</td>
                      <td className={`${td} text-right tabular`}>{money(c.amount, c.currency)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>
          {Object.keys(subs.byStatus).length > 0 && (
            <Card title="Aboneliklerin durumu">
              <ul className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                {Object.entries(subs.byStatus).map(([status, n]) => (
                  <li key={status} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                    <span>{STATUS_LABELS[status] ?? status}</span>
                    <span className="tabular font-semibold">{fmtInt(n)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <p className="text-xs text-muted-foreground">
            Tutarlar RevenueCat’in bildirdiği USD fiyatıdır; iade, “müşteri desteği” nedenli iptaldir. MRR her abonenin son ödediği fiyatı aylığa çevirir (yıllık ÷ 12);
            deneme ve iptal edilmiş abonelikler sayılmaz. Kesin muhasebe için mağaza raporlarını kullan.
          </p>
        </div>
      )}
    </div>
  );
}

function EngagementSection() {
  const [days, setDays] = useState(30);
  const res = useApi<EngagementAnalytics>("/analytics/engagement", { days });
  const e = res.data;

  return (
    <div className="flex flex-col gap-4">
      <Range label="Tarih aralığı" value={days} onChange={setDays} options={[7, 30, 90].map((d) => ({ value: d, label: `${d} gün` }))} />
      {res.error && !e ? (
        <ErrorState message={res.error.message} onRetry={res.reload} />
      ) : !e ? (
        <Spinner />
      ) : (
        <div className={`flex flex-col gap-4 transition-opacity ${res.loading ? "opacity-60" : ""}`}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Bugün aktif" value={fmtInt(e.active.today)} note="Tasarım üreten ya da AI özelliği kullanan" />
            <Metric label="Son 7 gün · 30 gün aktif" value={`${fmtInt(e.active.week)} · ${fmtInt(e.active.month)}`} note={`Yapışkanlık (günlük ÷ aylık): ${pct(e.active.stickiness)}`} />
            <Metric label={`Son ${days} günde aktif`} value={fmtInt(e.active.period)} note={`${fmtInt(e.active.returning)} kişi en az 2 farklı gün geldi (${pct(share(e.active.returning, e.active.period))})`} />
            <Metric label="Kişi başı tasarım" value={e.designs.perDesigner === null ? "—" : e.designs.perDesigner.toLocaleString("tr-TR")} note={`${fmtInt(e.designs.designs)} tasarım · ${fmtInt(e.designs.designers)} kişi · favori oranı ${pct(e.designs.favoriteRate)}`} />
          </div>
          <DailyLineChart
            title="Günlük aktif kullanıcı"
            subtitle="O gün tasarım üreten ya da sohbet, analiz, nesne seçimi kullanan kişi"
            ariaLabel="Günlük aktif kullanıcı çizgi grafiği"
            valueLabel="aktif kullanıcı"
            columnLabel="Aktif"
            data={e.daily.map((d) => ({ date: d.date, value: d.activeUsers }))}
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <Funnel days={days} f={e.funnel} />
            <BarList
              title="Özelliklere ulaşan kişi"
              subtitle={`Son ${days} gün, her özelliği en az bir kez kullanan kişi sayısı`}
              rows={e.reach.map((r) => ({ key: `${r.kind}:${r.key}`, label: r.kind === "tool" ? toolLabel(r.key) : (AI_LABELS[r.key] ?? r.key), value: r.users }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Ordered steps, each as a share of the signups (not sorted: the order is the story). */
function Funnel({ days, f }: { days: number; f: EngagementAnalytics["funnel"] }) {
  const steps = [
    { key: "signups", label: "Uygulamayı açtı (hesap oluştu)", value: f.signups },
    { key: "designed", label: "İlk tasarımı istedi", value: f.designed },
    { key: "succeeded", label: "Başarılı sonuç aldı", value: f.succeeded },
    { key: "repeat", label: "3 ya da daha çok tasarım", value: f.repeat },
    { key: "registered", label: "E-postayla kayıt oldu", value: f.registered },
    { key: "paid", label: "Satın alma yaptı", value: f.paid },
  ];
  return (
    <Card title={`Yeni kullanıcı yolculuğu · son ${days} gün`}>
      {f.signups === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Bu aralıkta yeni kullanıcı yok.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {steps.map((s) => {
            const p = share(s.value, f.signups) ?? 0;
            return (
              <li key={s.key} className="grid grid-cols-[minmax(140px,200px)_1fr] items-center gap-3 text-xs" title={`${s.label}: ${fmtInt(s.value)} kişi (${pct(p)})`}>
                <span className="truncate text-fg">{s.label}</span>
                <span className="flex items-center gap-2">
                  <span className="h-3 rounded-r-[4px]" style={{ width: `max(2px, calc(${p}% - 104px))`, background: "var(--series-1)" }} aria-hidden />
                  <span className="tabular whitespace-nowrap text-[var(--chart-ink-2)]">
                    {fmtInt(s.value)} · {pct(p)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Her adım, bu aralıkta hesabı oluşan kişilere oranlanır; kayıt ve satın alma sırası kişiden kişiye değişir.</p>
    </Card>
  );
}

function CohortSection() {
  const [weeks, setWeeks] = useState(8);
  const [segment, setSegment] = useState<CohortAnalytics["segment"]>("all");
  const res = useApi<CohortAnalytics>("/analytics/cohorts", { weeks, segment });
  const c = res.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Range label="Hafta sayısı" value={weeks} onChange={setWeeks} options={[4, 8, 12].map((w) => ({ value: w, label: `${w} hafta` }))} />
        <Range
          label="Kullanıcılar"
          value={segment}
          onChange={setSegment}
          options={[
            { value: "all", label: "Tümü" },
            { value: "registered", label: "Yalnız kayıtlı" },
          ]}
        />
      </div>
      {res.error && !c ? (
        <ErrorState message={res.error.message} onRetry={res.reload} />
      ) : !c ? (
        <Spinner />
      ) : (
        <div className={`flex flex-col gap-4 transition-opacity ${res.loading ? "opacity-60" : ""}`}>
          <Card title="Haftalık tutma">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-separate border-spacing-[2px] text-xs">
                <caption className="sr-only">Hesabın açıldığı haftaya göre, sonraki haftalarda geri gelen kullanıcı yüzdesi</caption>
                <thead className="text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-1 text-left font-medium">Kayıt haftası</th>
                    <th scope="col" className="px-2 py-1 text-right font-medium">Kişi</th>
                    {c.average.map((_, k) => (
                      <th key={k} scope="col" className="px-2 py-1 text-center font-medium">
                        {k === 0 ? "İlk hafta" : `${k}. hafta`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular">
                  {c.rows.map((row) => (
                    <tr key={row.week}>
                      <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-normal text-fg">
                        {fmtDay(row.week)} haftası{row.week === c.currentWeek ? " (bu hafta)" : ""}
                      </th>
                      <td className="px-2 py-1.5 text-right text-fg">{fmtInt(row.size)}</td>
                      {row.retention.map((v, k) => (
                        <HeatCell key={k} value={v} title={v === null ? undefined : `${fmtInt(row.size)} kişiden ${fmtInt(row.active[k])} kişi (${pct(v)})`} />
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" className="px-2 py-1.5 text-left font-medium text-fg">Ortalama</th>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">{fmtInt(c.rows.reduce((s, r) => s + r.size, 0))}</td>
                    {c.average.map((v, k) => (
                      <HeatCell key={k} value={v} strong />
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-xs text-muted-foreground">
            Satır: hesabın açıldığı hafta (pazartesi başlar). Hücre: o haftadan sonraki N. haftada tasarım üreten ya da AI özelliği kullanan kişilerin oranı. “İlk hafta” kayıt
            haftasının kendisidir; bu haftanın sayıları hafta bitene kadar artar. Boş hücre: o hafta henüz gelmedi.
          </p>
        </div>
      )}
    </div>
  );
}

/** Sequential single-hue cell: darker = more of the cohort came back. Text stays in ink tokens. */
function HeatCell({ value, title, strong }: { value: number | null; title?: string; strong?: boolean }) {
  if (value === null) return <td className="rounded-[4px] px-2 py-1.5 text-center text-muted-foreground">·</td>;
  const mix = Math.round(8 + Math.min(100, value) * 0.47); // 8% … 55% of the series colour over the surface
  return (
    <td
      className={`rounded-[4px] px-2 py-1.5 text-center text-fg ${strong ? "font-semibold" : ""}`}
      style={{ background: `color-mix(in oklab, var(--series-1) ${mix}%, var(--card))` }}
      title={title}
    >
      {pct(value)}
    </td>
  );
}

"use client";

import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  Coins,
  CreditCard,
  Crown,
  Flag,
  ListChecks,
  ShieldAlert,
  Sparkles,
  Scale,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { BarList, DailyDesignsChart, NewUsersChart } from "@/components/charts";
import { ErrorState } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useApi } from "@/lib/api";
import { fmtInt, toolLabel } from "@/lib/format";
import type { AdminMe, AdminStats, AdminStyle, AiUsageStats, BillingEvent, ContentReport, JobsOverview, Page } from "@/lib/types";

const RANGES = [
  { days: 7, label: "7 gün" },
  { days: 30, label: "30 gün" },
  { days: 90, label: "90 gün" },
] as const;

type DataRequestCounts = { counts: { open: number; dueSoon: number; overdue: number } };
type Tone = "critical" | "warning" | "info";
type Task = { key: string; tone: Tone; icon: LucideIcon; title: string; detail: string; href?: string };

const TONE_BADGE: Record<Tone, { label: string; className: string }> = {
  critical: { label: "Acil", className: "bg-danger-soft text-danger" },
  warning: { label: "Dikkat", className: "bg-warn-soft text-warn" },
  info: { label: "Bilgi", className: "bg-secondary text-secondary-foreground" },
};
const TONE_ORDER: Record<Tone, number> = { critical: 0, warning: 1, info: 2 };
const usd = (n: number) => `$${n.toFixed(2)}`;

export default function HomePage() {
  const [days, setDays] = useState(30);
  const me = useApi<AdminMe>("/me");
  const stats = useApi<AdminStats>("/stats", { days });
  const styles = useApi<AdminStyle[]>("/styles");
  const ai = useApi<AiUsageStats>("/ai/usage", { days: 7 });
  const reports = useApi<Page<ContentReport>>("/reports", { status: "OPEN", limit: 100 });
  const kvkk = useApi<DataRequestCounts>("/data-requests", { limit: 1 });
  const failedBilling = useApi<Page<BillingEvent>>("/billing/events", { status: "failed", limit: 100 });
  const unmatchedBilling = useApi<Page<BillingEvent>>("/billing/events", { status: "unmatched", limit: 100 });
  const jobs = useApi<JobsOverview>("/jobs");

  const t = stats.data?.totals;
  const tasks = buildTasks({ me: me.data, ai: ai.data, reports: reports.data, kvkk: kvkk.data, failed: failedBilling.data, unmatched: unmatchedBilling.data, jobs: jobs.data });
  const tasksLoading = [me, ai, reports, kvkk, failedBilling, unmatchedBilling, jobs].some((q) => !q.data && !q.error);
  const styleName = (id: string) => styles.data?.find((s) => s.id === id)?.nameTr ?? id;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{me.data?.name ? `Hoş geldin, ${me.data.name}` : "Hoş geldin"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tasksLoading
            ? "Bugünün durumu yükleniyor…"
            : tasks.length
              ? `Bugün ${tasks.length} iş seni bekliyor${tasks.some((x) => x.tone === "critical") ? "; bazıları acil" : ""}.`
              : "Bekleyen iş yok; her şey yolunda."}
        </p>
      </div>

      {stats.error && !stats.data ? (
        <ErrorState message={stats.error.message} onRetry={stats.reload} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={Users} label="Kullanıcılar" value={t && fmtInt(t.users)} note={t && `${fmtInt(t.registered)} kayıtlı · ${fmtInt(t.guests)} misafir`} />
          <Kpi
            icon={Crown}
            label="PRO abone"
            value={t && fmtInt(t.pro)}
            note={t && (t.registered ? `Kayıtlı kullanıcıların %${Math.round((t.pro / t.registered) * 100)}'i` : "Henüz kayıtlı kullanıcı yok")}
          />
          <Kpi icon={Sparkles} label="Bugünkü tasarım" value={t && fmtInt(t.designsToday)} note={t && `${fmtInt(t.failedToday)} başarısız · ${fmtInt(t.creditsSpentToday)} hak harcandı`} />
          <Kpi
            icon={Coins}
            label="Bugünkü AI maliyeti"
            value={ai.data && usd(ai.data.budget.spentTodayUsd)}
            note={ai.data && (ai.data.budget.dailyBudgetUsd > 0 ? `Günlük bütçe ${usd(ai.data.budget.dailyBudgetUsd)}` : "Günlük bütçe tanımlı değil")}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Bugünün işleri</CardTitle>
          <CardDescription>Senden işlem bekleyenler; en acil olan en üstte</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {tasksLoading ? (
            <div className="flex flex-col gap-3 px-6">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex items-center gap-3 px-6 py-2 text-sm text-muted-foreground">
              <CircleCheck className="size-5 text-good" aria-hidden /> Bekleyen iş yok.
            </div>
          ) : (
            <ul className="divide-y">
              {tasks.map((task) => (
                <TaskRow key={task.key} task={task} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4" aria-labelledby="trends">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="trends" className="text-lg font-semibold">
            Eğilimler
          </h2>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(days)}
            onValueChange={(v) => v && setDays(Number(v))}
            aria-label="Tarih aralığı"
          >
            {RANGES.map((r) => (
              <ToggleGroupItem key={r.days} value={String(r.days)} className="px-3">
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {!stats.data ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <div className={`flex flex-col gap-4 transition-opacity ${stats.loading ? "opacity-60" : ""}`}>
            <div className="grid gap-4 xl:grid-cols-2">
              <DailyDesignsChart data={stats.data.daily} />
              <NewUsersChart data={stats.data.daily} />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <BarList
                title="Araçlara göre tasarımlar"
                subtitle={`Son ${days} gün`}
                rows={stats.data.byTool.map((r) => ({ key: r.tool, label: toolLabel(r.tool), value: r.count }))}
              />
              <BarList
                title="Stillere göre tasarımlar"
                subtitle={`Son ${days} gün`}
                rows={stats.data.byStyle.map((r) => ({ key: r.styleId, label: styleName(r.styleId), value: r.count }))}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, note }: { icon: LucideIcon; label: string; value: string | undefined | null; note: string | undefined | null }) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Icon className="size-4" aria-hidden />
          </span>
        </CardAction>
        {value == null ? <Skeleton className="h-8 w-24" /> : <CardTitle className="tabular text-3xl font-semibold">{value}</CardTitle>}
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{note ?? " "}</CardContent>
    </Card>
  );
}

function TaskRow({ task }: { task: Task }) {
  const tone = TONE_BADGE[task.tone];
  const body = (
    <>
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tone.className}`}>
        <task.icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{task.title}</span>
        <span className="block text-xs text-muted-foreground">{task.detail}</span>
      </span>
      <Badge variant="outline" className={`border-transparent ${tone.className}`}>
        {tone.label}
      </Badge>
      {task.href ? <ArrowRight className="size-4 text-muted-foreground" aria-hidden /> : <span className="w-4" />}
    </>
  );
  return (
    <li>
      {task.href ? (
        <Link href={task.href} className="flex items-center gap-3 px-6 py-3 transition hover:bg-muted">
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-6 py-3">{body}</div>
      )}
    </li>
  );
}

function buildTasks(d: {
  me: AdminMe | null;
  ai: AiUsageStats | null;
  reports: Page<ContentReport> | null;
  kvkk: DataRequestCounts | null;
  failed: Page<BillingEvent> | null;
  unmatched: Page<BillingEvent> | null;
  jobs: JobsOverview | null;
}): Task[] {
  const tasks: Task[] = [];
  // No second-factor reminders where MFA is switched off (development, ADMIN_DEV_SKIP_MFA).
  if (d.me?.mfa.required && !d.me.mfa.enrolled) {
    tasks.push({ key: "mfa", tone: "critical", icon: ShieldAlert, title: "İki adımlı doğrulaman kurulmamış", detail: "Hesabını korumak için doğrulayıcı uygulamayı bağla", href: "/account" });
  } else if (d.me?.mfa.required && d.me.mfa.backupCodesRemaining < 3) {
    tasks.push({ key: "backup", tone: "warning", icon: ShieldAlert, title: `${d.me.mfa.backupCodesRemaining} yedek kodun kaldı`, detail: "Telefonunu kaybedersen giriş için yeni yedek kodlar üret", href: "/account" });
  }

  const k = d.kvkk?.counts;
  if (k?.overdue) {
    tasks.push({ key: "kvkk-overdue", tone: "critical", icon: Scale, title: `${k.overdue} KVKK başvurusunun süresi geçti`, detail: "Yasal yanıt süresi 30 gün; hemen sonuçlandırılmalı", href: "/data-requests" });
  }
  if (k?.dueSoon) {
    tasks.push({ key: "kvkk-soon", tone: "warning", icon: Scale, title: `${k.dueSoon} KVKK başvurusunun süresi 7 gün içinde doluyor`, detail: "Son tarihten önce yanıtla", href: "/data-requests" });
  }
  if (k && k.open > k.overdue + k.dueSoon) {
    tasks.push({ key: "kvkk-open", tone: "info", icon: Scale, title: `${k.open - k.overdue - k.dueSoon} açık KVKK başvurusu`, detail: "Süresi var; sırayla ele alınabilir", href: "/data-requests" });
  }

  const openReports = d.reports?.items.length ?? 0;
  if (openReports) {
    tasks.push({ key: "reports", tone: "warning", icon: Flag, title: `${openReports} açık içerik bildirimi`, detail: "Kullanıcıların bildirdiği AI görselleri; Google Play hızlı inceleme bekler", href: "/reports" });
  }

  const budget = d.ai?.budget;
  if (budget?.state === "exceeded") {
    tasks.push({ key: "budget", tone: "critical", icon: Coins, title: "Günlük AI bütçesi aşıldı", detail: `Bugün ${usd(budget.spentTodayUsd)} harcandı; ücretsiz kullanıcılar kısıtlandı`, href: "/ai-costs" });
  } else if (budget?.state === "warning") {
    tasks.push({ key: "budget", tone: "warning", icon: Coins, title: "Günlük AI bütçesi dolmak üzere", detail: `Bugün ${usd(budget.spentTodayUsd)} / ${usd(budget.dailyBudgetUsd)}`, href: "/ai-costs" });
  }

  const billing = (d.failed?.items.length ?? 0) + (d.unmatched?.items.length ?? 0);
  if (billing) {
    tasks.push({ key: "billing", tone: "warning", icon: CreditCard, title: `${billing} ödeme olayı işlenemedi`, detail: "Başarısız ya da kullanıcıyla eşleşmeyen mağaza bildirimleri", href: "/billing" });
  }

  if (d.jobs) {
    const latest = new Map<string, string>();
    for (const run of d.jobs.items) if (!latest.has(run.name)) latest.set(run.name, run.status);
    const broken = [...latest].filter(([, s]) => s === "error").map(([n]) => n);
    if (broken.length || d.jobs.queue.failed) {
      tasks.push({
        key: "jobs",
        tone: "warning",
        icon: broken.length ? ListChecks : AlertTriangle,
        title: broken.length ? `${broken.length} zamanlı iş son çalışmasında hata verdi` : `Kuyrukta ${d.jobs.queue.failed} başarısız iş`,
        detail: broken.length ? broken.join(", ") : "Ayrıntı için zamanlı işler sayfasına bak",
        href: "/jobs",
      });
    }
  }
  return tasks.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

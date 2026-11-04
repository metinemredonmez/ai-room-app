import type { PrismaService } from '../common/infra.js';
import { escapeHtml, mailShell, type Mail } from '../mail/mailer.service.js';

// Owner's weekly report (API.md §7.18): the numbers of the last 7 days next to the 7 days before, a short Turkish
// reading of them by Claude, sent every Monday 09:00 (Istanbul) to the SUPER_ADMIN addresses. No personal data:
// only counts and sums.

const DAY = 86_400_000;

type Window = { gte: Date; lt: Date };

async function week(prisma: PrismaService, w: Window) {
  const created = { createdAt: w };
  const [registered, guests, active, designs, succeeded, failed, cost, purchases, starts, renewals, cancels, jobErrors, broadcasts] =
    await Promise.all([
      prisma.user.count({ where: { ...created, isGuest: false } }),
      prisma.user.count({ where: { ...created, isGuest: true } }),
      prisma.user.count({ where: { lastSeenAt: w } }),
      prisma.design.count({ where: created }),
      prisma.design.count({ where: { ...created, status: 'SUCCEEDED' } }),
      prisma.design.count({ where: { ...created, status: 'FAILED' } }),
      prisma.aiUsage.aggregate({ where: created, _sum: { costUsd: true }, _count: true }),
      prisma.storePurchase.count({ where: created }),
      prisma.webhookEvent.count({ where: { receivedAt: w, type: 'INITIAL_PURCHASE' } }),
      prisma.webhookEvent.count({ where: { receivedAt: w, type: 'RENEWAL' } }),
      prisma.webhookEvent.count({ where: { receivedAt: w, type: 'CANCELLATION' } }),
      prisma.jobRun.count({ where: { startedAt: w, status: 'error' } }),
      prisma.broadcast.count({ where: { finishedAt: w, status: 'SENT' } }),
    ]);
  const costUsd = Number(cost._sum.costUsd ?? 0);
  return {
    users: { registered, guests, active },
    designs: { created: designs, succeeded, failed, failRate: designs ? Number((failed / designs).toFixed(3)) : 0 },
    store: { subscriptionsStarted: starts, renewals, cancellations: cancels, creditPacks: purchases },
    ai: { calls: cost._count, costUsd: Number(costUsd.toFixed(2)), costPerDesignUsd: succeeded ? Number((costUsd / succeeded).toFixed(3)) : null },
    ops: { jobErrors, broadcastsSent: broadcasts },
  };
}

export async function weeklyMetrics(prisma: PrismaService, now = new Date()) {
  const thisWeek = { gte: new Date(now.getTime() - 7 * DAY), lt: now };
  const lastWeek = { gte: new Date(now.getTime() - 14 * DAY), lt: thisWeek.gte };
  const [current, previous, tools, styles, openReports, kvkkOpen, totalRegistered, activeSubs] = await Promise.all([
    week(prisma, thisWeek),
    week(prisma, lastWeek),
    prisma.design.groupBy({ by: ['tool'], where: { createdAt: thisWeek }, _count: { _all: true }, orderBy: { _count: { tool: 'desc' } }, take: 5 }),
    prisma.design.groupBy({ by: ['styleId'], where: { createdAt: thisWeek, styleId: { not: null } }, _count: { _all: true }, orderBy: { _count: { styleId: 'desc' } }, take: 5 }),
    prisma.contentReport.count({ where: { status: 'OPEN' } }),
    prisma.dataRequest.count({ where: { status: { in: ['RECEIVED', 'IN_PROGRESS'] } } }),
    prisma.user.count({ where: { isGuest: false } }),
    prisma.subscription.count({ where: { status: { in: ['active', 'grace'] } } }),
  ]);
  return {
    period: { from: thisWeek.gte.toISOString(), to: now.toISOString() },
    thisWeek: current,
    lastWeek: previous,
    topTools: tools.map((t) => ({ tool: t.tool, designs: t._count._all })),
    topStyles: styles.map((s) => ({ style: s.styleId, designs: s._count._all })),
    now: { registeredUsers: totalRegistered, activeSubscriptions: activeSubs, openContentReports: openReports, openKvkkRequests: kvkkOpen },
  };
}
export type WeeklyMetrics = Awaited<ReturnType<typeof weeklyMetrics>>;

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' });
const delta = (a: number, b: number) => (b === 0 ? (a === 0 ? '' : ' (yeni)') : ` (${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%)`);

/** The numbers always go out; Claude's reading is added when it was available. */
export function renderWeeklyReport(o: {
  to: string;
  metrics: WeeklyMetrics;
  text: { summary: string; highlights: string[]; actions: string[] } | null;
  adminUrl: string;
}): Mail {
  const m = o.metrics;
  const t = m.thisWeek;
  const l = m.lastWeek;
  const rows: Array<[string, string]> = [
    ['Yeni kayıtlı kullanıcı', `${t.users.registered}${delta(t.users.registered, l.users.registered)}`],
    ['Yeni misafir', `${t.users.guests}${delta(t.users.guests, l.users.guests)}`],
    ['Aktif kullanıcı', `${t.users.active}${delta(t.users.active, l.users.active)}`],
    ['Tasarım (başarılı / hatalı)', `${t.designs.succeeded} / ${t.designs.failed}${delta(t.designs.succeeded, l.designs.succeeded)}`],
    ['Yeni abonelik / yenileme / iptal', `${t.store.subscriptionsStarted} / ${t.store.renewals} / ${t.store.cancellations}`],
    ['Kredi paketi', `${t.store.creditPacks}`],
    ['AI maliyeti', `$${t.ai.costUsd.toFixed(2)}${delta(t.ai.costUsd, l.ai.costUsd)}`],
    ['Tasarım başına AI maliyeti', t.ai.costPerDesignUsd === null ? '—' : `$${t.ai.costPerDesignUsd.toFixed(3)}`],
    ['Hatalı zamanlı iş', `${t.ops.jobErrors}`],
    ['Açık içerik bildirimi / KVKK başvurusu', `${m.now.openContentReports} / ${m.now.openKvkkRequests}`],
    ['Toplam kayıtlı kullanıcı / aktif abonelik', `${m.now.registeredUsers} / ${m.now.activeSubscriptions}`],
  ];
  const period = `${fmtDay(m.period.from)} – ${fmtDay(m.period.to)}`;
  const p = (s: string) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${escapeHtml(s)}</p>`;
  const list = (items: string[]) =>
    items.length ? `<ul style="font-size:15px;line-height:1.6;margin:0 0 12px;padding-left:20px">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '';
  const table =
    `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 16px">` +
    rows.map(([k, v]) => `<tr><td style="padding:6px 0;border-bottom:1px solid #E8E0D6;color:#6E655E">${escapeHtml(k)}</td><td style="padding:6px 0;border-bottom:1px solid #E8E0D6;text-align:right">${escapeHtml(v)}</td></tr>`).join('') +
    `</table>`;
  const bodyHtml =
    (o.text ? p(o.text.summary) + list(o.text.highlights) : p('Bu hafta yapay zekâ yorumu hazırlanamadı; sayılar aşağıda.')) +
    table +
    (o.text?.actions.length ? `<p style="font-size:15px;margin:16px 0 4px"><strong>Öneriler</strong></p>${list(o.text.actions)}` : '') +
    p(`Ayrıntılar: ${o.adminUrl}`);
  const text = [
    `Casalume haftalık rapor · ${period}`,
    '',
    ...(o.text ? [o.text.summary, '', ...o.text.highlights.map((h) => `• ${h}`), ''] : []),
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(o.text?.actions.length ? ['', 'Öneriler:', ...o.text.actions.map((a) => `• ${a}`)] : []),
    '',
    `Ayrıntılar: ${o.adminUrl}`,
  ].join('\n');
  return {
    to: o.to,
    subject: `Casalume haftalık rapor · ${period}`,
    html: mailShell({ heading: `Haftalık rapor · ${period}`, bodyHtml, footerHtml: 'Bu e-postayı Casalume yöneticisi olduğun için aldın.' }),
    text,
  };
}

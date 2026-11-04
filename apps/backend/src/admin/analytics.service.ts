import { Inject, Injectable } from '@nestjs/common';
import { todayInIstanbul } from '../common/http.js';
import { PrismaService } from '../common/infra.js';
import { CONFIG, type Config } from '../config.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  ACTIVITY_AI_KINDS,
  REVENUE_EVENT_TYPES,
  cohortGrid,
  dayRange,
  fillDaily,
  summarizeRevenue,
  summarizeSubscriptions,
  windowStart,
  type ActiveSubscription,
  type BillingEnv,
} from './analytics.rules.js';

// Admin analytics (API.md §7.20): revenue (RevenueCat webhook events), engagement and weekly retention cohorts.
// Counts only; no personal data leaves these queries. Staff accounts (role ≠ USER) are left out of the user numbers.
//
// The columns are `timestamp without time zone` holding UTC. `col AT TIME ZONE 'UTC'` makes that explicit before
// converting to Istanbul, so the day a row falls on does not depend on the database session's time zone.

const MAX_EVENTS = 50_000;
const ist = (col: string) => Prisma.raw(`((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul')`);
const today = Prisma.sql`(now() AT TIME ZONE 'Europe/Istanbul')::date`;
/** 00:00 Istanbul `n - 1` days before today, as a UTC timestamp comparable with the columns (index friendly). */
const sinceDays = (n: number) => Prisma.sql`(((${today} - ${n - 1}::int)::timestamp AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'UTC')`;
const aiKinds = Prisma.join([...ACTIVITY_AI_KINDS]);
const nowUtc = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService, @Inject(CONFIG) private cfg: Config) {}

  async revenue(days: number, env: BillingEnv) {
    const day = todayInIstanbul();
    const rows = await this.prisma.webhookEvent.findMany({
      // An event is received after it happened, so this window holds every event of the period.
      where: { source: 'revenuecat', type: { in: [...REVENUE_EVENT_TYPES] }, receivedAt: { gte: windowStart(day, days) } },
      select: { type: true, receivedAt: true, userId: true, payload: true },
      orderBy: { receivedAt: 'asc' },
      take: MAX_EVENTS,
    });
    // Access right now, with the last billed price of each subscriber (for MRR).
    const subs = await this.prisma.$queryRaw<ActiveSubscription[]>`
      SELECT s.status, s."periodType", e.price, e."periodDays"
      FROM "Subscription" s
      LEFT JOIN LATERAL (
        SELECT
          CASE WHEN jsonb_typeof(w.payload->'price') = 'number' THEN (w.payload->>'price')::float8 END AS price,
          CASE WHEN jsonb_typeof(w.payload->'expiration_at_ms') = 'number' AND jsonb_typeof(w.payload->'purchased_at_ms') = 'number'
            THEN ((w.payload->>'expiration_at_ms')::float8 - (w.payload->>'purchased_at_ms')::float8) / 86400000 END AS "periodDays"
        FROM "WebhookEvent" w
        WHERE w."userId" = s."userId" AND w.type IN ('INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE')
          AND COALESCE(w.payload->>'environment', 'PRODUCTION') = ${env}
          AND (CASE WHEN jsonb_typeof(w.payload->'price') = 'number' THEN (w.payload->>'price')::float8 ELSE 0 END) > 0
        ORDER BY w."receivedAt" DESC
        LIMIT 1
      ) e ON true
      WHERE s.entitlement = ${this.cfg.REVENUECAT_ENTITLEMENT} AND s.status <> 'expired'
        AND COALESCE(s.environment, 'PRODUCTION') = ${env}
        AND GREATEST(s."expiresAt", s."gracePeriodExpiresAt") > ${nowUtc}`;
    return {
      days,
      ...summarizeRevenue(rows, { env, days, today: day }),
      subscriptions: summarizeSubscriptions(subs),
      truncated: rows.length === MAX_EVENTS,
    };
  }

  async engagement(days: number) {
    const span = Math.max(days, 30);
    const act = Prisma.sql`
      act AS (
        SELECT z.uid, z.day FROM (
          SELECT x."userId" AS uid, ${ist('x."createdAt"')}::date AS day FROM "Design" x WHERE x."createdAt" >= ${sinceDays(span)}
          UNION
          SELECT a."userId", ${ist('a."createdAt"')}::date FROM "AiUsage" a
          WHERE a."userId" IS NOT NULL AND a.kind IN (${aiKinds}) AND a."createdAt" >= ${sinceDays(span)}
        ) z
        JOIN "User" u ON u.id = z.uid AND u.role = 'USER'
      )`;
    const [daily, [summary], [returning], [funnel], [designs], reach] = await Promise.all([
      this.prisma.$queryRaw<Array<{ date: string; n: number }>>`
        WITH ${act}
        SELECT to_char(day, 'YYYY-MM-DD') AS date, count(*)::int AS n FROM act WHERE day > ${today} - ${days}::int GROUP BY day`,
      this.prisma.$queryRaw<Array<{ dau: number; wau: number; mau: number; active: number; userDays30: number }>>`
        WITH ${act}
        SELECT
          count(DISTINCT uid) FILTER (WHERE day = ${today})::int AS dau,
          count(DISTINCT uid) FILTER (WHERE day > ${today} - 7)::int AS wau,
          count(DISTINCT uid) FILTER (WHERE day > ${today} - 30)::int AS mau,
          count(DISTINCT uid) FILTER (WHERE day > ${today} - ${days}::int)::int AS active,
          count(*) FILTER (WHERE day > ${today} - 30)::int AS "userDays30"
        FROM act`,
      this.prisma.$queryRaw<Array<{ n: number }>>`
        WITH ${act}
        SELECT count(*)::int AS n FROM (
          SELECT uid FROM act WHERE day > ${today} - ${days}::int GROUP BY uid HAVING count(*) >= 2
        ) r`,
      // Users who signed up in the period: how far each got (every step is a share of the signups).
      this.prisma.$queryRaw<Array<{ signups: number; designed: number; succeeded: number; repeat: number; registered: number; paid: number }>>`
        SELECT
          count(*)::int AS signups,
          count(*) FILTER (WHERE d.n >= 1)::int AS designed,
          count(*) FILTER (WHERE d.ok >= 1)::int AS succeeded,
          count(*) FILTER (WHERE d.n >= 3)::int AS repeat,
          count(*) FILTER (WHERE NOT u."isGuest")::int AS registered,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "StorePurchase" p WHERE p."userId" = u.id)
            OR EXISTS (SELECT 1 FROM "Subscription" s WHERE s."userId" = u.id AND COALESCE(s.environment, 'PRODUCTION') = 'PRODUCTION'))::int AS paid
        FROM "User" u
        LEFT JOIN LATERAL (
          SELECT count(*) AS n, count(*) FILTER (WHERE x.status = 'SUCCEEDED') AS ok FROM "Design" x WHERE x."userId" = u.id
        ) d ON true
        WHERE u.role = 'USER' AND u."createdAt" >= ${sinceDays(days)}`,
      this.prisma.$queryRaw<Array<{ designs: number; designers: number; succeeded: number; favorites: number }>>`
        SELECT count(*)::int AS designs, count(DISTINCT x."userId")::int AS designers,
          count(*) FILTER (WHERE x.status = 'SUCCEEDED')::int AS succeeded, count(*) FILTER (WHERE x.favorite)::int AS favorites
        FROM "Design" x JOIN "User" u ON u.id = x."userId" AND u.role = 'USER'
        WHERE x."createdAt" >= ${sinceDays(days)}`,
      this.prisma.$queryRaw<Array<{ kind: 'tool' | 'ai'; key: string; users: number }>>`
        SELECT 'tool' AS kind, x.tool AS key, count(DISTINCT x."userId")::int AS users
        FROM "Design" x JOIN "User" u ON u.id = x."userId" AND u.role = 'USER'
        WHERE x."createdAt" >= ${sinceDays(days)} GROUP BY x.tool
        UNION ALL
        SELECT 'ai', a.kind, count(DISTINCT a."userId")::int
        FROM "AiUsage" a JOIN "User" u ON u.id = a."userId" AND u.role = 'USER'
        WHERE a.kind IN (${aiKinds}) AND a."createdAt" >= ${sinceDays(days)} GROUP BY a.kind`,
    ]);
    const avgDau30 = summary.userDays30 / 30;
    return {
      days,
      active: {
        today: summary.dau,
        week: summary.wau,
        month: summary.mau,
        period: summary.active,
        returning: returning.n,
        stickiness: summary.mau ? Math.round((avgDau30 / summary.mau) * 1000) / 10 : null,
      },
      daily: fillDaily(dayRange(todayInIstanbul(), days), daily),
      funnel,
      designs: {
        ...designs,
        perDesigner: designs.designers ? Math.round((designs.designs / designs.designers) * 10) / 10 : null,
        favoriteRate: designs.succeeded ? Math.round((designs.favorites / designs.succeeded) * 1000) / 10 : null,
      },
      reach: reach.sort((a, b) => b.users - a.users),
    };
  }

  async cohorts(weeks: number, segment: 'all' | 'registered') {
    const guest = segment === 'registered' ? Prisma.sql`AND NOT u."isGuest"` : Prisma.empty;
    const week0 = Prisma.sql`date_trunc('week', now() AT TIME ZONE 'Europe/Istanbul')`;
    const bound = Prisma.sql`((${week0} - make_interval(weeks => ${weeks - 1}::int)) AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'UTC'`;
    const wk = (col: string) => Prisma.sql`date_trunc('week', ${ist(col)})::date`;
    const [[current], sizes, active] = await Promise.all([
      this.prisma.$queryRaw<Array<{ week: string }>>`SELECT to_char(${week0}, 'YYYY-MM-DD') AS week`,
      this.prisma.$queryRaw<Array<{ cohort: string; n: number }>>`
        SELECT to_char(${wk('u."createdAt"')}, 'YYYY-MM-DD') AS cohort, count(*)::int AS n
        FROM "User" u WHERE u.role = 'USER' ${guest} AND u."createdAt" >= ${bound} GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ cohort: string; k: number; n: number }>>`
        WITH c AS (
          SELECT u.id, ${wk('u."createdAt"')} AS cw FROM "User" u WHERE u.role = 'USER' ${guest} AND u."createdAt" >= ${bound}
        ),
        act AS (
          SELECT x."userId" AS uid, ${wk('x."createdAt"')} AS aw FROM "Design" x WHERE x."createdAt" >= ${bound}
          UNION
          SELECT a."userId", ${wk('a."createdAt"')} FROM "AiUsage" a
          WHERE a."userId" IS NOT NULL AND a.kind IN (${aiKinds}) AND a."createdAt" >= ${bound}
        )
        SELECT to_char(c.cw, 'YYYY-MM-DD') AS cohort, ((act.aw - c.cw) / 7)::int AS k, count(DISTINCT c.id)::int AS n
        FROM c JOIN act ON act.uid = c.id AND act.aw >= c.cw
        GROUP BY 1, 2`,
    ]);
    return { segment, ...cohortGrid({ currentWeek: current.week, weeks, sizes, active }) };
  }
}

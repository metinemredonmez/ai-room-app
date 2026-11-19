import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../common/infra.js';
import { todayInIstanbul } from '../common/http.js';
import { APP_EVENT_NAMES, type AppEventName } from './app-events.schema.js';

const ist = (col: string) => Prisma.raw(`((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul')`);
const today = Prisma.sql`(now() AT TIME ZONE 'Europe/Istanbul')::date`;
const sinceDays = (n: number) => Prisma.sql`(((${today} - ${n - 1}::int)::timestamp AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'UTC')`;

@Injectable()
export class AppEventsService {
  constructor(private prisma: PrismaService) {}

  async track(data: {
    userId?: string;
    name: AppEventName;
    platform?: string;
    version?: string;
    sessionId?: string;
    meta?: Record<string, unknown>;
  }) {
    return this.prisma.appEvent.create({
      data: {
        userId: data.userId,
        name: data.name,
        platform: data.platform ?? null,
        version: data.version ?? null,
        sessionId: data.sessionId ?? null,
        meta: (data.meta ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async funnel(days: number) {
    const names = Prisma.join(APP_EVENT_NAMES);
    const rows = await this.prisma.$queryRaw<
      Array<{ name: string; total: number; users: number }>
    >`
      SELECT
        e.name,
        count(*)::int AS total,
        count(DISTINCT COALESCE(e."userId"::text, e."sessionId"))::int AS users
      FROM "AppEvent" e
      WHERE e.name IN (${names}) AND e."createdAt" >= ${sinceDays(days)}
      GROUP BY e.name`;

    const map = new Map(rows.map((r) => [r.name, r]));
    const steps: Array<{
      name: AppEventName;
      total: number;
      users: number;
      conversionFromPrevious: number | null;
      conversionFromFirst: number | null;
    }> = [];

    const firstUsers = map.get('studio_open')?.users ?? 0;
    let previousUsers = firstUsers;

    for (const name of APP_EVENT_NAMES) {
      const row = map.get(name) ?? { total: 0, users: 0 };
      const conversionFromPrevious = previousUsers
        ? Math.round((row.users / previousUsers) * 1000) / 10
        : null;
      const conversionFromFirst = firstUsers
        ? Math.round((row.users / firstUsers) * 1000) / 10
        : null;
      steps.push({ name, total: row.total, users: row.users, conversionFromPrevious, conversionFromFirst });
      previousUsers = row.users || previousUsers;
    }

    return {
      days,
      today: todayInIstanbul(),
      steps,
    };
  }
}

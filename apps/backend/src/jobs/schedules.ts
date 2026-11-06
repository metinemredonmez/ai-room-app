import type { Queue } from 'bullmq';
import type { PrismaService } from '../common/infra.js';

// Scheduled jobs as the admin sees them (API.md §7.42; YediOda #91): each scheduler with its next run, its last run
// and whether it is late. "Late" means the next run is overdue by more than 10 minutes (or three intervals for the
// minute jobs): the worker has stopped or is stuck. Jobs on MANUAL_JOBS can also be run from the panel; each one is
// safe to repeat (idempotent), which is why only these are listed.

export const MANUAL_JOBS = ['reconcile-designs', 'broadcasts-due', 'price-schedules', 'retention', 'loyalty', 'kvkk-deadlines', 'weekly-report'] as const;
export type ManualJob = (typeof MANUAL_JOBS)[number];
export const isManualJob = (v: string): v is ManualJob => (MANUAL_JOBS as readonly string[]).includes(v);

const LATE_GRACE_MS = 10 * 60_000;

export type ScheduleStatus = {
  name: string;
  every: number | null;
  pattern: string | null;
  next: string | null;
  late: boolean;
  runnable: boolean;
  lastRun: { status: string; startedAt: string } | null;
};

export const isLate = (next: number | undefined, every: number | undefined, now: number) => !!next && now - next > Math.max(LATE_GRACE_MS, (every ?? 0) * 3);

export async function scheduleStatus(queue: Queue, prisma: PrismaService, now = Date.now()): Promise<ScheduleStatus[]> {
  const [schedulers, last] = await Promise.all([
    queue.getJobSchedulers(0, -1, true),
    prisma.$queryRaw<Array<{ name: string; status: string; startedAt: Date }>>`
      SELECT DISTINCT ON (name) name, status, "startedAt" FROM "JobRun" ORDER BY name, "startedAt" DESC`,
  ]);
  const lastBy = new Map(last.map((r) => [r.name, r]));
  return schedulers
    .map((s) => {
      const l = lastBy.get(s.name);
      return {
        name: s.name,
        every: s.every ?? null,
        pattern: s.pattern ?? null,
        next: s.next ? new Date(s.next).toISOString() : null,
        late: isLate(s.next, s.every, now),
        runnable: isManualJob(s.name),
        lastRun: l ? { status: l.status, startedAt: l.startedAt.toISOString() } : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

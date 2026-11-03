import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { AiError } from '../ai/ai.client.js';
import { CONFIG, type Config } from '../config.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { DesignsService } from '../designs/designs.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ImagesService } from '../images/images.service.js';
import { BillingService } from '../billing/billing.service.js';
import { QueuesService, type DesignJob } from './queues.service.js';

const DAY = 86_400_000;

/**
 * BullMQ workers: the design generator and the maintenance scheduler (cron tracker pattern from
 * fal-app CronTrackerService — every run is written to JobRun so the admin can see silent failures).
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private workers: Worker[] = [];

  constructor(
    private queues: QueuesService,
    private designs: DesignsService,
    private prisma: PrismaService,
    private images: ImagesService,
    private billing: BillingService,
    @Inject(CONFIG) private cfg: Config,
  ) {}

  async onModuleInit() {
    if (!this.cfg.WORKER_ENABLED || this.cfg.NODE_ENV === 'test') return;
    const connection = this.queues.connection;
    this.workers.push(
      new Worker<DesignJob>('designs', (job) => this.runDesign(job), { connection, concurrency: this.cfg.MAX_CONCURRENT_GENERATIONS }),
      new Worker('maintenance', (job) => this.runMaintenance(job), { connection, concurrency: 1 }),
    );
    for (const w of this.workers) w.on('error', (e) => log.warn('worker_error', { error: e.name }));
    await this.queues.maintenance.upsertJobScheduler('reconcile-designs', { every: 60_000 }, { name: 'reconcile-designs' });
    await this.queues.maintenance.upsertJobScheduler(
      'retention',
      { pattern: '30 3 * * *', tz: 'Europe/Istanbul' },
      { name: 'retention' },
    );
    log.info('workers_started', { concurrency: this.cfg.MAX_CONCURRENT_GENERATIONS });
  }

  async onModuleDestroy() {
    await Promise.allSettled(this.workers.map((w) => w.close()));
  }

  private async runDesign(job: Job<DesignJob>) {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    try {
      await this.designs.process(job.data.designId, { finalAttempt, requestId: job.data.requestId });
    } catch (e) {
      // process() already failed + refunded the design for anything non-retryable or final.
      if (e instanceof AiError && e.retryable && !finalAttempt) throw e;
      throw new UnrecoverableError((e as Error).message);
    }
  }

  private async runMaintenance(job: Job) {
    // Store events track their own status in WebhookEvent; they don't belong in the cron log.
    if (job.name === 'revenuecat-event') return this.billing.process((job.data as { eventId: string }).eventId);
    const run = await this.prisma.jobRun.create({ data: { name: job.name, status: 'running' } });
    try {
      const details = job.name === 'retention' ? await this.retention() : { failedStale: await this.designs.reconcile() };
      await this.prisma.jobRun.update({
        where: { id: run.id },
        data: { status: 'ok', details: details as Prisma.InputJsonValue, finishedAt: new Date() },
      });
      return details;
    } catch (e) {
      await this.prisma.jobRun.update({
        where: { id: run.id },
        data: { status: 'error', details: { error: (e as Error).name, message: (e as Error).message.slice(0, 300) }, finishedAt: new Date() },
      });
      log.error('maintenance_job_failed', { job: job.name, error: (e as Error).name });
      throw e;
    }
  }

  /** KVKK data minimisation: drop what is no longer needed (palemi ops/deletions, yoga retention scan). */
  async retention() {
    const now = Date.now();
    const orphans = await this.prisma.image.findMany({
      where: { kind: { in: ['UPLOAD', 'SAMPLE'] }, createdAt: { lt: new Date(now - 7 * DAY) }, inputFor: { none: {} } },
      select: { id: true },
      take: 5_000,
    });
    if (orphans.length) {
      await this.prisma.image.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
      await this.images.remove(orphans.map((o) => o.id));
    }
    const tokens = await this.prisma.emailToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date(now - DAY) } }, { usedAt: { lt: new Date(now - 7 * DAY) } }] },
    });
    const refresh = await this.prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date(now) } }, { revokedAt: { lt: new Date(now - 7 * DAY) } }] },
    });
    const runs = await this.prisma.jobRun.deleteMany({ where: { startedAt: { lt: new Date(now - 30 * DAY) } } });
    let mails = 0;
    const outbox = path.resolve(this.cfg.DATA_DIR, 'outbox');
    for (const f of await readdir(outbox).catch(() => [] as string[])) {
      const full = path.join(outbox, f);
      const s = await stat(full).catch(() => null);
      if (s && now - s.mtimeMs > 7 * DAY) {
        await rm(full, { force: true });
        mails++;
      }
    }
    return { images: orphans.length, emailTokens: tokens.count, refreshTokens: refresh.count, jobRuns: runs.count, outboxMails: mails };
  }

  async overview(limit: number) {
    const [runs, counts] = await Promise.all([
      this.prisma.jobRun.findMany({ orderBy: { startedAt: 'desc' }, take: limit }),
      this.queues.designs.getJobCounts('waiting', 'active', 'failed', 'delayed'),
    ]);
    return {
      items: runs.map((r) => ({
        id: r.id, name: r.name, status: r.status, details: r.details,
        startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
      queue: { waiting: counts.waiting ?? 0, active: counts.active ?? 0, failed: counts.failed ?? 0, delayed: counts.delayed ?? 0 },
    };
  }
}

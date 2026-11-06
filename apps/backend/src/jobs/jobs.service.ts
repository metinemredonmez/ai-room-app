import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { AiError } from '../ai/ai.client.js';
import { CONFIG, type Config } from '../config.js';
import { PrismaService } from '../common/infra.js';
import { log } from '../common/log.js';
import { reportError } from '../common/monitoring.js';
import { DesignsService } from '../designs/designs.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ImagesService } from '../images/images.service.js';
import { BillingService } from '../billing/billing.service.js';
import { PushPartialError, PushRetryableError, PushService } from '../push/push.service.js';
import { AppleRetryableError, AppleService } from '../auth/apple.service.js';
import { DataRequestsService } from '../kvkk/data-requests.service.js';
import { BroadcastsService } from '../broadcasts/broadcasts.service.js';
import { MarketingService } from '../marketing/marketing.service.js';
import { SupportService } from '../support/support.service.js';
import { WelcomeService } from '../users/welcome.service.js';
import { OrgsService } from '../orgs/orgs.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { WaitlistService } from '../waitlist/waitlist.service.js';
import { PriceScheduleService } from '../prices/price-schedule.service.js';
import { isManualJob, scheduleStatus } from './schedules.js';
import { QueuesService, type BroadcastJob, type DesignJob, type MarketingJob, type NotificationJob } from './queues.service.js';

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
    private push: PushService,
    private apple: AppleService,
    private dataRequests: DataRequestsService,
    private broadcasts: BroadcastsService,
    private marketing: MarketingService,
    private support: SupportService,
    @Inject(CONFIG) private cfg: Config,
    private welcome: WelcomeService,
    private orgs: OrgsService,
    private loyalty: LoyaltyService,
    private prices: PriceScheduleService,
    private waitlist: WaitlistService,
  ) {}

  async onModuleInit() {
    if (!this.cfg.WORKER_ENABLED || this.cfg.NODE_ENV === 'test') return;
    const connection = this.queues.connection;
    this.workers.push(
      new Worker<DesignJob>('designs', (job) => this.runDesign(job), { connection, concurrency: this.cfg.MAX_CONCURRENT_GENERATIONS }),
      new Worker('maintenance', (job) => this.runMaintenance(job), { connection, concurrency: 1 }),
      new Worker<NotificationJob>('notifications', (job) => this.runNotification(job), { connection, concurrency: 4 }),
      // One broadcast at a time: weekly marketing caps are counted without races.
      new Worker<BroadcastJob>('broadcasts', (job) => this.runBroadcast(job), { connection, concurrency: 1 }),
      // Marketing drafts: a few languages at a time keeps Claude's rate limit and the server load low.
      new Worker<MarketingJob>('marketing', (job) => this.marketing.process(job.data.draftId, job.attemptsMade + 1 >= (job.opts.attempts ?? 1)), { connection, concurrency: 3 }),
    );
    for (const w of this.workers) {
      w.on('error', (e) => log.warn('worker_error', { error: e.name }));
      // Design failures are reported where they are classified (runDesign); the rest once retries are spent.
      if (w.name !== 'designs') {
        w.on('failed', (job, e) => {
          if (job && (e instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1))) reportError(e, { tags: { queue: w.name, job: job.name } });
        });
      }
    }
    await this.queues.maintenance.upsertJobScheduler('reconcile-designs', { every: 60_000 }, { name: 'reconcile-designs' });
    await this.queues.maintenance.upsertJobScheduler('broadcasts-due', { every: 60_000 }, { name: 'broadcasts-due' });
    // API.md §7.36: scheduled price changes start and end within a minute of their time.
    await this.queues.maintenance.upsertJobScheduler('price-schedules', { every: 60_000 }, { name: 'price-schedules' });
    await this.queues.maintenance.upsertJobScheduler(
      'retention',
      { pattern: '30 3 * * *', tz: 'Europe/Istanbul' },
      { name: 'retention' },
    );
    await this.queues.maintenance.upsertJobScheduler(
      'weekly-report',
      { pattern: '0 9 * * 1', tz: 'Europe/Istanbul' },
      { name: 'weekly-report' },
    );
    // API.md §7.35: anniversary and win-back gifts once a day, at an hour a push is welcome.
    await this.queues.maintenance.upsertJobScheduler('loyalty', { pattern: '0 11 * * *', tz: 'Europe/Istanbul' }, { name: 'loyalty' });
    await this.queues.maintenance.upsertJobScheduler(
      'kvkk-deadlines',
      { pattern: '0 9 * * *', tz: 'Europe/Istanbul' },
      { name: 'kvkk-deadlines' },
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
      // Provider and content errors are expected outcomes; anything else is a bug worth a report.
      if (!(e instanceof AiError)) reportError(e, { tags: { queue: 'designs', job: job.name }, requestId: job.data.requestId });
      await this.notify(job.data.designId);
      throw new UnrecoverableError((e as Error).message);
    }
    await this.notify(job.data.designId);
  }

  private async notify(designId: string) {
    // A push problem must never turn a finished design into a failed job.
    await this.queues.notifyDesign(designId).catch((e: Error) => log.warn('push_enqueue_failed', { designId, error: e.name }));
  }

  private async runNotification(job: Job<NotificationJob>) {
    try {
      if ('receipts' in job.data) return await this.push.checkReceipts(job.data.receipts);
      const { designId, tokens } = job.data;
      const receipts = await this.push.notifyDesign(designId, (d, locale) => this.designs.titleOf(d, locale), tokens);
      if (Object.keys(receipts).length) {
        await this.queues.notifications.add('push-receipts', { receipts }, { delay: 15 * 60_000, attempts: 2 });
      }
      return { receipts: Object.keys(receipts).length };
    } catch (e) {
      // Part of the devices got it: this job is done, a new one retries only the rest (no duplicate pushes).
      if (e instanceof PushPartialError && 'designId' in job.data) {
        await this.queues.notifications.add('design-result', { designId: job.data.designId, tokens: e.unsent }, { delay: 30_000, attempts: 4, backoff: { type: 'exponential', delay: 10_000 } });
        if (Object.keys(e.receipts).length) await this.queues.notifications.add('push-receipts', { receipts: e.receipts }, { delay: 15 * 60_000, attempts: 2 });
        return { partial: e.unsent.length };
      }
      if (e instanceof PushRetryableError) throw e;
      log.error('push_failed', { job: job.name, error: (e as Error).name });
      throw new UnrecoverableError((e as Error).message);
    }
  }

  private async runBroadcast(job: Job<BroadcastJob>) {
    try {
      return await this.broadcasts.process(job.data.broadcastId);
    } catch (e) {
      if (e instanceof PushRetryableError) throw e;
      log.error('broadcast_failed', { broadcastId: job.data.broadcastId, error: (e as Error).name });
      throw new UnrecoverableError((e as Error).message);
    }
  }

  private async runMaintenance(job: Job) {
    // Store events track their own status in WebhookEvent; they don't belong in the cron log.
    if (job.name === 'revenuecat-event') return this.billing.process((job.data as { eventId: string }).eventId);
    if (job.name === 'apple-revoke') return this.appleRevoke(job as Job<{ clientId: string; tokenEnc: string }>);
    // Runs every minute and usually has nothing to do: only a run that changed something is written to the cron log.
    if (job.name === 'price-schedules') {
      const out = await this.prices.due();
      if (out.started || out.ended || out.failed) await this.prisma.jobRun.create({ data: { name: job.name, status: 'ok', details: out, finishedAt: new Date() } });
      return out;
    }
    const run = await this.prisma.jobRun.create({ data: { name: job.name, status: 'running' } });
    try {
      const details =
        job.name === 'retention' ? await this.retention()
        : job.name === 'kvkk-deadlines' ? await this.dataRequests.deadlineDigest()
        : job.name === 'broadcasts-due' ? await this.broadcasts.due()
        : job.name === 'loyalty' ? await this.loyalty.runDaily()
        : job.name === 'weekly-report' ? await this.marketing.runReport(true, null).then((r) => ({ draftId: r.items[0]?.id }))
        : { failedStale: await this.designs.reconcile(), marketingStale: await this.marketing.reconcile() };
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

  private async appleRevoke(job: Job<{ clientId: string; tokenEnc: string }>) {
    try {
      const result = await this.apple.revoke(job.data.clientId, job.data.tokenEnc);
      log.info('apple_token_revoke', { result });
      return { result };
    } catch (e) {
      if (e instanceof AppleRetryableError) throw e;
      log.error('apple_token_revoke_failed', { error: (e as Error).name });
      throw new UnrecoverableError((e as Error).message);
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
    // API.md §7.37: sign-in history 90 days; closed or long-unused sessions 90 days after their last use.
    const logins = await this.prisma.loginEvent.deleteMany({ where: { createdAt: { lt: new Date(now - 90 * DAY) } } });
    const sessions = await this.prisma.authSession.deleteMany({ where: { lastUsedAt: { lt: new Date(now - 90 * DAY) } } });
    // API.md §7.41: alert history 90 days; resolved error groups 90 days after they were last seen.
    const alertLogs = await this.prisma.alertLog.deleteMany({ where: { createdAt: { lt: new Date(now - 90 * DAY) } } });
    const errorGroups = await this.prisma.errorGroup.deleteMany({ where: { resolvedAt: { not: null }, lastSeen: { lt: new Date(now - 90 * DAY) } } });
    let mails = 0;
    for (const dir of ['outbox', 'push-outbox']) {
      const outbox = path.resolve(this.cfg.DATA_DIR, dir);
      for (const f of await readdir(outbox).catch(() => [] as string[])) {
        const full = path.join(outbox, f);
        const s = await stat(full).catch(() => null);
        if (s?.isFile() && now - s.mtimeMs > 7 * DAY) {
          await rm(full, { force: true });
          mails++;
        }
      }
    }
    // Devices not seen for 270 days (Expo expires idle tokens; the app re-registers on every launch).
    const pushTokens = await this.prisma.pushToken.deleteMany({ where: { lastSeenAt: { lt: new Date(now - 270 * DAY) } } });
    const dataRequests = await this.dataRequests.purgeClosed();
    const broadcastDeliveries = (await this.broadcasts.purgeOldDeliveries()).count;
    const supportTickets = await this.support.purgeClosed();
    const welcomeGrants = await this.welcome.purgeOld(now);
    const orgInvites = await this.orgs.purgeInvites(now);
    // API.md §7.47: unconfirmed waiting-list addresses after 7 days, left ones after 30.
    const waitlist = await this.waitlist.purge(now);
    return {
      images: orphans.length, emailTokens: tokens.count, refreshTokens: refresh.count, jobRuns: runs.count, loginEvents: logins.count, authSessions: sessions.count, alertLogs: alertLogs.count, errorGroups: errorGroups.count,
      outboxMails: mails, pushTokens: pushTokens.count, dataRequests, broadcastDeliveries, supportTickets, welcomeGrants, orgInvites, waitlist,
    };
  }

  /** API.md §7.42: run a listed (idempotent) maintenance job now; a second click in the same minute queues nothing. */
  async runNow(name: string) {
    if (!isManualJob(name)) return null;
    const minute = Math.floor(Date.now() / 60_000);
    const job = await this.queues.maintenance.add(name, {}, { jobId: `manual-${name}-${minute}`, removeOnComplete: 200, removeOnFail: 200 });
    return { queued: true, jobId: job.id ?? null };
  }

  async overview(limit: number) {
    const schedules = await scheduleStatus(this.queues.maintenance, this.prisma).catch(() => []);
    const [runs, counts] = await Promise.all([
      this.prisma.jobRun.findMany({ orderBy: { startedAt: 'desc' }, take: limit }),
      this.queues.designs.getJobCounts('waiting', 'active', 'failed', 'delayed'),
    ]);
    const push = await this.queues.notifications.getJobCounts('waiting', 'active', 'failed', 'delayed');
    return {
      items: runs.map((r) => ({
        id: r.id, name: r.name, status: r.status, details: r.details,
        startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
      queue: { waiting: counts.waiting ?? 0, active: counts.active ?? 0, failed: counts.failed ?? 0, delayed: counts.delayed ?? 0 },
      notifications: { waiting: push.waiting ?? 0, active: push.active ?? 0, failed: push.failed ?? 0, delayed: push.delayed ?? 0 },
      schedules,
    };
  }
}

import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { CONFIG, type Config } from '../config.js';

export interface DesignJob {
  designId: string;
  requestId?: string;
}

export type NotificationJob = { designId: string } | { receipts: Record<string, string> };

export interface BroadcastJob {
  broadcastId: string;
}

/** BullMQ queues on the existing Redis (palemi jobs/outbox pattern, ported to Node). */
@Injectable()
export class QueuesService implements OnModuleDestroy {
  /** Dedicated connection: BullMQ needs maxRetriesPerRequest=null and blocking commands. */
  readonly connection: Redis;
  readonly designs: Queue<DesignJob>;
  readonly maintenance: Queue;
  readonly notifications: Queue<NotificationJob>;
  /** Toplu Gönderim: one job per broadcast; a single worker (concurrency 1) keeps weekly caps race-free. */
  readonly broadcasts: Queue<BroadcastJob>;

  constructor(@Inject(CONFIG) cfg: Config) {
    this.connection = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
    this.connection.on('error', () => undefined);
    this.designs = new Queue<DesignJob>('designs', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 2_000 },
        removeOnFail: { count: 5_000 },
      },
    });
    this.maintenance = new Queue('maintenance', {
      connection: this.connection,
      defaultJobOptions: { removeOnComplete: { count: 200 }, removeOnFail: { count: 500 } },
    });
    this.notifications = new Queue<NotificationJob>('notifications', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: 'exponential', delay: 10_000 },
        // Kept a day so the jobId dedupe below holds: one push per design, even if the design job re-runs.
        removeOnComplete: { age: 86_400 },
        removeOnFail: { count: 1_000 },
      },
    });
    this.broadcasts = new Queue<BroadcastJob>('broadcasts', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
      },
    });
  }

  /** Queued designs only: sync requests are answered in-app, so they never push. */
  notifyDesign(designId: string) {
    return this.notifications.add('design-result', { designId }, { jobId: `design-${designId}` });
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.designs.close(), this.maintenance.close(), this.notifications.close(), this.broadcasts.close()]);
    this.connection.disconnect();
  }
}

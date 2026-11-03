import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { CONFIG, type Config } from '../config.js';

export interface DesignJob {
  designId: string;
  requestId?: string;
}

/** BullMQ queues on the existing Redis (palemi jobs/outbox pattern, ported to Node). */
@Injectable()
export class QueuesService implements OnModuleDestroy {
  /** Dedicated connection: BullMQ needs maxRetriesPerRequest=null and blocking commands. */
  readonly connection: Redis;
  readonly designs: Queue<DesignJob>;
  readonly maintenance: Queue;

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
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.designs.close(), this.maintenance.close()]);
    this.connection.disconnect();
  }
}

import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { CONFIG, type Config } from '../config.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from './errors.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(CONFIG) cfg: Config) {
    super({ adapter: new PrismaPg({ connectionString: cfg.DATABASE_URL }) });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(CONFIG) cfg: Config) {
    this.client = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false });
    this.client.on('error', () => undefined); // surfaced through health checks and fail-closed limits
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }
}

export interface Limit {
  name: string;
  max: number;
  windowSec: number;
}

/**
 * RES-01 / AUT-02: shared, atomic counters (INCR + PEXPIRE NX in one MULTI) so every replica sees
 * the same budget. If Redis is unreachable the limiter fails closed (EXC-01).
 */
@Injectable()
export class RateLimiter {
  constructor(private redis: RedisService) {}

  async hit(limit: Limit, key: string, cost = 1): Promise<void> {
    const k = `rl:${limit.name}:${key}`;
    let count: number;
    try {
      const res = await this.redis.client.multi().incrby(k, cost).pexpire(k, limit.windowSec * 1000, 'NX').exec();
      count = Number(res?.[0]?.[1]);
    } catch {
      throw new AppError(503, 'busy', 'Servis geçici olarak meşgul');
    }
    if (!Number.isFinite(count)) throw new AppError(503, 'busy', 'Servis geçici olarak meşgul');
    if (count > limit.max) {
      const ttl = await this.redis.client.pttl(k).catch(() => limit.windowSec * 1000);
      throw new AppError(429, 'rate_limited', 'Çok fazla istek, lütfen biraz bekleyin', {
        'Retry-After': String(Math.max(1, Math.ceil(ttl / 1000))),
      });
    }
  }

  /** Same budget, but answers false instead of throwing (for limits that must not leak via status). */
  async allow(limit: Limit, key: string): Promise<boolean> {
    try {
      await this.hit(limit, key);
      return true;
    } catch (e) {
      if (e instanceof AppError && e.status === 429) return false;
      throw e;
    }
  }

  async reset(limit: Limit, key: string) {
    await this.redis.client.del(`rl:${limit.name}:${key}`).catch(() => undefined);
  }
}

export const LIMITS = {
  ip: { name: 'ip', max: 300, windowSec: 60 },
  loginIp: { name: 'login-ip', max: 30, windowSec: 900 },
  loginAccount: { name: 'login-acct', max: 10, windowSec: 900 },
  adminLogin: { name: 'admin-login', max: 5, windowSec: 900 },
  adminEnroll: { name: 'admin-enroll', max: 10, windowSec: 3600 },
  adminStepUp: { name: 'admin-stepup', max: 5, windowSec: 900 },
  register: { name: 'register-ip', max: 10, windowSec: 3600 },
  forgotIp: { name: 'forgot-ip', max: 10, windowSec: 3600 },
  forgotAccount: { name: 'forgot-acct', max: 3, windowSec: 3600 },
  tokenIp: { name: 'email-token-ip', max: 30, windowSec: 3600 },
  verifyResend: { name: 'verify-resend', max: 5, windowSec: 3600 },
  guest: { name: 'guest-ip', max: 30, windowSec: 3600 },
  uploads: { name: 'uploads', max: 60, windowSec: 3600 },
  generateUser: { name: 'gen-user', max: 20, windowSec: 600 },
  generateIp: { name: 'gen-ip', max: 120, windowSec: 3600 },
  // Each selection preview is a paid SAM 3 call; a tap-and-adjust session needs a few dozen at most.
  selection: { name: 'selection', max: 60, windowSec: 600 },
  broadcastTest: { name: 'broadcast-test', max: 20, windowSec: 600 },
  broadcastOpened: { name: 'broadcast-opened', max: 120, windowSec: 3600 },
  analysis: { name: 'analysis', max: 30, windowSec: 3600 },
  chatUser: { name: 'chat-user', max: 40, windowSec: 3600 },
  chatIp: { name: 'chat-ip', max: 150, windowSec: 3600 },
  reports: { name: 'reports', max: 20, windowSec: 3600 },
  export: { name: 'export', max: 3, windowSec: 3600 },
  webhooks: { name: 'webhooks-ip', max: 600, windowSec: 60 },
  billingSync: { name: 'billing-sync', max: 20, windowSec: 600 },
  pushTokens: { name: 'push-tokens', max: 30, windowSec: 3600 },
  oauthNonce: { name: 'oauth-nonce', max: 60, windowSec: 3600 },
  oauthLogin: { name: 'oauth-login', max: 30, windowSec: 900 },
  dataRequests: { name: 'data-requests', max: 5, windowSec: 86_400 },
} satisfies Record<string, Limit>;

/** In-process cap on simultaneous AI generations per instance. */
export class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number, private maxQueue = 32) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.queue.length >= this.maxQueue) throw new AppError(503, 'busy', 'Sunucu yoğun, lütfen tekrar deneyin');
      await new Promise<void>((resolve) => this.queue.push(resolve)); // slot handed over by the finisher
    } else {
      this.active++;
    }
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}

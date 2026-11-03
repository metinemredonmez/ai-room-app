import 'dotenv/config';
import { z } from 'zod';

// KEY-01 / KEY-02: secrets only from the environment; refuse to boot with unsafe values.

const secret = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .min(32, `${name} must be at least 32 characters`)
    .refine((v) => !/^(change-?me|secret|password|dev)/i.test(v), `${name} looks like a default value`);

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  PUBLIC_BASE_URL: z.url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  JWT_SECRET: secret('JWT_SECRET'),
  IMAGE_URL_SECRET: secret('IMAGE_URL_SECRET'),
  DEVICE_PEPPER: secret('DEVICE_PEPPER'),
  AI_SERVICE_URL: z.url().default('http://localhost:8001'),
  AI_INTERNAL_TOKEN: secret('AI_INTERNAL_TOKEN'),
  DATA_DIR: z.string().default('./data'),
  CORS_ORIGINS: z.string().default('http://localhost:8081'),
  // NET-03: number of trusted reverse proxies that append X-Forwarded-For (0 = use the socket peer).
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  FREE_DAILY_GENERATIONS: z.coerce.number().int().min(0).max(100).default(3),
  PRO_DAILY_GENERATIONS: z.coerce.number().int().min(1).max(1000).default(100),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(20).default(10),
  IMAGE_URL_TTL_HOURS: z.coerce.number().min(1).max(168).default(24),
  MAX_CONCURRENT_GENERATIONS: z.coerce.number().int().min(1).max(64).default(4),
});

export type Config = z.infer<typeof Env> & { corsOrigins: string[]; isProd: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration — ${issues}`);
  }
  const cfg = parsed.data;
  const corsOrigins = cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  const isProd = cfg.NODE_ENV === 'production';
  if (isProd) {
    const problems: string[] = [];
    if (!cfg.PUBLIC_BASE_URL.startsWith('https://')) problems.push('PUBLIC_BASE_URL must use https');
    if (corsOrigins.includes('*')) problems.push('CORS_ORIGINS must not contain *');
    if (new Set([cfg.JWT_SECRET, cfg.IMAGE_URL_SECRET, cfg.DEVICE_PEPPER, cfg.AI_INTERNAL_TOKEN]).size < 4) {
      problems.push('each secret must be distinct');
    }
    if (problems.length) throw new Error(`Unsafe production configuration — ${problems.join('; ')}`);
  }
  return { ...cfg, corsOrigins, isProd };
}

export const CONFIG = Symbol('CONFIG');

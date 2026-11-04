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
  // MAIL-01: the only origin ever used in e-mailed links (never the request Host header).
  WEB_APP_URL: z.url().default('http://localhost:3000'),
  // Admin panel origin, used in security notices e-mailed to admins.
  ADMIN_APP_URL: z.url().default('http://localhost:3001'),
  MAIL_TRANSPORT: z.enum(['outbox', 'smtp']).default('outbox'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Casalume <no-reply@casalume.local>'),
  AI_INTERNAL_TOKEN: secret('AI_INTERNAL_TOKEN'),
  DATA_DIR: z.string().default('./data'),
  // Image storage: local disk (single server / dev) or any S3-compatible bucket (Cloudflare R2, AWS S3, MinIO).
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  S3_PREFIX: z.string().regex(/^[A-Za-z0-9/_-]*$/).default('images/'),
  CORS_ORIGINS: z.string().default('http://localhost:8081'),
  // NET-03: number of trusted reverse proxies that append X-Forwarded-For (0 = use the socket peer).
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  FREE_DAILY_GENERATIONS: z.coerce.number().int().min(0).max(100).default(3),
  PRO_DAILY_GENERATIONS: z.coerce.number().int().min(1).max(1000).default(100),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(20).default(10),
  IMAGE_URL_TTL_HOURS: z.coerce.number().min(1).max(168).default(24),
  MAX_CONCURRENT_GENERATIONS: z.coerce.number().int().min(1).max(64).default(4),
  // RevenueCat (store subscriptions). Webhook auth: Authorization header value and/or HMAC signing secret.
  REVENUECAT_WEBHOOK_AUTH: z.string().min(16).optional(),
  REVENUECAT_WEBHOOK_SECRET: z.string().min(16).optional(),
  REVENUECAT_API_KEY: z.string().min(10).optional(),
  REVENUECAT_ENTITLEMENT: z.string().default('pro'),
  // Consumable credit packs: productId:credits pairs.
  CREDIT_PACKS: z.string().default('casalume_credits_10:10,casalume_credits_50:50'),
  // "Tasarımın hazır" push: outbox (DATA_DIR/push-outbox, development) | expo (Expo Push service).
  PUSH_TRANSPORT: z.enum(['outbox', 'expo']).default('outbox'),
  // Optional Expo access token (required once "enhanced push security" is enabled for the Expo project).
  EXPO_ACCESS_TOKEN: z.string().min(20).optional(),
  // Sign in with Google / Apple (#7). Comma-separated OAuth client ids accepted as the ID token audience:
  // Google → the *web* client id the apps pass as serverClientId; Apple → bundle id (+ Services ID for web).
  GOOGLE_CLIENT_IDS: z.string().default(''),
  APPLE_CLIENT_IDS: z.string().default(''),
  // Apple key for the token exchange and the revoke on account deletion (App Store 5.1.1(v)). PEM; "\n" escapes allowed.
  APPLE_TEAM_ID: z.string().regex(/^[A-Z0-9]{10}$/).optional(),
  APPLE_KEY_ID: z.string().regex(/^[A-Z0-9]{10}$/).optional(),
  APPLE_PRIVATE_KEY: z.string().min(100).optional(),
  // KEY-01: AES-256-GCM key (base64, 32 bytes) for provider tokens stored at rest.
  FIELD_ENC_KEY: z.string().optional().refine((v) => v === undefined || Buffer.from(v, 'base64').length === 32, 'FIELD_ENC_KEY must be 32 bytes, base64'),
  // Run BullMQ workers in this process (set false on API-only replicas when workers run separately).
  WORKER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Swagger UI at /docs — on by default only outside production.
  SWAGGER_ENABLED: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
  // Local development only: admin login with e-mail + password, no TOTP. Refused outside NODE_ENV=development.
  ADMIN_DEV_SKIP_MFA: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // KVKK data controller, filled into the legal texts ({{controller.*}}); required in production.
  LEGAL_CONTROLLER_NAME: z.string().trim().min(2).max(200).default('Casalume (geliştirme)'),
  LEGAL_CONTROLLER_ADDRESS: z.string().trim().min(2).max(300).default('Adres henüz tanımlanmadı'),
  LEGAL_CONTACT_EMAIL: z.email().default('kvkk@casalume.local'),
  LEGAL_KEP_ADDRESS: z.string().trim().max(200).optional(),
  // Error reporting (Sentry). Unset = off. Reports carry no personal data (src/common/monitoring.ts).
  SENTRY_DSN: z.url().optional(),
  SENTRY_ENVIRONMENT: z.string().max(40).optional(),
  SENTRY_RELEASE: z.string().max(80).optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
});

export type Config = z.infer<typeof Env> & { corsOrigins: string[]; isProd: boolean; swaggerEnabled: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration — ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.STORAGE_DRIVER === 's3' && !cfg.S3_BUCKET) throw new Error('Invalid configuration — S3_BUCKET is required for STORAGE_DRIVER=s3');
  const corsOrigins = cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  const appleKey = [cfg.APPLE_TEAM_ID, cfg.APPLE_KEY_ID, cfg.APPLE_PRIVATE_KEY].filter(Boolean).length;
  if (appleKey > 0 && appleKey < 3) throw new Error('Invalid configuration — APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY go together');
  if (cfg.APPLE_PRIVATE_KEY && !cfg.FIELD_ENC_KEY) throw new Error('Invalid configuration — FIELD_ENC_KEY is required to store Apple refresh tokens');
  // AUT-01: admin MFA can be switched off only on a developer machine, never on a shared or public deployment.
  if (cfg.ADMIN_DEV_SKIP_MFA && cfg.NODE_ENV !== 'development') throw new Error('Invalid configuration — ADMIN_DEV_SKIP_MFA is only allowed with NODE_ENV=development');
  const isProd = cfg.NODE_ENV === 'production';
  if (isProd) {
    const problems: string[] = [];
    if (!cfg.PUBLIC_BASE_URL.startsWith('https://')) problems.push('PUBLIC_BASE_URL must use https');
    if (corsOrigins.includes('*')) problems.push('CORS_ORIGINS must not contain *');
    if (!cfg.WEB_APP_URL.startsWith('https://')) problems.push('WEB_APP_URL must use https');
    if (!cfg.ADMIN_APP_URL.startsWith('https://')) problems.push('ADMIN_APP_URL must use https');
    if (cfg.MAIL_TRANSPORT !== 'smtp' || !cfg.SMTP_URL) problems.push('MAIL_TRANSPORT=smtp with SMTP_URL is required');
    if (cfg.PUSH_TRANSPORT !== 'expo') problems.push('PUSH_TRANSPORT=expo is required');
    // The legal texts must name the real data controller (KVKK m.10).
    if (!env.LEGAL_CONTROLLER_NAME || !env.LEGAL_CONTROLLER_ADDRESS || !env.LEGAL_CONTACT_EMAIL) problems.push('LEGAL_CONTROLLER_NAME, LEGAL_CONTROLLER_ADDRESS and LEGAL_CONTACT_EMAIL are required');
    if (cfg.REVENUECAT_API_KEY && !cfg.REVENUECAT_WEBHOOK_SECRET) problems.push('REVENUECAT_WEBHOOK_SECRET (HMAC signing) is required with RevenueCat');
    // Account deletion must revoke Apple tokens (App Store 5.1.1(v)), which needs the Apple key.
    if (cfg.APPLE_CLIENT_IDS.trim() && !cfg.APPLE_PRIVATE_KEY) problems.push('APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY are required with Sign in with Apple');
    const secrets = [cfg.JWT_SECRET, cfg.IMAGE_URL_SECRET, cfg.DEVICE_PEPPER, cfg.AI_INTERNAL_TOKEN, ...(cfg.FIELD_ENC_KEY ? [cfg.FIELD_ENC_KEY] : [])];
    if (new Set(secrets).size < secrets.length) {
      problems.push('each secret must be distinct');
    }
    if (problems.length) throw new Error(`Unsafe production configuration — ${problems.join('; ')}`);
  }
  return { ...cfg, corsOrigins, isProd, swaggerEnabled: cfg.SWAGGER_ENABLED ?? !isProd };
}

export const CONFIG = Symbol('CONFIG');

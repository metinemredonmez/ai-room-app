import type { Request } from 'express';
import { createHmac } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalStore } from './images/object-store.js';
import { PUSH_TOKEN_RE, PushService, maskToken } from './push/push.service.js';
import { BillingService } from './billing/billing.service.js';
import { base32Decode, base32Encode, hashBackupCode, newBackupCode, normalizeBackupCode, totpAt, verifyTotp } from './auth/crypto.js';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { AdminController } from './admin/admin.controller.js';
import { AdminSelfController, AdminsController } from './admin/admins.controller.js';
import { AdminDataRequestsController, AdminLegalController } from './kvkk/kvkk.controller.js';
import { MIN_ROLE, MinRole, atLeast, isAdminRole } from './admin/roles.js';
import { AdminGuard, TokensService } from './auth/tokens.service.js';
import { AdminMarketingController } from './marketing/marketing.controller.js';
import { AdminBlogController } from './blog/blog.controller.js';
import { AdminBroadcastsController } from './broadcasts/broadcasts.controller.js';
import { AdminSupportController } from './support/support.controller.js';
import { AdminAnalyticsController } from './admin/analytics.controller.js';
import { AdminPlansController, AdminSubscriptionsController } from './billing/billing-admin.controller.js';
import { AdminOrgsController } from './orgs/orgs.admin.controller.js';
import { resolveClientIp } from './common/http.js';
import { EmailTokensService } from './auth/email-tokens.service.js';
import { loadConfig, type Config } from './config.js';
import { isUuid, sniffMime } from './images/images.service.js';
import { UsageService } from './usage/usage.service.js';

const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890')); // RFC 6238 appendix B seed (SHA-1)

describe('TOTP (AUT-01)', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpAt(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(totpAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpAt(RFC_SECRET, Math.floor(1234567890 / 30))).toBe('005924');
  });

  it('accepts ±1 step and rejects anything else', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 3), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
  });

  it('round-trips base32', () => {
    const buf = Buffer.from([0, 1, 2, 250, 255, 7, 9]);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });
});

describe('client IP resolution (NET-03)', () => {
  const req = (xff: string | undefined, peer = '10.0.0.5') =>
    ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: peer } }) as unknown as Request;

  it('ignores X-Forwarded-For when no proxy is trusted', () => {
    expect(resolveClientIp(req('1.2.3.4'), 0)).toBe('10.0.0.5');
  });

  it('takes the entry appended by the trusted proxy, not the spoofable first one', () => {
    expect(resolveClientIp(req('6.6.6.6, 203.0.113.9'), 1)).toBe('203.0.113.9');
    expect(resolveClientIp(req('6.6.6.6, 203.0.113.9, 10.1.1.1'), 2)).toBe('203.0.113.9');
  });

  it('falls back to the peer when the chain is shorter than the hop count', () => {
    expect(resolveClientIp(req(undefined), 1)).toBe('10.0.0.5');
  });
});

describe('upload signature sniffing (FIL-01)', () => {
  it('recognises real image signatures only', () => {
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('89504e470d0a1a0a0000000000', 'hex'))).toBe('image/png');
    expect(sniffMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(Buffer.from('%PDF-1.7 hello world'))).toBeNull();
    expect(sniffMime(Buffer.from('<svg xmlns="x"></svg>'))).toBeNull();
  });

  it('only accepts UUID image ids (no path traversal)', () => {
    expect(isUuid('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true);
    expect(isUuid('../../etc/passwd')).toBe(false);
    expect(isUuid('0f8fad5b-d9cb-469f-a165-70867728950e.jpg')).toBe(false);
  });
});

describe('configuration (KEY-01)', () => {
  const base = {
    DATABASE_URL: 'postgresql://x@localhost/db',
    JWT_SECRET: 'a'.repeat(40),
    IMAGE_URL_SECRET: 'b'.repeat(40),
    DEVICE_PEPPER: 'c'.repeat(40),
    AI_INTERNAL_TOKEN: 'd'.repeat(40),
  };

  it('allows switching admin MFA off only in development (AUT-01)', () => {
    expect(loadConfig({ ...base, ADMIN_DEV_SKIP_MFA: 'true' }).ADMIN_DEV_SKIP_MFA).toBe(true);
    expect(loadConfig(base).ADMIN_DEV_SKIP_MFA).toBe(false);
    for (const NODE_ENV of ['production', 'test']) {
      expect(() => loadConfig({ ...base, NODE_ENV, ADMIN_DEV_SKIP_MFA: 'true' })).toThrow(/ADMIN_DEV_SKIP_MFA/);
    }
  });

  it('takes a panel key only when it is long enough', () => {
    expect(loadConfig({ ...base, ADMIN_PANEL_KEY: 'p'.repeat(64) }).ADMIN_PANEL_KEY).toHaveLength(64);
    expect(() => loadConfig({ ...base, ADMIN_PANEL_KEY: 'short' })).toThrow();
  });

  it('refuses missing or default-looking secrets', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: undefined })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, JWT_SECRET: 'change-me-change-me-change-me-change-me' })).toThrow(/default/);
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/32/);
  });

  it('refuses an unsafe production profile', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://api.example.com' })).toThrow(/https/);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://api.example.com', CORS_ORIGINS: '*' }),
    ).toThrow(/CORS/);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://api.example.com', IMAGE_URL_SECRET: base.JWT_SECRET }),
    ).toThrow(/distinct/);
    const prod = { ...base, NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://api.example.com', WEB_APP_URL: 'https://casalume.example.com', ADMIN_APP_URL: 'https://admin.casalume.example.com' };
    expect(() => loadConfig({ ...prod, ADMIN_APP_URL: 'http://admin.casalume.example.com' })).toThrow(/ADMIN_APP_URL/);
    expect(() => loadConfig(prod)).toThrow(/SMTP/);
    const mail = { MAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtps://u:p@smtp.example.com' };
    expect(() => loadConfig({ ...prod, ...mail })).toThrow(/PUSH_TRANSPORT/);
    // KVKK m.10: the legal texts must name the real data controller, never the development defaults.
    expect(() => loadConfig({ ...prod, ...mail, PUSH_TRANSPORT: 'expo' })).toThrow(/LEGAL_CONTROLLER_NAME/);
    expect(loadConfig({ ...prod, ...mail, PUSH_TRANSPORT: 'expo', LEGAL_CONTROLLER_NAME: 'Casalume Teknoloji A.Ş.', LEGAL_CONTROLLER_ADDRESS: 'İstanbul', LEGAL_CONTACT_EMAIL: 'kvkk@casalume.example.com' }).isProd).toBe(true);
  });
});

describe('e-mailed links (MAIL-01 / AUT-03)', () => {
  const svc = new EmailTokensService({} as never, {} as never, { WEB_APP_URL: 'https://casalume.example.com' } as Config);

  it('builds links only from the configured origin and keeps the token in the fragment', () => {
    const url = new URL(svc.link('RESET_PASSWORD', 'tok_123'));
    expect(url.origin).toBe('https://casalume.example.com');
    expect(url.pathname).toBe('/sifre-sifirla');
    expect(url.search).toBe('');
    expect(url.hash).toBe('#token=tok_123');
    expect(new URL(svc.link('VERIFY_EMAIL', 'x')).pathname).toBe('/eposta-dogrula');
  });
});

describe('budget brake (RES-01 / AI cost)', () => {
  const make = (spent: number, dailyBudgetUsd: number) => {
    const prisma = { aiUsage: { aggregate: async () => ({ _sum: { costUsd: spent } }) } };
    const settings = { current: { dailyBudgetUsd, budgetBrakeMode: 'free_paused' } };
    return new UsageService(prisma as never, settings as never);
  };

  it('classifies spend against the daily budget', async () => {
    expect((await make(1, 0).budget()).state).toBe('normal'); // 0 = unlimited
    expect((await make(7, 10).budget()).state).toBe('normal');
    expect((await make(8, 10).budget()).state).toBe('warning');
    expect((await make(10, 10).budget()).state).toBe('exceeded');
    expect((await make(12.5, 10).budget()).brakeMode).toBe('free_paused');
  });
});

describe('RevenueCat webhook authentication (yoga BE-01 lesson: verify before writing)', () => {
  const secret = 'whsec_test_0123456789abcdef';
  const auth = 'Bearer rc-webhook-auth-0123456789';
  const svc = (cfg: Partial<Record<string, string>>) =>
    new BillingService({} as never, {} as never, { CREDIT_PACKS: 'casalume_credits_10:10', ...cfg } as never, {} as never);
  const body = Buffer.from(JSON.stringify({ api_version: '1.0', event: { id: 'evt_1', type: 'INITIAL_PURCHASE' } }));
  const sign = (t: number, b: Buffer = body) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.`).update(b).digest('hex')}`;
  const now = 1_800_000_000_000;
  const t = now / 1000;

  it('is disabled (404) when nothing is configured', () => {
    expect(() => svc({}).verify({}, body, now)).toThrow(/Bulunamadı/);
  });

  it('accepts a valid HMAC signature and Authorization header', () => {
    expect(() => svc({ REVENUECAT_WEBHOOK_SECRET: secret, REVENUECAT_WEBHOOK_AUTH: auth }).verify({ authorization: auth, 'x-revenuecat-webhook-signature': sign(t) }, body, now)).not.toThrow();
  });

  it('rejects tampered bodies, stale timestamps and wrong auth', () => {
    const s = svc({ REVENUECAT_WEBHOOK_SECRET: secret, REVENUECAT_WEBHOOK_AUTH: auth });
    const tampered = Buffer.from(body.toString().replace('INITIAL_PURCHASE', 'RENEWAL'));
    expect(() => s.verify({ authorization: auth, 'x-revenuecat-webhook-signature': sign(t) }, tampered, now)).toThrow(/İmza/);
    expect(() => s.verify({ authorization: auth, 'x-revenuecat-webhook-signature': sign(t - 301) }, body, now)).toThrow(/İmza/);
    expect(() => s.verify({ authorization: 'Bearer nope', 'x-revenuecat-webhook-signature': sign(t) }, body, now)).toThrow(/İmza/);
    expect(() => s.verify({ authorization: auth }, body, now)).toThrow(/İmza/);
  });
});

describe('object store (local driver)', () => {
  it('puts, reads and deletes by server-generated key', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'casalume-store-'));
    const store = new LocalStore(dir);
    await store.put('0f8fad5b-d9cb-469f-a165-70867728950e.jpg', Buffer.from('jpeg-bytes'), 'image/jpeg');
    expect((await store.get('0f8fad5b-d9cb-469f-a165-70867728950e.jpg'))?.toString()).toBe('jpeg-bytes');
    await store.delete(['0f8fad5b-d9cb-469f-a165-70867728950e.jpg']);
    expect(await store.get('0f8fad5b-d9cb-469f-a165-70867728950e.jpg')).toBeNull();
    expect(await store.health()).toBe('ok');
  });
});

describe('push notifications (LOG-02 / AZ-01)', () => {
  const token = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

  it('accepts only Expo push tokens', () => {
    expect(PUSH_TOKEN_RE.test(token)).toBe(true);
    expect(PUSH_TOKEN_RE.test('ExpoPushToken[abcdefghij_-1234]')).toBe(true);
    for (const bad of ['', 'fcm:abc', 'ExponentPushToken[]', 'ExponentPushToken[a b c d e f g h]', `${token}\n`, 'https://evil.example']) {
      expect(PUSH_TOKEN_RE.test(bad)).toBe(false);
    }
    expect(maskToken(token)).not.toContain('xxxxxxxxxxxxxxxx');
  });

  it('drops devices Expo reports as unregistered and keeps receipt ids for the rest', async () => {
    const deleted: unknown[] = [];
    const prisma = { pushToken: { deleteMany: async (q: unknown) => void deleted.push(q) } };
    const svc = new PushService(prisma as never, { DATA_DIR: tmpdir(), PUSH_TRANSPORT: 'expo' } as Config);
    const receipts = await svc.handleTickets(
      ['ExponentPushToken[aaaaaaaaaaaa]', 'ExponentPushToken[bbbbbbbbbbbb]', 'ExponentPushToken[cccccccccccc]'],
      [{ status: 'ok', id: 'r1' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }, { status: 'error', details: { error: 'MessageRateExceeded' } }],
    );
    expect(receipts).toEqual({ r1: 'ExponentPushToken[aaaaaaaaaaaa]' });
    expect(deleted).toEqual([{ where: { token: { in: ['ExponentPushToken[bbbbbbbbbbbb]'] } } }]);
  });
});

describe('admin recovery codes (AUT-04)', () => {
  it('are unambiguous, normalise loosely and hash with the pepper', () => {
    const code = newBackupCode();
    expect(code).toMatch(/^[A-HJKMNP-TV-Z2-9]{5}-[A-HJKMNP-TV-Z2-9]{5}$/);
    expect(normalizeBackupCode(` ${code.toLowerCase().replace('-', ' - ')} `)).toBe(code.replace('-', ''));
    for (const bad of ['', 'ABCDE-FGHI', 'ABCDE-FGHIO', '0000000000', 'ABCDE-FGHIJK', "ABCDE'; --"]) expect(normalizeBackupCode(bad)).toBeNull();
    const n = normalizeBackupCode(code)!;
    expect(hashBackupCode('pepper-a', n)).not.toBe(hashBackupCode('pepper-b', n));
    expect(new Set(Array.from({ length: 200 }, newBackupCode)).size).toBe(200);
  });

  it('regeneration needs a fresh code; a wrong one is a capped 403 that leaves the session alone (AUT-03)', async () => {
    const hits: string[] = [];
    const limiter = { hit: async (l: { name: string }, key: string) => void hits.push(`${l.name}:${key}`) };
    const security = { claimTotp: async (_u: unknown, otp: string) => otp === '654321', regenerateBackupCodes: async () => ['NEW01-CODES'], notify: () => {} };
    const audit = { record: async () => {} };
    const users = { get: async () => ({ id: 'u1', totpSecret: 'S', totpLastStep: null }) };
    const ctrl = new AdminSelfController({} as never, users as never, security as never, audit as never, {} as never, limiter as never);
    const call = (otp: string) => ctrl.regenerate({ userId: 'u1' } as never, { otp }, { clientIp: '203.0.113.9' } as never);

    await expect(call('123456')).rejects.toMatchObject({ status: 403, code: 'step_up_failed' });
    await expect(call('654321')).resolves.toEqual({ backupCodes: ['NEW01-CODES'] });
    expect(hits).toEqual(['admin-stepup:u1', 'admin-stepup:u1']);
  });
});

describe('admin roles (AZ-01 / AZ-05)', () => {
  it('orders roles and never treats USER as admin', () => {
    expect(isAdminRole('USER')).toBe(false);
    expect(atLeast('SUPER_ADMIN', 'ADMIN')).toBe(true);
    expect(atLeast('SUPPORT', 'EDITOR')).toBe(false);
    expect(atLeast('USER', 'SUPPORT')).toBe(false);
  });

  it('every admin route declares its least role', () => {
    const reflector = new Reflector();
    const missing: string[] = [];
    for (const ctrl of [AdminController, AdminSelfController, AdminsController, AdminLegalController, AdminDataRequestsController, AdminBroadcastsController, AdminMarketingController, AdminBlogController, AdminSupportController, AdminAnalyticsController, AdminPlansController, AdminSubscriptionsController, AdminOrgsController]) {
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const handler = (ctrl.prototype as unknown as Record<string, unknown>)[name];
        if (name === 'constructor' || typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        if (!reflector.getAllAndOverride(MIN_ROLE, [handler, ctrl])) missing.push(`${ctrl.name}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('revenue needs ADMIN; usage analytics are open to SUPPORT (AZ-01)', () => {
    const role = (name: 'revenue' | 'engagement' | 'cohorts') => Reflect.getMetadata(MIN_ROLE, AdminAnalyticsController.prototype[name]);
    expect([role('revenue'), role('engagement'), role('cohorts')]).toEqual(['ADMIN', 'SUPPORT', 'SUPPORT']);
  });

  it('the plans catalog and subscriber sync are changed by ADMIN only; SUPPORT reads (AZ-01)', () => {
    const r = (proto: object, name: string) => Reflect.getMetadata(MIN_ROLE, (proto as Record<string, unknown>)[name] as object);
    expect([r(AdminPlansController.prototype, 'catalog'), r(AdminPlansController.prototype, 'save')]).toEqual(['SUPPORT', 'ADMIN']);
    expect([r(AdminSubscriptionsController.prototype, 'list'), r(AdminSubscriptionsController.prototype, 'sync')]).toEqual(['SUPPORT', 'ADMIN']);
  });

  it('firms: SUPPORT reads, only ADMIN changes (AZ-01/AZ-05)', () => {
    const r = (name: string) => Reflect.getMetadata(MIN_ROLE, (AdminOrgsController.prototype as unknown as Record<string, object>)[name]);
    expect(['list', 'detail'].map(r)).toEqual(['SUPPORT', 'SUPPORT']);
    expect(['create', 'update', 'credits', 'addMember', 'updateMember', 'removeMember'].map(r)).toEqual(Array(6).fill('ADMIN'));
  });

  const guardFor = (role: string, declared?: 'SUPPORT' | 'ADMIN' | 'SUPER_ADMIN', amr = ['pwd', 'otp'], panelKey: string | null = null) => {
    class Probe {
      handler() {}
    }
    if (declared) MinRole(declared)(Probe.prototype, 'handler', Object.getOwnPropertyDescriptor(Probe.prototype, 'handler')!);
    const req = { headers: { authorization: 'Bearer t' }, path: '/v1/admin/x' } as unknown as Request & { auth?: { role: string } };
    const tokens = { verify: async () => ({ sub: 'u1', ver: 1, typ: 'access', amr }), devSkipMfa: false, panelKey };
    const prisma = { user: { findUnique: async () => ({ id: 'u1', role, status: 'ACTIVE', tokenVersion: 1 }) } };
    const guard = new AdminGuard(tokens as never, prisma as never, new Reflector());
    const ctx = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => Probe.prototype.handler, getClass: () => Probe };
    return { run: () => guard.canActivate(ctx as never), req };
  };

  it('re-checks the role from the database on each request', async () => {
    await expect(guardFor('SUPPORT', 'ADMIN').run()).rejects.toMatchObject({ status: 403 });
    await expect(guardFor('USER', 'SUPPORT').run()).rejects.toMatchObject({ status: 403 });
    const ok = guardFor('SUPER_ADMIN', 'ADMIN');
    await expect(ok.run()).resolves.toBe(true);
    expect(ok.req.auth?.role).toBe('SUPER_ADMIN');
  });

  it('denies a route that declares no role (fail closed)', async () => {
    await expect(guardFor('SUPER_ADMIN').run()).rejects.toMatchObject({ status: 403 });
  });

  it('accepts a code-less panel login only while ADMIN_PANEL_KEY is set (owner decision)', async () => {
    await expect(guardFor('SUPER_ADMIN', 'ADMIN', ['pwd', 'panel'], null).run()).rejects.toMatchObject({ status: 401 });
    await expect(guardFor('SUPER_ADMIN', 'ADMIN', ['pwd', 'panel'], 'k'.repeat(64)).run()).resolves.toBe(true);
    await expect(guardFor('SUPER_ADMIN', 'ADMIN', ['pwd'], 'k'.repeat(64)).run()).rejects.toMatchObject({ status: 401 });
  });

  it('recognises the panel only by its exact key', () => {
    const key = 'k'.repeat(64);
    const on = new TokensService({} as never, { JWT_SECRET: 'j'.repeat(40), ADMIN_DEV_SKIP_MFA: false, ADMIN_PANEL_KEY: key } as never);
    expect(on.isPanel(key)).toBe(true);
    expect(on.isPanel(key.slice(1))).toBe(false);
    expect(on.isPanel(`${key}x`)).toBe(false);
    expect(on.isPanel(undefined)).toBe(false);
    expect(on.isPanel([key])).toBe(false);
    const off = new TokensService({} as never, { JWT_SECRET: 'j'.repeat(40), ADMIN_DEV_SKIP_MFA: false } as never);
    expect(off.isPanel(key)).toBe(false);
    expect(off.isPanel('')).toBe(false);
  });
});


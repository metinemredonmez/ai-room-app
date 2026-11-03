import type { Request } from 'express';
import { base32Decode, base32Encode, totpAt, verifyTotp } from './auth/crypto.js';
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
    const prod = { ...base, NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://api.example.com', WEB_APP_URL: 'https://airoom.example.com' };
    expect(() => loadConfig(prod)).toThrow(/SMTP/);
    expect(loadConfig({ ...prod, MAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtps://u:p@smtp.example.com' }).isProd).toBe(true);
  });
});

describe('e-mailed links (MAIL-01 / AUT-03)', () => {
  const svc = new EmailTokensService({} as never, {} as never, { WEB_APP_URL: 'https://airoom.example.com' } as Config);

  it('builds links only from the configured origin and keeps the token in the fragment', () => {
    const url = new URL(svc.link('RESET_PASSWORD', 'tok_123'));
    expect(url.origin).toBe('https://airoom.example.com');
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

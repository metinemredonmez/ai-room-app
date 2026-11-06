import { alertsDiff, appFrame, AlertSettingsSchema, classify, DEFAULT_ALERTS, normalizeMessage, parseAlerts } from './alerts/alerts.rules.js';
import { reportError, setErrorSink } from './common/monitoring.js';

// API.md §7.41: our own error alarm. The same failure with different ids is one group; personal data never reaches a
// group or a mail; jobs and HTTP errors are told apart; reportError feeds the alarm even without Sentry.

describe('error grouping', () => {
  it('takes ids, numbers, e-mails, IPs and tokens out of a message', () => {
    const m = normalizeMessage('User 0b8f3a3c-5a3e-4c1b-9b8e-2f1c3d4e5f60 (ayse@example.com, 85.108.62.63) failed after 3021 ms with Bearer abcdefghijklmnop');
    expect(m).not.toMatch(/ayse|85\.108|abcdefghijklmnop|0b8f3a3c/);
    expect(m).toContain('<id>');
    expect(m).toContain('#');
  });

  it('the same failure with different ids is one group; another place is another group', () => {
    const err = (id: string) => {
      const e = new Error(`Design ${id} not found`);
      e.stack = `Error: x\n    at DesignsService.get (/srv/app/apps/backend/dist/designs/designs.service.js:120:11)\n    at node:internal/x`;
      return e;
    };
    const a = classify(err('0b8f3a3c-5a3e-4c1b-9b8e-2f1c3d4e5f60'), { tags: { route: 'GET /v1/designs/:id' }, requestId: 'r1' });
    const b = classify(err('11111111-2222-4333-8444-555555555555'), { tags: { route: 'GET /v1/designs/:id' }, requestId: 'r2' });
    const c = classify(err('11111111-2222-4333-8444-555555555555'), { tags: { route: 'POST /v1/designs' } });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
    expect(a).toMatchObject({ kind: 'http', location: 'GET /v1/designs/:id · dist/designs/designs.service.js' });
  });

  it('jobs, HTTP and other errors are told apart; the frame is our code, never node_modules', () => {
    expect(classify(new Error('x'), { tags: { queue: 'maintenance', job: 'retention' } })).toMatchObject({ kind: 'job', location: expect.stringContaining('maintenance:retention') });
    expect(classify('plain string', {}).kind).toBe('other');
    expect(appFrame('Error\n    at x (/app/node_modules/pg/lib/client.js:1:1)\n    at y (/app/src/jobs/jobs.service.ts:9:9)')).toBe('src/jobs/jobs.service.ts');
    expect(appFrame(undefined)).toBe('');
  });
});

describe('alert settings', () => {
  it('start on for the SUPER_ADMINs; bounds hold; junk falls back to the defaults', () => {
    expect(parseAlerts(undefined)).toEqual({ settings: DEFAULT_ALERTS, ok: true });
    expect(DEFAULT_ALERTS.superAdmins && DEFAULT_ALERTS.errors.enabled && DEFAULT_ALERTS.purchases.enabled).toBe(true);
    const ok = (mut: (s: typeof DEFAULT_ALERTS) => void) => {
      const s = structuredClone(DEFAULT_ALERTS);
      mut(s);
      return AlertSettingsSchema.safeParse(s).success;
    };
    expect(ok((s) => (s.extraRecipients = ['a@b.co', 'c@d.co']))).toBe(true);
    expect(ok((s) => (s.extraRecipients = ['not-an-email']))).toBe(false);
    expect(ok((s) => (s.extraRecipients = Array.from({ length: 6 }, (_, i) => `x${i}@y.co`)))).toBe(false);
    expect(ok((s) => (s.errors.repeatMinutes = 5))).toBe(false);
    expect(ok((s) => (s.disk.thresholdPct = 100))).toBe(false);
    expect(parseAlerts({ disk: { enabled: 'yes' } }).ok).toBe(false);
    const next = structuredClone(DEFAULT_ALERTS);
    next.purchases.enabled = false;
    next.extraRecipients = ['ops@example.com'];
    expect(alertsDiff(DEFAULT_ALERTS, next)).toEqual(['alıcılar: 0 → 1', 'purchases: {"enabled":true} → {"enabled":false}']);
  });
});

describe('reportError feeds our alarm', () => {
  it('without Sentry, every reported error reaches the sink; a failing sink never throws', () => {
    const seen: string[] = [];
    setErrorSink((e) => seen.push((e as Error).message));
    reportError(new Error('boom'), { tags: { route: 'GET /x' } });
    setErrorSink(() => {
      throw new Error('sink broke');
    });
    expect(() => reportError(new Error('again'))).not.toThrow();
    setErrorSink(null);
    expect(seen).toEqual(['boom']);
  });
});

describe('client errors (API.md §7.43)', () => {
  it('one group per bug across app versions and ids; origin, query and line numbers stay out', async () => {
    const { classifyClient, clientFrame, ClientErrorSchema } = await import('./alerts/alerts.rules.js');
    const stack = (v: string) => `TypeError: x is undefined\n    at Studio (https://casalume.app/_next/static/chunks/app.js?v=${v}:12:345)`;
    const a = classifyClient({ platform: 'web', appVersion: '1.0.0', message: 'Cannot read 0b8f3a3c-5a3e-4c1b-9b8e-2f1c3d4e5f60 of undefined', stack: stack('1'), route: '/tasarim/0b8f3a3c-5a3e-4c1b-9b8e-2f1c3d4e5f60?ref=x' });
    const b = classifyClient({ platform: 'web', appVersion: '1.1.0', message: 'Cannot read 11111111-2222-4333-8444-555555555555 of undefined', stack: stack('2'), route: '/tasarim/11111111-2222-4333-8444-555555555555' });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.kind).toBe('client');
    expect(clientFrame(stack('1'))).toBe('at Studio (/_next/static/chunks/app.js)');
    expect(clientFrame('Error: failed for ayse@example.com\nStudio@https://casalume.app/_next/static/chunks/app.js:3:4')).toBe('Studio@/_next/static/chunks/app.js');
    expect(classifyClient({ platform: 'ios', message: 'x' }).fingerprint).not.toBe(classifyClient({ platform: 'web', message: 'x' }).fingerprint);
    expect(ClientErrorSchema.safeParse({ platform: 'web', message: 'x', extra: 1 }).success).toBe(false);
    expect(ClientErrorSchema.safeParse({ platform: 'desktop', message: 'x' }).success).toBe(false);
    expect(ClientErrorSchema.safeParse({ platform: 'web', message: '' }).success).toBe(false);
    expect(ClientErrorSchema.safeParse({ platform: 'web', message: 'x', appVersion: '1.0; drop' }).success).toBe(false);
  });
});

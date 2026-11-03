import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ErrorEvent } from '@sentry/node';
import { SkipVersionGate, VersionGate } from './common/app-version.js';
import { maskText, scrubBreadcrumb, scrubEvent } from './common/monitoring.js';
import { clientVersion, compareVersions } from './common/semver.js';
import { SettingsSchema, type SettingsService } from './settings/settings.service.js';

describe('force update (426)', () => {
  const settings = {
    current: {
      appVersions: {
        ios: { min: '1.4.0', latest: '1.6.2', storeUrl: 'https://apps.apple.com/app/id123' },
        android: { min: '0.0.0', latest: '1.6.2', storeUrl: '' },
      },
    },
  } as unknown as SettingsService;
  const gate = new VersionGate(settings, new Reflector());
  class Ctrl { open() {} health() {} }
  SkipVersionGate()(Ctrl.prototype, 'health', Object.getOwnPropertyDescriptor(Ctrl.prototype, 'health')!);
  const ctx = (headers: Record<string, string>, handler: 'open' | 'health' = 'open') =>
    ({ getType: () => 'http', getHandler: () => Ctrl.prototype[handler], getClass: () => Ctrl, switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;

  it('compares versions numerically and treats junk as the oldest', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.4.0', '1.4.0')).toBe(0);
    expect(compareVersions('0.9.12', '1.0.0')).toBe(-1);
    expect(clientVersion('1.2')).toBe('0.0.0');
    expect(clientVersion('1.2.3-beta')).toBe('0.0.0');
    expect(clientVersion(undefined)).toBe('0.0.0');
  });

  it('lets current builds, web and requests without a platform through', () => {
    expect(gate.canActivate(ctx({ 'x-app-platform': 'ios', 'x-app-version': '1.4.0' }))).toBe(true);
    expect(gate.canActivate(ctx({ 'x-app-platform': 'IOS', 'x-app-version': '2.0.0' }))).toBe(true);
    expect(gate.canActivate(ctx({ 'x-app-platform': 'android', 'x-app-version': '0.1.0' }))).toBe(true);
    expect(gate.canActivate(ctx({ 'x-app-platform': 'web', 'x-app-version': '0.0.1' }))).toBe(true);
    expect(gate.canActivate(ctx({}))).toBe(true);
  });

  it('answers 426 with the store link to an old or unversioned mobile build', () => {
    const old: Record<string, string>[] = [{ 'x-app-platform': 'ios', 'x-app-version': '1.3.9' }, { 'x-app-platform': 'ios' }, { 'x-app-platform': 'ios', 'x-app-version': 'x' }];
    for (const headers of old) {
      expect(() => gate.canActivate(ctx(headers))).toThrow(expect.objectContaining({
        status: 426, code: 'update_required', details: { minVersion: '1.4.0', storeUrl: 'https://apps.apple.com/app/id123' },
      }));
    }
  });

  it('never blocks the routes an old build needs to learn about the update', () => {
    expect(gate.canActivate(ctx({ 'x-app-platform': 'ios', 'x-app-version': '1.0.0' }, 'health'))).toBe(true);
  });

  it('only accepts official store links and min ≤ latest in settings', () => {
    const v = (ios: object) => SettingsSchema.shape.appVersions.safeParse({ ios, android: { min: '0.0.0', latest: '0.0.0', storeUrl: '' } }).success;
    expect(v({ min: '1.0.0', latest: '1.2.0', storeUrl: 'https://apps.apple.com/tr/app/ai-room/id1' })).toBe(true);
    expect(v({ min: '1.0.0', latest: '1.2.0', storeUrl: 'https://evil.example.com/apps.apple.com' })).toBe(false);
    expect(v({ min: '1.0.0', latest: '1.2.0', storeUrl: 'http://apps.apple.com/app' })).toBe(false);
    expect(v({ min: '1.3.0', latest: '1.2.0', storeUrl: '' })).toBe(false);
    expect(v({ min: '1.0', latest: '1.2.0', storeUrl: '' })).toBe(false);
  });
});

describe('error reports carry no personal data (LOG-02 / KVKK)', () => {
  it('masks e-mails, tokens, signed URLs, push tokens, IPs and blobs in text', () => {
    const s = maskText(
      'user ayse@example.com Bearer abcdefghijklmnop eyJhbGciOi.eyJzdWIiOi.sig https://api/x.jpg?exp=1&sig=SECRET ExponentPushToken[xyz] 10.1.2.3 data:image/jpeg;base64,AAAA',
    );
    for (const leak of ['ayse@example.com', 'abcdefghijklmnop', 'eyJhbGciOi', 'SECRET', 'xyz]', '10.1.2.3', 'base64,AAAA']) expect(s).not.toContain(leak);
    expect(maskText('x'.repeat(5000)).length).toBeLessThan(1100);
  });

  it('strips user, IP, cookies, body, query, auth headers and stack variables from an event', () => {
    const event = {
      user: { id: 'u1', email: 'a@b.co', ip_address: '1.2.3.4' },
      request: {
        method: 'POST', url: 'https://api.airoom.app/v1/designs?sig=abc', query_string: 'sig=abc', data: '{"password":"p"}', cookies: { s: '1' },
        headers: { authorization: 'Bearer t0k3n-t0k3n', 'x-internal-token': 'secret', 'user-agent': 'AIRoom/1.4.0', 'x-forwarded-for': '1.2.3.4' },
      },
      exception: { values: [{ type: 'Error', value: 'duplicate email ayse@example.com', stacktrace: { frames: [{ function: 'f', vars: { password: 'p' } }] } }] },
      breadcrumbs: [
        { category: 'console', message: '{"level":"info","event":"design_done","userId":"u1","email":"a@b.co"}' },
        { category: 'http', data: { method: 'GET', url: 'https://fal.run/x?key=K', status_code: 200, body: 'secret' } },
      ],
      extra: { requestId: 'r1', token: 'abc', nested: { email: 'x@y.zz', note: 'mail me at x@y.zz' } },
    } as unknown as ErrorEvent;
    const out = JSON.stringify(scrubEvent(event));
    for (const leak of ['u1', 'a@b.co', '1.2.3.4', 'sig=abc', 'password', 't0k3n', 'secret', 'ayse@', 'key=K', 'x@y.zz', '"s":"1"']) expect(out).not.toContain(leak);
    expect(out).toContain('AIRoom/1.4.0');
    expect(out).toContain('design_done');
    expect(out).toContain('r1');
  });

  it('keeps only method, status and a query-less URL on HTTP breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'fetch', data: { method: 'POST', url: 'https://appleid.apple.com/auth/token?code=1', status_code: 400, request_body_size: 9 } })?.data).toEqual({
      method: 'POST', status_code: 400, url: 'https://appleid.apple.com/auth/token',
    });
  });
});

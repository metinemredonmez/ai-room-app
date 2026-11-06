import { randomUUID } from 'node:crypto';
import { deviceLabel, ipPrefix } from './auth/client-info.js';
import { TokensService, UserGuard } from './auth/tokens.service.js';

// API.md §7.37 / SES-04: active sessions. Every sign-in is a session; its access token carries `sid`, so closing the
// session stops that token at once while the person's other devices keep working. Only a shortened IP is kept.

describe('client info (KVKK: shortened IP, readable device)', () => {
  it('keeps /24 of IPv4 and /48 of IPv6, nothing more', () => {
    expect(ipPrefix('85.108.62.63')).toBe('85.108.62.0/24');
    expect(ipPrefix('::ffff:10.1.2.3')).toBe('10.1.2.0/24');
    expect(ipPrefix('2a02:4780:1:2:3:4:5:6')).toBe('2a02:4780:1::/48');
    expect(ipPrefix('2a02:4780::1')).toBe('2a02:4780:0::/48');
    expect(ipPrefix('not-an-ip')).toBe('?');
    expect(ipPrefix(undefined)).toBe('?');
  });

  it('names the device the way a person would', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0';
    expect(deviceLabel(mac)).toBe('Chrome · macOS');
    expect(deviceLabel(iphone)).toBe('Safari · iOS');
    expect(deviceLabel(win)).toBe('Edge · Windows');
    expect(deviceLabel('okhttp/4.12', 'android', '1.4.0')).toBe('Casalume Android 1.4.0');
    expect(deviceLabel('', 'ios', '1.4.0; drop table')).toBe('Casalume iOS');
    expect(deviceLabel('')).toBe('Bilinmeyen cihaz');
  });
});

function setup() {
  const user = { id: randomUUID(), role: 'USER', isGuest: false, status: 'ACTIVE', tokenVersion: 0, lastSeenAt: new Date(), streakDay: '2099-01-01' };
  const sessions = new Map<string, { id: string; userId: string; revokedAt: Date | null; lastUsedAt: Date; device: string }>();
  const refresh: Array<{ id: string; userId: string; familyId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null; revokedAt: Date | null; user: typeof user }> = [];
  const whereMatch = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'not' in v ? row[k] !== (v as { not: unknown }).not : row[k] === v));
  const prisma = {
    authSession: {
      create: async ({ data }: { data: { id: string; userId: string; device: string } }) => void sessions.set(data.id, { ...data, revokedAt: null, lastUsedAt: new Date() }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: { revokedAt: Date } }) => {
        const hit = [...sessions.values()].filter((s) => whereMatch(s as never, where));
        hit.forEach((s) => Object.assign(s, data));
        return { count: hit.length };
      },
      upsert: async ({ where, create, update }: { where: { id: string }; create: { id: string; userId: string; device: string }; update: Record<string, unknown> }) => {
        const s = sessions.get(where.id);
        if (s) Object.assign(s, update);
        else sessions.set(create.id, { ...create, revokedAt: null, lastUsedAt: new Date() });
      },
    },
    refreshToken: {
      create: async ({ data }: { data: { userId: string; familyId: string; tokenHash: string; expiresAt: Date } }) => void refresh.push({ id: randomUUID(), ...data, usedAt: null, revokedAt: null, user }),
      findUnique: async ({ where }: { where: { tokenHash: string } }) => refresh.find((r) => r.tokenHash === where.tokenHash) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = refresh.filter((r) => whereMatch(r as never, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
    user: {
      findUnique: async ({ select }: { select: { authSessions?: { where: { id: string } } } }) => ({
        ...user,
        ...(select.authSessions ? { authSessions: [...sessions.values()].filter((s) => s.id === select.authSessions!.where.id) } : {}),
      }),
      update: async () => user,
    },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  };
  const tokens = new TokensService(prisma as never, { JWT_SECRET: 'x'.repeat(48), ADMIN_DEV_SKIP_MFA: false, ADMIN_PANEL_KEY: undefined } as never);
  const guard = new UserGuard(tokens, prisma as never, { activeDay: async () => ({}) } as never);
  const call = async (accessToken: string) => {
    const req = { headers: { authorization: `Bearer ${accessToken}` } } as Record<string, unknown>;
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as never;
    await guard.canActivate(ctx);
    return req.auth as { sessionId: string | null };
  };
  const client = { device: 'Chrome · macOS', ipPrefix: '85.108.62.0/24' };
  return { user, sessions, tokens, call, client };
}

describe('sessions and instant revocation (SES-04)', () => {
  it('each sign-in is a session; closing one stops its token at once, the other device keeps working', async () => {
    const f = setup();
    const phone = await f.tokens.issueUser(f.user as never, undefined, { method: 'password', client: f.client });
    const laptop = await f.tokens.issueUser(f.user as never, undefined, { method: 'google', client: f.client });
    expect(f.sessions.size).toBe(2);
    const phoneSid = (await f.call(phone.accessToken)).sessionId!;
    const laptopSid = (await f.call(laptop.accessToken)).sessionId!;
    expect(phoneSid).not.toBe(laptopSid);

    expect(await f.tokens.revokeSession(f.user.id, phoneSid)).toBe(true);
    await expect(f.call(phone.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(f.tokens.rotate(phone.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(f.call(laptop.accessToken)).resolves.toMatchObject({ sessionId: laptopSid });
    expect(await f.tokens.revokeSession(randomUUID(), laptopSid)).toBe(false); // someone else's session id: nothing
  });

  it('"close the others" keeps this device; a rotation keeps the same session', async () => {
    const f = setup();
    const a = await f.tokens.issueUser(f.user as never, undefined, { method: 'password', client: f.client });
    const b = await f.tokens.issueUser(f.user as never, undefined, { method: 'password', client: f.client });
    const aSid = (await f.call(a.accessToken)).sessionId!;
    const rotated = await f.tokens.rotate(a.refreshToken, { device: 'Safari · iOS', ipPrefix: '10.0.0.0/24' });
    expect((await f.call(rotated.tokens.accessToken)).sessionId).toBe(aSid);
    expect(f.sessions.get(aSid)!.device).toBe('Safari · iOS');
    expect(await f.tokens.revokeOthers(f.user.id, aSid)).toBe(1);
    await expect(f.call(b.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(f.call(rotated.tokens.accessToken)).resolves.toBeDefined();
  });

  it('a reused refresh token closes its session too (SES-05)', async () => {
    const f = setup();
    const a = await f.tokens.issueUser(f.user as never, undefined, { method: 'password', client: f.client });
    const sid = (await f.call(a.accessToken)).sessionId!;
    await f.tokens.rotate(a.refreshToken);
    await expect(f.tokens.rotate(a.refreshToken)).rejects.toMatchObject({ status: 401 });
    expect(f.sessions.get(sid)!.revokedAt).toBeInstanceOf(Date);
  });
});

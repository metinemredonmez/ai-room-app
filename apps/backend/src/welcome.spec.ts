import { WelcomeService, oauthKey, welcomeEmailKey } from './users/welcome.service.js';

// API.md §7.22: welcome credits. Money-like (each credit is an AI generation we pay for), so the "once per identity"
// rule is tested against the ways people try to collect it again (BUS-01).

type U = { isGuest: boolean; status: string; credits: number };

function setup(amount = 3) {
  const users = new Map<string, U>();
  const ledger: Array<{ userId: string; delta: number; reason: string }> = [];
  const grants = new Set<string>();
  const prisma = {
    $queryRaw: async () => [{ locked: 1 }],
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { credits: { increment: number } } }) => {
        users.get(where.id)!.credits += data.credits.increment;
      },
    },
    creditLedger: {
      findFirst: async ({ where }: { where: { userId: string; reason: string } }) => ledger.find((l) => l.userId === where.userId && l.reason === where.reason) ?? null,
      create: async ({ data }: { data: { userId: string; delta: number; reason: string } }) => void ledger.push(data),
    },
    welcomeGrant: {
      createMany: async ({ data }: { data: Array<{ hash: string }> }) => {
        let count = 0;
        for (const { hash } of data) {
          if (grants.has(hash)) continue;
          grants.add(hash);
          count++;
        }
        return { count };
      },
      deleteMany: async () => ({ count: 0 }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  const settings = { current: { welcomeCredits: amount } };
  const svc = new WelcomeService(prisma as never, settings as never, { DEVICE_PEPPER: 'test-pepper-0123456789abcdef0123' } as never);
  const add = (id: string, u: Partial<U> = {}) => users.set(id, { isGuest: false, status: 'ACTIVE', credits: 0, ...u });
  return { svc, users, ledger, grants, settings, add };
}

describe('welcome credits', () => {
  it('one mailbox is one identity: case, +tags and Gmail dots fold together', () => {
    expect(welcomeEmailKey('Ayse.Yilmaz+casalume@GMAIL.com')).toBe('email:ayseyilmaz@gmail.com');
    expect(welcomeEmailKey('ayse.yilmaz@googlemail.com')).toBe('email:ayseyilmaz@gmail.com');
    expect(welcomeEmailKey('ayse.yilmaz+x@example.com')).toBe('email:ayse.yilmaz@example.com'); // other domains keep dots
    expect(welcomeEmailKey('ＡＹＳＥ@example.com')).toBe('email:ayse@example.com'); // full-width letters (PRS-01)
    expect(oauthKey('apple', '001.abc')).toBe('apple:001.abc');
  });

  it('a verified registered account gets them once; a guest, a banned account or a switched-off setting gets nothing', async () => {
    const { svc, users, ledger, settings, add } = setup(3);
    add('u1');
    expect(await svc.grant('u1', ['email:a@example.com'])).toBe(3);
    expect(users.get('u1')!.credits).toBe(3);
    expect(ledger).toEqual([{ userId: 'u1', delta: 3, reason: 'welcome' }]);
    expect(await svc.grant('u1', ['google:123'])).toBe(0); // a second identity on the same account adds nothing
    add('guest', { isGuest: true });
    add('banned', { status: 'BANNED' });
    expect(await svc.grant('guest', ['email:g@example.com'])).toBe(0);
    expect(await svc.grant('banned', ['email:b@example.com'])).toBe(0);
    settings.current.welcomeCredits = 0;
    add('u2');
    expect(await svc.grant('u2', ['email:c@example.com'])).toBe(0);
  });

  it('deleting the account and signing up again with the same e-mail or Apple account pays nothing (BUS-01)', async () => {
    const { svc, users, add } = setup(2);
    add('first');
    expect(await svc.grant('first', [oauthKey('apple', 's1'), welcomeEmailKey('relay@privaterelay.appleid.com')])).toBe(2);
    users.delete('first'); // account deleted; the identity hashes stay
    add('again');
    expect(await svc.grant('again', [oauthKey('apple', 's1')])).toBe(0);
    add('alias');
    expect(await svc.grant('alias', [welcomeEmailKey('Relay+2@privaterelay.appleid.com')])).toBe(0);
    add('fresh');
    expect(await svc.grant('fresh', [welcomeEmailKey('someone.else@example.com')])).toBe(2);
  });

  it('two accounts racing with the same identity: only the one that records it first is paid', async () => {
    const { svc, add, ledger } = setup(5);
    add('a');
    add('b');
    const key = welcomeEmailKey('same@gmail.com');
    const results = await Promise.all([svc.grant('a', [key]), svc.grant('b', [welcomeEmailKey('s.a.m.e@gmail.com')])]);
    expect(results.sort((x, y) => x - y)).toEqual([0, 5]);
    expect(ledger).toHaveLength(1);
  });

  it('stores only keyed hashes, never the address itself (DAT-01)', async () => {
    const { svc, grants, add } = setup(1);
    add('u');
    await svc.grant('u', [welcomeEmailKey('private@example.com')]);
    const [hash] = [...grants];
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('private');
  });
});

import { randomUUID } from 'node:crypto';
import { Prisma } from './generated/prisma/client.js';
import { DEFAULT_REFERRAL, claimProblem, monthStartIstanbul, normalizeReferralCode, type ReferralSettings } from './referral/referral.rules.js';
import { ReferralService } from './referral/referral.service.js';
import { ledgerKind } from './users/ledger.js';

// API.md §7.30: invite-a-friend. The invitee is paid on entering a code; the inviter only after the invitee's first
// successful design, once, up to a monthly cap (BUS-01: fake sign-ups earn nothing); one invitation per mailbox ever.

const DAY = 24 * 3600 * 1000;
type U = { id: string; email: string | null; emailVerifiedAt: Date | null; isGuest: boolean; status: string; createdAt: Date; credits: number; locale: string };
type R = { id: string; inviterId: string | null; inviteeId: string | null; inviteeIdentityHash: string; status: string; inviteeCredits: number; inviterCredits: number; rejectReason: string | null; createdAt: Date; rewardedAt: Date | null };

function setup(settings: Partial<ReferralSettings> = {}) {
  const users = new Map<string, U>();
  const codes = new Map<string, string>(); // code → userId
  const referrals: R[] = [];
  const ledger: Array<{ userId: string; delta: number; reason: string }> = [];
  const pushes: unknown[] = [];
  const dup = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
  let chain = Promise.resolve();
  const tx = {
    $queryRaw: async () => [],
    referral: {
      create: async ({ data }: { data: Omit<R, 'id' | 'status' | 'rejectReason' | 'createdAt' | 'rewardedAt'> }) => {
        if (referrals.some((r) => r.inviteeId === data.inviteeId || r.inviteeIdentityHash === data.inviteeIdentityHash)) throw dup();
        referrals.push({ id: randomUUID(), status: 'PENDING', rejectReason: null, createdAt: new Date(), rewardedAt: null, ...data });
      },
      count: async ({ where }: { where: { inviterId: string; status: string; rewardedAt: { gte: Date } } }) =>
        referrals.filter((r) => r.inviterId === where.inviterId && r.status === where.status && r.rewardedAt && r.rewardedAt >= where.rewardedAt.gte).length,
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<R> }) => {
        const r = referrals.find((x) => x.id === where.id && x.status === where.status);
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
    },
    user: { update: async ({ where, data }: { where: { id: string }; data: { credits: { increment: number } } }) => void (users.get(where.id)!.credits += data.credits.increment) },
    creditLedger: { create: async ({ data }: { data: { userId: string; delta: number; reason: string } }) => void ledger.push(data) },
  };
  const prisma = {
    $transaction: <T>(fn: (t: typeof tx) => Promise<T>) => {
      const run = chain.then(() => fn(tx));
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
    setting: { findUnique: async () => ({ value: { ...DEFAULT_REFERRAL, enabled: true, ...settings }, updatedAt: new Date(), updatedBy: null }) },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const u = users.get(where.id);
        if (!u) return null;
        const code = [...codes].find(([, id]) => id === u.id)?.[0];
        return { ...u, referralCode: code ? { code } : null, referredBy: referrals.find((r) => r.inviteeId === u.id) ?? null, pushTokens: [{ token: 'ExponentPushToken[x]' }] };
      },
    },
    referralCode: {
      create: async ({ data }: { data: { userId: string; code: string } }) => {
        if (codes.has(data.code)) throw dup();
        codes.set(data.code, data.userId);
        return data;
      },
      findUnique: async ({ where }: { where: { code?: string; userId?: string } }) => {
        if (where.code) return codes.has(where.code) ? { code: where.code, user: users.get(codes.get(where.code)!) } : null;
        const c = [...codes].find(([, id]) => id === where.userId);
        return c ? { code: c[0], userId: c[1] } : null;
      },
    },
    referral: {
      ...tx.referral,
      findFirst: async ({ where }: { where: { inviteeId: string; status: string } }) => referrals.find((r) => r.inviteeId === where.inviteeId && r.status === where.status) ?? null,
      count: async ({ where }: { where: { inviterId: string } }) => referrals.filter((r) => r.inviterId === where.inviterId).length,
      aggregate: async ({ where }: { where: { inviterId: string; status: string } }) => {
        const rows = referrals.filter((r) => r.inviterId === where.inviterId && r.status === where.status);
        return { _count: { _all: rows.length }, _sum: { inviterCredits: rows.reduce((a, r) => a + r.inviterCredits, 0) } };
      },
      findUnique: async ({ where }: { where: { id: string } }) => referrals.find((r) => r.id === where.id) ?? null,
    },
  };
  const push = { send: async (m: unknown[]) => void pushes.push(...m) };
  const svc = new ReferralService(prisma as never, push as never, { DEVICE_PEPPER: 'p'.repeat(32), WEB_APP_URL: 'https://casalume.app' } as never);
  const account = (over: Partial<U> = {}) => {
    const u: U = { id: randomUUID(), email: `${randomUUID().slice(0, 8)}@example.com`, emailVerifiedAt: new Date(), isGuest: false, status: 'ACTIVE', createdAt: new Date(), credits: 0, locale: 'tr', ...over };
    users.set(u.id, u);
    return u;
  };
  return { svc, users, referrals, ledger, pushes, account };
}

async function inviterWithCode(f: ReturnType<typeof setup>, over: Partial<U> = {}) {
  await f.svc.reload();
  const inviter = f.account(over);
  const mine = await f.svc.mine(inviter.id);
  return { inviter, code: mine.code! };
}

describe('referral rules', () => {
  it('who may enter a code: programme on, verified real account, within the window', () => {
    const s = { ...DEFAULT_REFERRAL, enabled: true, claimDays: 14 };
    const now = new Date('2026-11-20T00:00:00Z');
    const ok = { isGuest: false, email: 'a@b.c', emailVerifiedAt: now, createdAt: new Date('2026-11-10T00:00:00Z') };
    expect(claimProblem(ok, s, now)).toBeNull();
    expect(claimProblem(ok, { ...s, enabled: false }, now)).toBe('disabled');
    expect(claimProblem({ ...ok, isGuest: true }, s, now)).toBe('verification_required');
    expect(claimProblem({ ...ok, emailVerifiedAt: null }, s, now)).toBe('verification_required');
    expect(claimProblem({ ...ok, createdAt: new Date('2026-11-01T00:00:00Z') }, s, now)).toBe('claim_closed');
    expect(normalizeReferralCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizeReferralCode('ab')).toBeNull();
    expect(monthStartIstanbul(new Date('2026-11-30T22:30:00Z')).toISOString()).toBe('2026-11-30T21:00:00.000Z'); // already 1 Dec in Istanbul
    expect(ledgerKind('referral_invitee')).toBe('referral');
    expect(ledgerKind('referral_inviter')).toBe('referral');
  });
});

describe('invite a friend', () => {
  it('a verified account gets its code and link; with the programme off there is none', async () => {
    const f = setup();
    const { code } = await inviterWithCode(f);
    expect(code).toMatch(/^[A-HJKMNP-TV-Z2-9]{8}$/);
    const off = setup({ enabled: false });
    await off.svc.reload();
    expect(await off.svc.mine(off.account().id)).toMatchObject({ enabled: false, code: null, link: null });
    const guest = setup();
    await guest.svc.reload();
    expect((await guest.svc.mine(guest.account({ isGuest: true, email: null }).id)).code).toBeNull();
  });

  it('the invitee is paid at once; the inviter only after the invitee’s first design, once', async () => {
    const f = setup({ inviterCredits: 3, inviteeCredits: 2 });
    const { inviter, code } = await inviterWithCode(f);
    const friend = f.account();
    await expect(f.svc.claim(friend.id, code.toLowerCase())).resolves.toEqual({ credits: 2 });
    expect(friend.credits).toBe(2);
    expect(inviter.credits).toBe(0);
    await Promise.all([f.svc.onDesignSucceeded(friend.id), f.svc.onDesignSucceeded(friend.id)]); // two designs finish together
    expect(inviter.credits).toBe(3);
    expect(f.referrals[0].status).toBe('REWARDED');
    expect(f.ledger.map((l) => l.reason)).toEqual(['referral_invitee', 'referral_inviter']);
    expect(f.pushes).toHaveLength(1);
    await f.svc.onDesignSucceeded(friend.id);
    expect(inviter.credits).toBe(3);
  });

  it('one claim per account and per mailbox; not your own code; codes must belong to a real account', async () => {
    const f = setup();
    const { inviter, code } = await inviterWithCode(f, { email: 'davetci@gmail.com' });
    const friend = f.account({ email: 'ayse.kaya@gmail.com' });
    await f.svc.claim(friend.id, code);
    await expect(f.svc.claim(friend.id, code)).rejects.toMatchObject({ status: 409, code: 'already_claimed' });
    const sameMailbox = f.account({ email: 'AyseKaya+yeni@gmail.com' });
    await expect(f.svc.claim(sameMailbox.id, code)).rejects.toMatchObject({ status: 409, code: 'already_claimed' });
    await expect(f.svc.claim(inviter.id, code)).rejects.toMatchObject({ status: 400, code: 'own_code' });
    const alias = f.account({ email: 'davet.ci+2@gmail.com' }); // the inviter's own mailbox, another account
    await expect(f.svc.claim(alias.id, code)).rejects.toMatchObject({ status: 400, code: 'own_code' });
    await expect(f.svc.claim(f.account().id, 'NOSUCH22')).rejects.toMatchObject({ status: 404, code: 'invalid_code' });
    expect(sameMailbox.credits + alias.credits).toBe(0);
  });

  it('only verified, new accounts can claim, and only while the programme is on', async () => {
    const f = setup({ claimDays: 14 });
    const { code } = await inviterWithCode(f);
    await expect(f.svc.claim(f.account({ emailVerifiedAt: null }).id, code)).rejects.toMatchObject({ status: 403 });
    await expect(f.svc.claim(f.account({ createdAt: new Date(Date.now() - 20 * DAY) }).id, code)).rejects.toMatchObject({ status: 409, code: 'claim_closed' });
    const unverifiedInviter = f.account({ emailVerifiedAt: null });
    const off = setup({ enabled: false });
    await off.svc.reload();
    await expect(off.svc.claim(off.account().id, code)).rejects.toMatchObject({ status: 404 });
    expect(unverifiedInviter.credits).toBe(0);
  });

  it('over the monthly cap the reward is not paid; a rejected invitation pays nothing', async () => {
    const f = setup({ monthlyCap: 1, inviterCredits: 3 });
    const { inviter, code } = await inviterWithCode(f);
    const [a, b, c] = [f.account(), f.account(), f.account()];
    for (const x of [a, b, c]) await f.svc.claim(x.id, code);
    await f.svc.onDesignSucceeded(a.id);
    await f.svc.onDesignSucceeded(b.id);
    expect(inviter.credits).toBe(3);
    expect(f.referrals.find((r) => r.inviteeId === b.id)).toMatchObject({ status: 'REJECTED', rejectReason: 'Aylık davet ödülü sınırı doldu' });
    const third = f.referrals.find((r) => r.inviteeId === c.id)!;
    await f.svc.reject(third.id, 'aynı cihazdan çok kayıt');
    await f.svc.onDesignSucceeded(c.id);
    expect(inviter.credits).toBe(3);
    await expect(f.svc.reject(third.id, 'again')).rejects.toMatchObject({ status: 409, code: 'not_pending' });
  });
});

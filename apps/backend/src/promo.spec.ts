import { randomUUID } from 'node:crypto';
import { Prisma } from './generated/prisma/client.js';
import { BatchSchema, CreateCodeSchema, generateCode, maskCode, normalizeCode, proUntilAfter, usable } from './promo/promo.rules.js';
import { PromoService } from './promo/promo.service.js';
import { ledgerKind } from './users/ledger.js';

// API.md §7.29: promotion and gift codes. One use per account and per e-mail identity (BUS-01), a single-use code
// cannot be used twice (BUS-02), one generic answer for any unusable code (no guessing oracle), verified accounts only.

const DAY = 24 * 3600 * 1000;
type Code = { id: string; hash: string; display: string; kind: 'CREDITS' | 'PRO_DAYS'; amount: number; maxRedemptions: number | null; redeemed: number; startsAt: Date | null; endsAt: Date | null; active: boolean; newUsersOnly: boolean; createdAt: Date; campaign: string };
type User = { id: string; email: string | null; emailVerifiedAt: Date | null; isGuest: boolean; createdAt: Date; plan: string; planExpiresAt: Date | null; credits: number };

function setup() {
  const codes: Code[] = [];
  const users = new Map<string, User>();
  const redemptions: Array<{ codeId: string; userId: string | null; identityHash: string }> = [];
  const ledger: Array<{ userId: string; delta: number; reason: string }> = [];
  let chain = Promise.resolve();
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('FROM "PromoCode"')) return codes.filter((c) => c.hash === values[0]).map((c) => ({ ...c }));
      const u = users.get(String(values[0]))!;
      return [{ plan: u.plan, planExpiresAt: u.planExpiresAt }];
    },
    promoRedemption: {
      findFirst: async ({ where }: { where: { codeId: string; OR: Array<{ userId?: string; identityHash?: string }> } }) =>
        redemptions.find((r) => r.codeId === where.codeId && where.OR.some((o) => (o.userId && r.userId === o.userId) || (o.identityHash && r.identityHash === o.identityHash))) ?? null,
      create: async ({ data }: { data: { codeId: string; userId: string; identityHash: string } }) => {
        if (redemptions.some((r) => r.codeId === data.codeId && (r.userId === data.userId || r.identityHash === data.identityHash))) {
          throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
        }
        redemptions.push(data);
      },
    },
    promoCode: { update: async ({ where }: { where: { id: string } }) => void codes.find((c) => c.id === where.id)!.redeemed++ },
    user: {
      update: async ({ where, data }: { where: { id: string }; data: { credits?: { increment: number }; plan?: string; planExpiresAt?: Date } }) => {
        const u = users.get(where.id)!;
        if (data.credits) u.credits += data.credits.increment;
        if (data.plan) u.plan = data.plan;
        if (data.planExpiresAt) u.planExpiresAt = data.planExpiresAt;
      },
    },
    creditLedger: { create: async ({ data }: { data: { userId: string; delta: number; reason: string } }) => void ledger.push(data) },
  };
  const prisma = {
    // Transactions run one at a time here, as the row lock (FOR UPDATE) makes them in the database.
    $transaction: <T>(fn: (t: typeof tx) => Promise<T>) => {
      const run = chain.then(() => fn(tx));
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
    user: { findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null },
    promoCode: {
      create: async ({ data }: { data: Omit<Code, 'id' | 'redeemed' | 'active' | 'createdAt'> }) => {
        if (codes.some((c) => c.hash === data.hash)) throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
        const c = { id: randomUUID(), redeemed: 0, active: true, createdAt: new Date(Date.now() - DAY), ...data } as Code;
        codes.push(c);
        return c;
      },
      createMany: async ({ data }: { data: Array<Omit<Code, 'id' | 'redeemed' | 'active' | 'createdAt'>> }) => {
        for (const d of data) codes.push({ id: randomUUID(), redeemed: 0, active: true, createdAt: new Date(Date.now() - DAY), ...d } as Code);
      },
    },
  };
  const svc = new PromoService(prisma as never, { DEVICE_PEPPER: 'p'.repeat(32) } as never);
  const account = (over: Partial<User> = {}) => {
    const u: User = { id: randomUUID(), email: `${randomUUID().slice(0, 8)}@example.com`, emailVerifiedAt: new Date(), isGuest: false, createdAt: new Date(), plan: 'FREE', planExpiresAt: null, credits: 0, ...over };
    users.set(u.id, u);
    return u;
  };
  const shared = (over: Partial<{ code: string; kind: 'CREDITS' | 'PRO_DAYS'; amount: number; maxRedemptions: number | null; newUsersOnly: boolean; endsAt: string | null }> = {}) =>
    svc.create(CreateCodeSchema.parse({ code: 'YAZ2026', campaign: 'Yaz', kind: 'CREDITS', amount: 5, reason: 'test', ...over }), 'admin');
  return { svc, codes, users, redemptions, ledger, account, shared };
}

describe('promo code rules', () => {
  it('case, spaces and dashes do not matter; odd characters are refused', () => {
    expect(normalizeCode(' yaz-2026 ')).toBe('YAZ2026');
    expect(normalizeCode('ab cd-ef')).toBe('ABCDEF');
    expect(normalizeCode("YAZ'26")).toBeNull();
    expect(normalizeCode('İNDİRİM')).toBeNull(); // dotted capital I is not A–Z
    expect(normalizeCode('ab')).toBeNull();
  });

  it('generated codes are long, unambiguous and do not repeat', () => {
    const many = new Set(Array.from({ length: 2000 }, generateCode));
    expect(many.size).toBe(2000);
    for (const c of [...many].slice(0, 50)) expect(c).toMatch(/^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/);
    expect(maskCode('ABCDEFGHJKMN')).toBe('ABCD…JKMN');
  });

  it('a code works only while on, inside its window, under its limit, and for new accounts when so marked', () => {
    const now = new Date('2026-11-05T12:00:00Z');
    const base = { active: true, startsAt: null, endsAt: null, maxRedemptions: null, redeemed: 0, newUsersOnly: false, createdAt: new Date('2026-11-01') };
    const acct = { createdAt: new Date('2026-10-01') };
    expect(usable(base, acct, now)).toBe(true);
    expect(usable({ ...base, active: false }, acct, now)).toBe(false);
    expect(usable({ ...base, startsAt: new Date('2026-11-06') }, acct, now)).toBe(false);
    expect(usable({ ...base, endsAt: now }, acct, now)).toBe(false);
    expect(usable({ ...base, maxRedemptions: 3, redeemed: 3 }, acct, now)).toBe(false);
    expect(usable({ ...base, newUsersOnly: true }, acct, now)).toBe(false);
    expect(usable({ ...base, newUsersOnly: true }, { createdAt: new Date('2026-11-02') }, now)).toBe(true);
  });

  it('PRO days stack on panel PRO; amounts and dates are bounded', () => {
    const now = new Date('2026-11-05T00:00:00Z');
    expect(proUntilAfter({ plan: 'FREE', planExpiresAt: null }, 7, now).toISOString()).toBe('2026-11-12T00:00:00.000Z');
    expect(proUntilAfter({ plan: 'PRO', planExpiresAt: new Date('2026-11-10T00:00:00Z') }, 7, now).toISOString()).toBe('2026-11-17T00:00:00.000Z');
    expect(proUntilAfter({ plan: 'PRO', planExpiresAt: new Date('2026-11-01T00:00:00Z') }, 7, now).toISOString()).toBe('2026-11-12T00:00:00.000Z');
    const ok = { campaign: 'Kart', kind: 'CREDITS', amount: 10, count: 5, reason: 'test' };
    expect(BatchSchema.safeParse(ok).success).toBe(true);
    expect(BatchSchema.safeParse({ ...ok, amount: 501 }).success).toBe(false);
    expect(BatchSchema.safeParse({ ...ok, kind: 'PRO_DAYS', amount: 366 }).success).toBe(false);
    expect(BatchSchema.safeParse({ ...ok, count: 1001 }).success).toBe(false);
    expect(BatchSchema.safeParse({ ...ok, startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' }).success).toBe(false);
    expect(CreateCodeSchema.safeParse({ ...ok, count: undefined, code: 'ABC' }).success).toBe(false);
    expect(ledgerKind('promo')).toBe('promo');
    expect(ledgerKind('promo_pro')).toBe('promo');
  });
});

describe('redeeming a promo code', () => {
  it('grants credits once, records it and counts it', async () => {
    const f = setup();
    await f.shared();
    const u = f.account();
    await expect(f.svc.redeem(u.id, 'yaz 2026')).resolves.toEqual({ kind: 'CREDITS', amount: 5, proUntil: null });
    expect(u.credits).toBe(5);
    expect(f.ledger).toEqual([{ userId: u.id, delta: 5, reason: 'promo', refId: f.codes[0].id }]);
    expect(f.codes[0].redeemed).toBe(1);
    await expect(f.svc.redeem(u.id, 'YAZ2026')).rejects.toMatchObject({ status: 409, code: 'already_redeemed' });
    expect(u.credits).toBe(5);
  });

  it('the same mailbox on another account cannot use it again (Gmail dots and +tags fold)', async () => {
    const f = setup();
    await f.shared();
    const first = f.account({ email: 'ayse.yilmaz@gmail.com' });
    const again = f.account({ email: 'AyseYilmaz+promo@gmail.com' });
    await f.svc.redeem(first.id, 'YAZ2026');
    await expect(f.svc.redeem(again.id, 'YAZ2026')).rejects.toMatchObject({ status: 409, code: 'already_redeemed' });
    expect(again.credits).toBe(0);
  });

  it('guests and unverified accounts cannot redeem', async () => {
    const f = setup();
    await f.shared();
    await expect(f.svc.redeem(f.account({ isGuest: true, email: null }).id, 'YAZ2026')).rejects.toMatchObject({ status: 403, code: 'verification_required' });
    await expect(f.svc.redeem(f.account({ emailVerifiedAt: null }).id, 'YAZ2026')).rejects.toMatchObject({ status: 403 });
  });

  it('unknown, expired, stopped, used-up or not-for-you codes all get the same answer', async () => {
    const f = setup();
    await f.shared({ code: 'BITTI2026', endsAt: new Date(Date.now() - 1000).toISOString() });
    await f.shared({ code: 'YENILER2026', newUsersOnly: true });
    await f.shared({ code: 'TEKKISI26', maxRedemptions: 1 });
    const old = f.account({ createdAt: new Date(Date.now() - 30 * DAY) });
    await f.svc.redeem(f.account().id, 'TEKKISI26');
    for (const code of ['YOKBOYLE1', 'BITTI2026', 'YENILER2026', 'TEKKISI26', '<script>']) {
      await expect(f.svc.redeem(old.id, code)).rejects.toMatchObject({ status: 404, code: 'invalid_code', message: 'Kod geçersiz ya da artık kullanılamıyor.' });
    }
  });

  it('a single-use gift code goes to exactly one of two people trying at once (BUS-02)', async () => {
    const f = setup();
    const { codes } = await f.svc.batch(BatchSchema.parse({ campaign: 'Kart', kind: 'CREDITS', amount: 10, count: 3, reason: 'test' }), 'admin');
    expect(codes).toHaveLength(3);
    expect(f.codes.every((c) => c.maxRedemptions === 1 && c.display.includes('…') && !codes.includes(c.display))).toBe(true);
    const [a, b] = [f.account(), f.account()];
    const results = await Promise.allSettled([f.svc.redeem(a.id, codes[0]), f.svc.redeem(b.id, codes[0])]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(a.credits + b.credits).toBe(10);
    expect(f.codes.find((c) => c.redeemed > 0)!.redeemed).toBe(1);
  });

  it('PRO days extend panel PRO; permanent PRO is told, not charged', async () => {
    const f = setup();
    await f.shared({ code: 'PRO7GUN', kind: 'PRO_DAYS', amount: 7 });
    const u = f.account();
    const r = await f.svc.redeem(u.id, 'PRO7GUN');
    expect(r.kind).toBe('PRO_DAYS');
    expect(u.plan).toBe('PRO');
    expect(u.planExpiresAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * DAY);
    expect(f.ledger.at(-1)).toMatchObject({ delta: 0, reason: 'promo_pro' });
    const forever = f.account({ plan: 'PRO', planExpiresAt: null });
    await expect(f.svc.redeem(forever.id, 'PRO7GUN')).rejects.toMatchObject({ status: 409, code: 'already_pro' });
    expect(f.codes[0].redeemed).toBe(1);
  });

  it('a shared code the admin types twice is refused', async () => {
    const f = setup();
    await f.shared();
    await expect(f.shared({ code: 'yaz-2026' })).rejects.toMatchObject({ status: 409, code: 'code_exists' });
  });
});

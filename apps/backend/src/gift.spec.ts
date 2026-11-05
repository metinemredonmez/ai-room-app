import { randomUUID } from 'node:crypto';
import { GiftSchema, GiftService } from './gifts/gift.service.js';
import { ledgerKind, publicLedgerEntry } from './users/ledger.js';

// API.md §7.31: gift credits from the panel. The user sees a "gift" and gets a push (and an e-mail only when asked and
// the address is verified); the staff member's id and internal reason never reach the user; staff accounts only by
// SUPER_ADMIN (AZ-05).

function setup(user: Partial<{ role: string; status: string; email: string | null; emailVerifiedAt: Date | null; locale: string; tokens: string[] }> = {}) {
  const u = {
    id: randomUUID(), role: 'USER', status: 'ACTIVE', email: 'kullanici@example.com', emailVerifiedAt: new Date() as Date | null, locale: 'tr', credits: 4,
    ...user, pushTokens: (user.tokens ?? ['ExponentPushToken[a]']).map((token) => ({ token })),
  };
  const ledger: Array<{ userId: string; delta: number; reason: string; refId: string }> = [];
  const pushes: Array<{ title: string; body: string; data: Record<string, string> }> = [];
  const mails: Array<{ to: string; subject: string }> = [];
  const tx = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === u.id ? { ...u } : null),
      update: async ({ data }: { data: { credits: { increment: number } } }) => void (u.credits += data.credits.increment),
    },
    creditLedger: { create: async ({ data }: { data: (typeof ledger)[number] }) => void ledger.push(data) },
  };
  const prisma = { $transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) };
  const svc = new GiftService(
    prisma as never,
    { send: async (m: typeof pushes) => void pushes.push(...m) } as never,
    { send: async (m: (typeof mails)[number]) => void mails.push(m) } as never,
    { WEB_APP_URL: 'https://casalume.app' } as never,
  );
  return { svc, u, ledger, pushes, mails };
}

const gift = (over: Record<string, unknown> = {}) => GiftSchema.parse({ credits: 5, reason: 'destek talebi telafisi', ...over });

describe('gift credits from the panel', () => {
  it('adds the credits as a gift and tells the user by push in their language, with the message', async () => {
    const f = setup({ locale: 'en' });
    const out = await f.svc.give(f.u.id, gift({ message: 'Thanks for your patience!' }), { id: 'staff-1', role: 'ADMIN' });
    expect(out).toEqual({ credits: 9, pushed: 1, emailed: false });
    expect(f.u.credits).toBe(9);
    expect(f.ledger).toEqual([{ userId: f.u.id, delta: 5, reason: 'gift', refId: 'staff-1' }]);
    expect(f.pushes).toEqual([expect.objectContaining({ title: 'Gift: 5 credits', body: 'Thanks for your patience!', data: { type: 'gift', path: '/hesap' } })]);
    expect(f.mails).toEqual([]);
  });

  it('e-mails only when asked and the address is verified; the default push text is used without a message', async () => {
    const f = setup();
    expect((await f.svc.give(f.u.id, gift({ email: true }), { id: 's', role: 'ADMIN' })).emailed).toBe(true);
    expect(f.mails).toEqual([expect.objectContaining({ to: 'kullanici@example.com', subject: 'Casalume · 5 kredi hediye' })]);
    expect(f.pushes[0].body).toContain('hediye kredi');
    const unverified = setup({ emailVerifiedAt: null, tokens: [] });
    expect(await unverified.svc.give(unverified.u.id, gift({ email: true }), { id: 's', role: 'ADMIN' })).toEqual({ credits: 9, pushed: 0, emailed: false });
    expect(unverified.mails).toEqual([]);
  });

  it('staff accounts only by SUPER_ADMIN; suspended or unknown accounts get nothing', async () => {
    const staff = setup({ role: 'SUPPORT' });
    await expect(staff.svc.give(staff.u.id, gift(), { id: 's', role: 'ADMIN' })).rejects.toMatchObject({ status: 403 });
    await expect(staff.svc.give(staff.u.id, gift(), { id: 's', role: 'SUPER_ADMIN' })).resolves.toMatchObject({ credits: 9 });
    const suspended = setup({ status: 'SUSPENDED' });
    await expect(suspended.svc.give(suspended.u.id, gift(), { id: 's', role: 'ADMIN' })).rejects.toMatchObject({ status: 409 });
    expect(suspended.ledger).toEqual([]);
    await expect(setup().svc.give(randomUUID(), gift(), { id: 's', role: 'ADMIN' })).rejects.toMatchObject({ status: 404 });
  });

  it('the user sees "gift", never who gave it or why; amounts and texts are bounded', () => {
    expect(ledgerKind('gift')).toBe('gift');
    const entry = publicLedgerEntry({ id: randomUUID(), delta: 5, reason: 'gift', refId: 'staff-uuid-123', createdAt: new Date() });
    expect(entry).toMatchObject({ kind: 'gift', delta: 5, designId: null, productId: null });
    expect(JSON.stringify(entry)).not.toContain('staff-uuid-123');
    expect(GiftSchema.safeParse({ credits: 0, reason: 'x y z' }).success).toBe(false);
    expect(GiftSchema.safeParse({ credits: 501, reason: 'x y z' }).success).toBe(false);
    expect(GiftSchema.safeParse({ credits: 5, reason: 'x y z', message: 'a'.repeat(141) }).success).toBe(false);
    expect(GiftSchema.safeParse({ credits: 5, reason: 'xy' }).success).toBe(false);
  });
});

import { randomUUID } from 'node:crypto';
import { AddMemberSchema, CreateOrgSchema, MAX_ORGS_PER_USER, OrgCreditsSchema, OrgsService, UpdateMemberSchema, monthStart } from './orgs/orgs.service.js';

// API.md §7.23 step 1: firms, roles and the credit pool. AZ-04 (a member id from another firm is "not found"),
// BUS-01 (the pool never goes negative, also under concurrency), one owner per firm.

type User = { id: string; email: string; isGuest: boolean; emailVerifiedAt: Date | null; status: string; role: string; name: string | null };
type Org = { id: string; name: string; status: string; credits: number; memberMonthlyCap: number | null; note: string | null; createdAt: Date; updatedAt: Date };
type Member = { orgId: string; userId: string; role: string; monthlyCap: number | null; createdAt: Date };

function fake() {
  const users: User[] = [];
  const orgs: Org[] = [];
  const members: Member[] = [];
  const ledger: Array<{ id: string; orgId: string; delta: number; reason: string; userId: string | null; actorId: string | null; createdAt: Date }> = [];
  const mkey = (w: { orgId_userId: { orgId: string; userId: string } }) => (m: Member) => m.orgId === w.orgId_userId.orgId && m.userId === w.orgId_userId.userId;
  const prisma = {
    $queryRaw: async (_s: TemplateStringsArray, id: string) => (orgs.some((o) => o.id === id) ? [{ id }] : []),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    user: { findUnique: async ({ where }: { where: { email: string } }) => users.find((u) => u.email === where.email) ?? null },
    organization: {
      create: async ({ data }: { data: Omit<Org, 'id' | 'status' | 'createdAt' | 'updatedAt'> & { members: { create: { userId: string; role: string } } } }) => {
        const { members: m, ...rest } = data;
        const org: Org = { id: randomUUID(), status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), ...rest };
        orgs.push(org);
        members.push({ orgId: org.id, userId: m.create.userId, role: m.create.role, monthlyCap: null, createdAt: new Date() });
        return org;
      },
      findUnique: async ({ where, include }: { where: { id: string }; include?: unknown }) => {
        const o = orgs.find((x) => x.id === where.id);
        if (!o || !include) return o ?? null;
        return {
          ...o,
          members: members.filter((m) => m.orgId === o.id).map((m) => ({ ...m, user: users.find((u) => u.id === m.userId)! })),
          ledger: ledger.filter((l) => l.orgId === o.id),
        };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Org> }) => Object.assign(orgs.find((o) => o.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: { id: string; credits?: { gte: number } }; data: { credits: { increment: number } } }) => {
        const o = orgs.find((x) => x.id === where.id && (!where.credits || x.credits >= where.credits.gte));
        if (!o) return { count: 0 };
        o.credits += data.credits.increment;
        return { count: 1 };
      },
    },
    orgMember: {
      count: async ({ where }: { where: { orgId?: string; userId?: string } }) =>
        members.filter((m) => (!where.orgId || m.orgId === where.orgId) && (!where.userId || m.userId === where.userId)).length,
      findUnique: async ({ where }: { where: { orgId_userId: { orgId: string; userId: string } } }) => members.find(mkey(where)) ?? null,
      findFirst: async ({ where }: { where: { orgId: string; role: string } }) => members.find((m) => m.orgId === where.orgId && m.role === where.role) ?? null,
      create: async ({ data }: { data: Omit<Member, 'createdAt'> }) => void members.push({ ...data, createdAt: new Date() }),
      update: async ({ where, data }: { where: { orgId_userId: { orgId: string; userId: string } }; data: Partial<Member> }) => Object.assign(members.find(mkey(where))!, data),
      delete: async ({ where }: { where: { orgId_userId: { orgId: string; userId: string } } }) => void members.splice(members.findIndex(mkey(where)), 1),
    },
    orgLedger: {
      create: async ({ data }: { data: { orgId: string; delta: number; reason: string; userId?: string; actorId?: string } }) =>
        void ledger.push({ id: randomUUID(), userId: null, actorId: null, createdAt: new Date(), ...data }),
      groupBy: async () => [],
    },
  };
  const addUser = (email: string, over: Partial<User> = {}) => {
    const u: User = { id: randomUUID(), email, isGuest: false, emailVerifiedAt: new Date(), status: 'ACTIVE', role: 'USER', name: null, ...over };
    users.push(u);
    return u;
  };
  return { svc: new OrgsService(prisma as never), users, orgs, members, ledger, addUser };
}

const create = (ownerEmail: string, extra: Record<string, unknown> = {}) => CreateOrgSchema.parse({ name: 'Mimar Ofisi', ownerEmail, reason: 'sözleşme 2026/12', ...extra });

describe('firms (step 1)', () => {
  it('every change needs a reason; inputs are bounded (INP-01)', () => {
    expect(CreateOrgSchema.safeParse({ name: 'Ofis', ownerEmail: 'a@example.com' }).success).toBe(false);
    expect(OrgCreditsSchema.safeParse({ delta: 0, reason: 'x y z' }).success).toBe(false);
    expect(AddMemberSchema.safeParse({ email: 'a@example.com', role: 'OWNER', reason: 'ekip' }).success).toBe(false); // owner only by transfer
    expect(UpdateMemberSchema.safeParse({ reason: 'boş değişiklik' }).success).toBe(false);
    expect(CreateOrgSchema.safeParse({ name: 'Ofis', ownerEmail: 'a@example.com', reason: 'ok!', memberMonthlyCap: 0 }).success).toBe(false);
  });

  it('the owner is a registered, verified, active, non-staff account', async () => {
    const { svc, addUser } = fake();
    addUser('guest@example.com', { isGuest: true });
    addUser('unverified@example.com', { emailVerifiedAt: null });
    addUser('banned@example.com', { status: 'BANNED' });
    addUser('staff@example.com', { role: 'ADMIN' });
    await expect(svc.create(create('nobody@example.com'), 'staff')).rejects.toMatchObject({ status: 404 });
    for (const e of ['guest', 'unverified', 'banned', 'staff']) await expect(svc.create(create(`${e}@example.com`), 'staff')).rejects.toMatchObject({ status: 422 });
    addUser('owner@example.com');
    const org = await svc.create(create('owner@example.com', { credits: 100 }), 'staff');
    expect(org).toMatchObject({ credits: 100, owner: { email: 'owner@example.com' }, members: [{ role: 'OWNER' }] });
    expect(org.ledger).toEqual([expect.objectContaining({ delta: 100, actorId: 'staff', reason: 'admin: sözleşme 2026/12' })]);
  });

  it('the pool never goes below zero, also when two deductions race (BUS-01)', async () => {
    const { svc, addUser, orgs } = fake();
    addUser('o@example.com');
    const org = await svc.create(create('o@example.com', { credits: 10 }), 'staff');
    await expect(svc.adjustCredits(org.id, -11, 'iade', 'staff')).rejects.toMatchObject({ status: 409, code: 'insufficient_credits' });
    const results = await Promise.allSettled([svc.adjustCredits(org.id, -7, 'düzeltme', 'staff'), svc.adjustCredits(org.id, -7, 'düzeltme', 'staff')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(orgs[0].credits).toBe(3);
    await expect(svc.adjustCredits(randomUUID(), 5, 'yok', 'staff')).rejects.toMatchObject({ status: 404 });
  });

  it('one owner: the owner is changed only by a transfer and cannot be removed', async () => {
    const { svc, addUser, members } = fake();
    const owner = addUser('o@example.com');
    const ali = addUser('ali@example.com');
    const org = await svc.create(create('o@example.com'), 'staff');
    await svc.addMember(org.id, AddMemberSchema.parse({ email: 'ali@example.com', reason: 'ekibe katıldı' }));
    await expect(svc.addMember(org.id, AddMemberSchema.parse({ email: 'ali@example.com', reason: 'tekrar' }))).rejects.toMatchObject({ status: 409 });
    await expect(svc.updateMember(org.id, owner.id, UpdateMemberSchema.parse({ role: 'MEMBER', reason: 'düşür' }))).rejects.toMatchObject({ status: 409, code: 'owner_transfer_required' });
    await expect(svc.removeMember(org.id, owner.id)).rejects.toMatchObject({ status: 409 });
    const { change } = await svc.updateMember(org.id, ali.id, UpdateMemberSchema.parse({ role: 'OWNER', reason: 'devir' }));
    expect(change.previousOwner).toBe(owner.id);
    expect(members.filter((m) => m.orgId === org.id && m.role === 'OWNER').map((m) => m.userId)).toEqual([ali.id]);
    expect(members.find((m) => m.userId === owner.id)?.role).toBe('ADMIN');
    await svc.removeMember(org.id, owner.id);
    expect(members.filter((m) => m.orgId === org.id)).toHaveLength(1);
  });

  it("a member of another firm is not found through this firm's id (AZ-04)", async () => {
    const { svc, addUser } = fake();
    addUser('a@example.com');
    const b = addUser('b@example.com');
    const orgA = await svc.create(create('a@example.com'), 'staff');
    await svc.create(create('b@example.com'), 'staff');
    await expect(svc.updateMember(orgA.id, b.id, UpdateMemberSchema.parse({ monthlyCap: 5, reason: 'sınır' }))).rejects.toMatchObject({ status: 404 });
    await expect(svc.removeMember(orgA.id, b.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.detail('not-a-uuid')).rejects.toMatchObject({ status: 404 });
  });

  it(`one person can be in at most ${MAX_ORGS_PER_USER} firms`, async () => {
    const { svc, addUser } = fake();
    addUser('busy@example.com');
    for (let i = 0; i < MAX_ORGS_PER_USER; i++) {
      addUser(`owner${i}@example.com`);
      const org = await svc.create(create(`owner${i}@example.com`), 'staff');
      await svc.addMember(org.id, AddMemberSchema.parse({ email: 'busy@example.com', reason: 'danışman' }));
    }
    addUser('last@example.com');
    const extra = await svc.create(create('last@example.com'), 'staff');
    await expect(svc.addMember(extra.id, AddMemberSchema.parse({ email: 'busy@example.com', reason: 'danışman' }))).rejects.toMatchObject({ status: 409, code: 'too_many_orgs' });
  });

  it('the month starts at 00:00 Istanbul', () => {
    expect(monthStart(new Date('2026-11-30T22:30:00Z')).toISOString()).toBe('2026-11-30T21:00:00.000Z'); // already 1 Dec in Istanbul
    expect(monthStart(new Date('2026-11-04T10:00:00Z')).toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });
});

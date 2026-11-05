import { createHash, randomUUID } from 'node:crypto';
import { OrgsService, maskEmail } from './orgs/orgs.service.js';

// API.md §7.23 step 2: e-mail invitations and the firm workspace's credit pool. Invitations: single use, only the
// invited (verified) address, hash-only storage. Pool: membership, firm status, member cap and balance are all
// decided under the firm row lock (BUS-01, AZ-01).

type User = { id: string; email: string | null; isGuest: boolean; emailVerifiedAt: Date | null; status: string; role: string; locale: string };
type Invite = {
  id: string; orgId: string; email: string; role: string; monthlyCap: number | null; tokenHash: string; invitedBy: string | null;
  expiresAt: Date; acceptedAt: Date | null; acceptedBy: string | null; revokedAt: Date | null; createdAt: Date;
};

function fake() {
  const users: User[] = [];
  const org = { id: randomUUID(), name: 'Ege Mimarlık', status: 'ACTIVE', credits: 20, memberMonthlyCap: null as number | null };
  const members: Array<{ orgId: string; userId: string; role: string; monthlyCap: number | null; createdAt: Date }> = [];
  const invites: Invite[] = [];
  const ledger: Array<{ orgId: string; userId: string | null; delta: number; reason: string; refId?: string; createdAt: Date }> = [];
  const mails: Array<{ to: string; text: string; html: string }> = [];
  const where = (i: Invite, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => {
      const val = i[k as keyof Invite];
      if (v === null) return val === null;
      if (v && typeof v === 'object' && 'gt' in v) return val instanceof Date && val > (v as { gt: Date }).gt;
      return val === v;
    });
  const mkey = (w: { orgId_userId: { orgId: string; userId: string } }) => (m: { orgId: string; userId: string }) =>
    m.orgId === w.orgId_userId.orgId && m.userId === w.orgId_userId.userId;
  const prisma = {
    $queryRaw: async (s: TemplateStringsArray, id: string) => {
      if (id !== org.id) return [];
      return s.join('').includes('credits') ? [{ status: org.status, credits: org.credits, memberMonthlyCap: org.memberMonthlyCap }] : [{ id }];
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    user: {
      findUnique: async ({ where: w }: { where: { email?: string; id?: string } }) => users.find((u) => (w.email ? u.email === w.email : u.id === w.id)) ?? null,
    },
    organization: {
      findUnique: async ({ where: w }: { where: { id: string } }) => (w.id === org.id ? org : null),
      update: async ({ data }: { data: { credits: { increment?: number; decrement?: number } } }) => {
        org.credits += (data.credits.increment ?? 0) - (data.credits.decrement ?? 0);
        return org;
      },
    },
    orgMember: {
      findUnique: async ({ where: w, include }: { where: { orgId_userId: { orgId: string; userId: string } }; include?: unknown }) => {
        const m = members.find(mkey(w));
        return m ? (include ? { ...m, org } : m) : null;
      },
      findMany: async ({ where: w }: { where: { userId: string } }) => members.filter((m) => m.userId === w.userId).map((m) => ({ ...m, org })),
      count: async ({ where: w }: { where: { orgId?: string; userId?: string } }) => members.filter((m) => (!w.orgId || m.orgId === w.orgId) && (!w.userId || m.userId === w.userId)).length,
      create: async ({ data }: { data: { orgId: string; userId: string; role: string; monthlyCap: number | null } }) => void members.push({ ...data, createdAt: new Date() }),
    },
    orgInvite: {
      findUnique: async ({ where: w, include }: { where: { tokenHash: string }; include?: unknown }) => {
        const i = invites.find((x) => x.tokenHash === w.tokenHash);
        return i ? (include ? { ...i, org } : i) : null;
      },
      updateMany: async ({ where: w, data }: { where: Record<string, unknown>; data: Partial<Invite> }) => {
        const hit = invites.filter((i) => where(i, w));
        for (const i of hit) Object.assign(i, data);
        return { count: hit.length };
      },
      count: async ({ where: w }: { where: Record<string, unknown> }) => invites.filter((i) => where(i, w)).length,
      create: async ({ data }: { data: Omit<Invite, 'id' | 'acceptedAt' | 'acceptedBy' | 'revokedAt' | 'createdAt'> }) => {
        const i: Invite = { id: randomUUID(), acceptedAt: null, acceptedBy: null, revokedAt: null, createdAt: new Date(), ...data };
        invites.push(i);
        return i;
      },
    },
    orgLedger: {
      create: async ({ data }: { data: { orgId: string; userId: string; delta: number; reason: string; refId?: string } }) => void ledger.push({ ...data, createdAt: new Date() }),
      aggregate: async ({ where: w }: { where: { orgId: string; userId: string } }) => ({
        _sum: { delta: ledger.filter((l) => l.orgId === w.orgId && l.userId === w.userId && ['generation', 'refund'].includes(l.reason)).reduce((s, l) => s + l.delta, 0) },
      }),
    },
  };
  const mailer = { send: async (m: { to: string; text: string; html: string }) => void mails.push(m) };
  const svc = new OrgsService(prisma as never, mailer as never, { WEB_APP_URL: 'https://casalume.example' } as never);
  const addUser = (email: string | null, over: Partial<User> = {}) => {
    const u: User = { id: randomUUID(), email, isGuest: false, emailVerifiedAt: new Date(), status: 'ACTIVE', role: 'USER', locale: 'tr', ...over };
    users.push(u);
    return u;
  };
  const join = (userId: string, role = 'MEMBER', monthlyCap: number | null = null) => members.push({ orgId: org.id, userId, role, monthlyCap, createdAt: new Date() });
  const tokenOf = (mail: { text: string }) => mail.text.match(/#token=([A-Za-z0-9_-]{43})/)![1];
  return { svc, org, users, members, invites, ledger, mails, addUser, join, tokenOf };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

describe('firm invitations', () => {
  it('sends a fragment link and stores only the hash; inviting again replaces the old link', async () => {
    const f = fake();
    await f.svc.invite(f.org.id, { email: 'yeni@example.com', role: 'MEMBER', monthlyCap: 5 }, 'staff');
    await flush();
    const first = f.tokenOf(f.mails[0]);
    expect(f.mails[0].text).toContain(`https://casalume.example/davet#token=${first}`);
    expect(f.invites[0].tokenHash).toBe(sha(first));
    expect(JSON.stringify(f.invites)).not.toContain(first);
    await f.svc.invite(f.org.id, { email: 'yeni@example.com', role: 'ADMIN', monthlyCap: null }, 'staff');
    expect(f.invites.filter((i) => i.revokedAt === null)).toHaveLength(1);
    const member = f.addUser('uye@example.com');
    f.join(member.id);
    await expect(f.svc.invite(f.org.id, { email: 'uye@example.com', role: 'MEMBER', monthlyCap: null }, 'staff')).rejects.toMatchObject({ status: 409, code: 'already_member' });
  });

  it('only the invited, verified, registered, non-staff account can accept, once (AUT/AZ)', async () => {
    const f = fake();
    await f.svc.invite(f.org.id, { email: 'davetli@example.com', role: 'ADMIN', monthlyCap: 7 }, 'staff');
    await flush();
    const token = f.tokenOf(f.mails[0]);
    const other = f.addUser('baskasi@example.com');
    const guest = f.addUser(null, { isGuest: true });
    const unverified = f.addUser('davetli2@example.com', { emailVerifiedAt: null });
    await expect(f.svc.acceptInvite(other.id, token)).rejects.toMatchObject({ status: 403, code: 'invite_email_mismatch', message: expect.stringContaining('d***@example.com') });
    await expect(f.svc.acceptInvite(guest.id, token)).rejects.toMatchObject({ status: 403, code: 'registration_required' });
    expect(unverified).toBeTruthy();
    const staff = f.addUser('davetli@example.com', { role: 'ADMIN' });
    await expect(f.svc.acceptInvite(staff.id, token)).rejects.toMatchObject({ status: 422, code: 'staff_account' });
    staff.role = 'USER';
    staff.emailVerifiedAt = null;
    await expect(f.svc.acceptInvite(staff.id, token)).rejects.toMatchObject({ status: 403, code: 'email_not_verified' });
    staff.emailVerifiedAt = new Date();
    await expect(f.svc.acceptInvite(staff.id, token)).resolves.toMatchObject({ orgName: 'Ege Mimarlık', role: 'ADMIN', already: false });
    expect(f.members).toEqual([expect.objectContaining({ userId: staff.id, role: 'ADMIN', monthlyCap: 7 })]);
    await expect(f.svc.acceptInvite(staff.id, token)).resolves.toMatchObject({ already: true }); // harmless repeat
    const twin = f.addUser('davetli@example.com'); // (a second account can't have the address, but the link is spent anyway)
    await expect(f.svc.acceptInvite(twin.id, token)).rejects.toMatchObject({ status: 410, code: 'invite_used' });
  });

  it('expired and revoked links are refused; the lookup shows only the masked address', async () => {
    const f = fake();
    await f.svc.invite(f.org.id, { email: 'eski@example.com', role: 'MEMBER', monthlyCap: null }, 'staff');
    await f.svc.invite(f.org.id, { email: 'geri@example.com', role: 'MEMBER', monthlyCap: null }, 'staff');
    await flush();
    const [expired, revoked] = f.mails.map(f.tokenOf);
    f.invites[0].expiresAt = new Date(Date.now() - 1000);
    await f.svc.revokeInvite(f.org.id, f.invites[1].id);
    const u1 = f.addUser('eski@example.com');
    const u2 = f.addUser('geri@example.com');
    await expect(f.svc.acceptInvite(u1.id, expired)).rejects.toMatchObject({ status: 410, code: 'invite_expired' });
    await expect(f.svc.acceptInvite(u2.id, revoked)).rejects.toMatchObject({ status: 410, code: 'invite_revoked' });
    await expect(f.svc.lookupInvite(expired)).resolves.toEqual(expect.objectContaining({ orgName: 'Ege Mimarlık', email: 'e***@example.com', status: 'expired' }));
    await expect(f.svc.lookupInvite('x'.repeat(43))).rejects.toMatchObject({ status: 404 });
    expect(maskEmail('a@b.co')).toBe('a***@b.co');
  });
});

describe('firm workspace credits', () => {
  it('spends the pool, respects the member cap and the balance, and refunds back to the pool', async () => {
    const f = fake();
    const ali = f.addUser('ali@example.com');
    f.join(ali.id, 'MEMBER', 5);
    await f.svc.charge(f.org.id, ali.id, 4, 'd1');
    expect(f.org.credits).toBe(16);
    await expect(f.svc.charge(f.org.id, ali.id, 2, 'd2')).rejects.toMatchObject({ status: 402, code: 'member_cap_reached' });
    await f.svc.refund(f.org.id, ali.id, 4, 'd1', {
      organization: { update: async ({ data }: { data: { credits: { increment: number } } }) => void (f.org.credits += data.credits.increment) },
      orgLedger: { create: async ({ data }: { data: { orgId: string; userId: string; delta: number; reason: string } }) => void f.ledger.push({ ...data, createdAt: new Date() }) },
    } as never);
    expect(f.org.credits).toBe(20);
    await f.svc.charge(f.org.id, ali.id, 5, 'd3'); // the refund gave the cap back too
    expect(f.ledger.map((l) => [l.reason, l.delta])).toEqual([['generation', -4], ['refund', 4], ['generation', -5]]);
    const bora = f.addUser('bora@example.com');
    f.join(bora.id);
    await expect(f.svc.charge(f.org.id, bora.id, 16, 'd4')).rejects.toMatchObject({ status: 402, code: 'org_insufficient_credits' });
  });

  it('a non-member gets "not found"; a suspended firm stops spending (AZ-01)', async () => {
    const f = fake();
    const outsider = f.addUser('dis@example.com');
    await expect(f.svc.charge(f.org.id, outsider.id, 1, 'x')).rejects.toMatchObject({ status: 404 });
    await expect(f.svc.workspace(f.org.id, outsider.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.svc.membership('not-a-uuid', outsider.id)).rejects.toMatchObject({ status: 404 });
    const m = f.addUser('uye@example.com');
    f.join(m.id);
    f.org.status = 'SUSPENDED';
    await expect(f.svc.workspace(f.org.id, m.id)).rejects.toMatchObject({ status: 403, code: 'org_suspended' });
    await expect(f.svc.charge(f.org.id, m.id, 1, 'x')).rejects.toMatchObject({ status: 403, code: 'org_suspended' });
  });

  it("members see their own allowance; only owners and admins see the firm's balance", async () => {
    const f = fake();
    const owner = f.addUser('sahip@example.com');
    const member = f.addUser('uye@example.com');
    f.join(owner.id, 'OWNER');
    f.join(member.id, 'MEMBER', 3);
    expect((await f.svc.myOrgs(owner.id))[0]).toMatchObject({ role: 'OWNER', credits: 20, monthlyCap: null, remainingThisMonth: null });
    expect((await f.svc.myOrgs(member.id))[0]).toMatchObject({ role: 'MEMBER', credits: null, monthlyCap: 3, remainingThisMonth: 3 });
  });
});

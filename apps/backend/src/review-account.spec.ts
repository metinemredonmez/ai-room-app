import { REVIEW_EMAIL, ReviewAccountService, reviewExpired, reviewPassword } from './admin/review-account.service.js';
import { verifyPassword } from './auth/crypto.js';
import { passwordProblem } from './auth/password-policy.js';

// API.md §7.40: the store review account — a strong generated password shown once, PRO and credits for a limited
// period, a new period means a new password and closed sessions; never a staff account.

describe('review account', () => {
  it('generated passwords are typeable, unique and pass the password policy', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = reviewPassword();
      expect(p).toMatch(/^[a-zA-Z3479]{5}(-[a-zA-Z3479]{5}){3}$/);
      expect(p).not.toMatch(/[0O1lIo25B8S6]/);
      expect(passwordProblem(p)).toBeNull();
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });

  it('expiry: refused from the moment the period ends', () => {
    const now = new Date('2026-12-01T10:00:00Z');
    expect(reviewExpired({ reviewUntil: null }, now)).toBe(false);
    expect(reviewExpired({ reviewUntil: new Date('2026-12-01T10:00:01Z') }, now)).toBe(false);
    expect(reviewExpired({ reviewUntil: now }, now)).toBe(true);
  });

  function setup(existingRole: string | null = null) {
    const users: Array<Record<string, unknown>> = existingRole ? [{ id: 'u1', email: REVIEW_EMAIL, role: existingRole }] : [];
    let revoked = 0;
    const prisma = {
      user: {
        findUnique: async () => users[0] ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const u = { id: 'u1', ...data };
          users.push(u);
          return u;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(users[0], data),
      },
    };
    const svc = new ReviewAccountService(prisma as never, { revokeAll: async () => void revoked++ } as never);
    return { svc, users, revoked: () => revoked };
  }

  it('issue: a verified USER with PRO and credits until the end of the period; the password is stored hashed', async () => {
    const f = setup();
    const now = new Date('2026-12-01T10:00:00Z');
    const out = await f.svc.issue({ days: 14, credits: 50, reason: 'iOS 1.0 incelemesi' }, now);
    const u = f.users[0];
    expect(out.email).toBe(REVIEW_EMAIL);
    expect(out.reviewUntil).toBe('2026-12-15T10:00:00.000Z');
    expect(u).toMatchObject({ role: 'USER', plan: 'PRO', credits: 50, isGuest: false, status: 'ACTIVE' });
    expect((u.planExpiresAt as Date).toISOString()).toBe(out.reviewUntil);
    expect(u.passwordHash).not.toContain(out.password);
    expect(await verifyPassword(u.passwordHash as string, out.password)).toBe(true);
    expect(f.revoked()).toBe(0); // a brand-new account has no sessions
  });

  it('a new period means a new password and closed sessions', async () => {
    const f = setup('USER');
    const a = await f.svc.issue({ days: 7, credits: 10, reason: 'ilk inceleme' });
    const b = await f.svc.issue({ days: 7, credits: 10, reason: 'ikinci inceleme' });
    expect(a.password).not.toBe(b.password);
    expect(await verifyPassword(f.users[0].passwordHash as string, a.password)).toBe(false);
    expect(f.revoked()).toBe(2);
  });

  it('never turns a staff account into the review account (AZ-05)', async () => {
    await expect(setup('SUPER_ADMIN').svc.issue({ days: 7, credits: 0, reason: 'deneme' })).rejects.toThrow(/staff/);
  });
});

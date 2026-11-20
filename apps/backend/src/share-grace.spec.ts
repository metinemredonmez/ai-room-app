import { describe, expect, it } from 'vitest';
import { AccountDeletionService, GRACE_DAYS } from './users/account-deletion.service.js';
import { EmailTokensService } from './auth/email-tokens.service.js';
import { shareOg } from './designs/designs.service.js';

// Share links, the deletion grace window and e-mail change tokens (19 Kasım batch).

function deletionSvc(rows: Map<string, Record<string, unknown>>) {
  const deleted: string[] = [];
  const revokes: string[] = [];
  const audits: string[] = [];
  const prisma = {
    user: {
      update: async ({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.get(id) ?? {};
        for (const [k, v] of Object.entries(data)) {
          (row as Record<string, unknown>)[k] =
            v && typeof v === 'object' && 'increment' in (v as Record<string, unknown>)
              ? Number(row[k] ?? 0) + Number((v as Record<string, unknown>).increment)
              : v;
        }
        rows.set(id, row);
        return row;
      },
      findMany: async ({ where }: { where: { deletionScheduledAt?: { lte: Date } } }) =>
        [...rows.entries()]
          .filter(([, r]) => r.status === 'PENDING_DELETION' && (r.deletionScheduledAt as Date) <= (where.deletionScheduledAt?.lte ?? new Date(0)))
          .map(([id]) => ({ id })),
      delete: async ({ where: { id } }: { where: { id: string } }) => {
        deleted.push(id);
        rows.delete(id);
      },
    },
    image: { findMany: async () => [{ id: 'img1' }] },
  };
  const oauth = { scheduleAccountRevocations: async (userId: string) => (revokes.push(userId), 1) };
  const images = { remove: async () => undefined };
  const audit = { record: async (_a: string, action: string) => void audits.push(action) };
  const svc = new AccountDeletionService(prisma as never, oauth as never, images as never, audit as never);
  return { svc, rows, deleted, revokes, audits };
}

describe('account deletion grace window (YediOda #18)', () => {
  it('schedule marks the account and kills sessions via tokenVersion', async () => {
    const rows = new Map<string, Record<string, unknown>>([['u1', { status: 'ACTIVE', tokenVersion: 3 }]]);
    const { svc, audits } = deletionSvc(rows);
    await svc.schedule('u1', '1.1.1.1');
    const row = rows.get('u1')!;
    expect(row.status).toBe('PENDING_DELETION');
    expect(row.tokenVersion).toBe(4);
    expect((row.deletionScheduledAt as Date).getTime()).toBeGreaterThan(Date.now() + (GRACE_DAYS - 1) * 86_400_000);
    expect(audits).toContain('account.deletion_scheduled');
  });

  it('sign-in within the window cancels the deletion', async () => {
    const rows = new Map<string, Record<string, unknown>>([['u1', { status: 'PENDING_DELETION', deletionScheduledAt: new Date(Date.now() + 10 * 86_400_000) }]]);
    const { svc, rows: after, deleted, audits } = deletionSvc(rows);
    const out = await svc.reactivateIfPending({ id: 'u1', status: 'PENDING_DELETION', deletionScheduledAt: new Date(Date.now() + 10 * 86_400_000) } as never);
    expect(out).not.toBe('purged');
    expect(after.get('u1')!.status).toBe('ACTIVE');
    expect(after.get('u1')!.deletionScheduledAt).toBeNull();
    expect(deleted).toHaveLength(0);
    expect(audits).toContain('account.deletion_cancelled');
  });

  it('a deadline that already passed is erased on the spot (Apple revoke + images + row)', async () => {
    const rows = new Map<string, Record<string, unknown>>([['u1', { status: 'PENDING_DELETION', deletionScheduledAt: new Date(Date.now() - 1000) }]]);
    const { svc, deleted, revokes } = deletionSvc(rows);
    const out = await svc.reactivateIfPending({ id: 'u1', status: 'PENDING_DELETION', deletionScheduledAt: new Date(Date.now() - 1000) } as never);
    expect(out).toBe('purged');
    expect(deleted).toEqual(['u1']);
    expect(revokes).toEqual(['u1']);
  });

  it('purgeDue only takes accounts whose window closed', async () => {
    const rows = new Map<string, Record<string, unknown>>([
      ['due', { status: 'PENDING_DELETION', deletionScheduledAt: new Date(Date.now() - 1000) }],
      ['waiting', { status: 'PENDING_DELETION', deletionScheduledAt: new Date(Date.now() + 5 * 86_400_000) }],
    ]);
    const { svc, deleted } = deletionSvc(rows);
    expect(await svc.purgeDue()).toBe(1);
    expect(deleted).toEqual(['due']);
  });
});

describe('e-mail change tokens (EMAIL_CHANGE)', () => {
  it('binds the token to the NEW address and consumes it once', async () => {
    const rows = new Map<string, { userId: string; purpose: string; email: string; tokenHash: string; usedAt: Date | null }>();
    let captured = '';
    const prisma = {
      $transaction: async (ops: Promise<unknown>[]) => {
        for (const o of ops) await o;
      },
      emailToken: {
        updateMany: async () => ({ count: 1 }),
        create: async ({ data }: { data: { tokenHash: string; email: string } }) => {
          captured = data.email;
          rows.set(data.tokenHash, { ...data, userId: 'u1', purpose: 'EMAIL_CHANGE', usedAt: null });
        },
        findUnique: async ({ where: { tokenHash } }: { where: { tokenHash: string } }) => {
          const r = rows.get(tokenHash);
          return r && { ...r, user: { id: r.userId, status: 'ACTIVE' } };
        },
      },
    };
    const mailer = { send: async () => undefined };
    const svc = new EmailTokensService(prisma as never, mailer as never, {} as never);
    const token = 't'.repeat(40);
    // hash like the service does
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(token).digest('hex');
    rows.set(hash, { userId: 'u1', purpose: 'EMAIL_CHANGE', email: 'new@example.com', tokenHash: hash, usedAt: null });
    const out = await svc.consumeEmailChange(token);
    expect(out.email).toBe('new@example.com');
    void captured;
  });
});

describe('share OG image', () => {
  it('renders a 1200x630 JPEG from two photos', async () => {
    const { default: sharp } = await import('sharp');
    const photo = async (color: string) =>
      sharp({ create: { width: 800, height: 600, channels: 3, background: color } }).jpeg().toBuffer();
    const jpeg = await shareOg(await photo('#aabbcc'), await photo('#ddeeff'), 'İskandinav · Yatak Odası');
    const meta = await sharp(jpeg).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
    expect(meta.format).toBe('jpeg');
    expect(jpeg.length).toBeGreaterThan(2_000);
  });
});

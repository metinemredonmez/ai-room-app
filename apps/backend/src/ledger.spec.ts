import { randomUUID } from 'node:crypto';
import { LEDGER_KINDS, ledgerKind, publicLedgerEntry } from './users/ledger.js';

// API.md §7.24: "my credit movements". The user sees what happened to their credits in words the app translates;
// a staff adjustment shows as "adjustment" only — its free-text reason and the staff member's id stay in the admin
// (AZ-03 / BOPLA: no internal field leaks through the user's own endpoint).

const row = (reason: string, delta: number, refId: string | null = null) => ({ id: randomUUID(), delta, reason, refId, createdAt: new Date('2026-11-05T09:00:00Z') });

describe('my credit movements', () => {
  it('every ledger reason the code writes maps to a known kind', () => {
    expect(ledgerKind('daily_free')).toBe('daily_free');
    expect(ledgerKind('generation')).toBe('generation');
    expect(ledgerKind('refund')).toBe('refund');
    expect(ledgerKind('welcome')).toBe('welcome');
    expect(ledgerKind('purchase:casalume_credits_10')).toBe('purchase');
    expect(ledgerKind('admin: müşteri şikâyeti, iade')).toBe('adjustment');
    expect(ledgerKind('dev_upgrade_pro_7d')).toBe('other');
    expect(LEDGER_KINDS).toContain(ledgerKind('anything else'));
  });

  it('a staff adjustment never shows its reason or who made it', () => {
    const staffId = randomUUID();
    const out = publicLedgerEntry(row('admin: kullanıcı sinirli, ses kaydı var', 5, staffId));
    expect(out).toEqual({ id: expect.any(String), delta: 5, kind: 'adjustment', designId: null, productId: null, createdAt: '2026-11-05T09:00:00.000Z' });
    expect(JSON.stringify(out)).not.toContain(staffId);
    expect(JSON.stringify(out)).not.toContain('sinirli');
  });

  it('design movements link to the design; purchases name the store product', () => {
    const designId = randomUUID();
    expect(publicLedgerEntry(row('generation', -2, designId))).toMatchObject({ kind: 'generation', delta: -2, designId, productId: null });
    expect(publicLedgerEntry(row('daily_free', -1, designId))).toMatchObject({ kind: 'daily_free', designId });
    expect(publicLedgerEntry(row('refund', 2, designId))).toMatchObject({ kind: 'refund', designId });
    expect(publicLedgerEntry(row('generation', -1, 'not-a-uuid'))).toMatchObject({ designId: null });
    // The purchase refId is the store transaction id: not shown.
    const buy = publicLedgerEntry(row('purchase:casalume_credits_10', 10, 'GPA.1234-5678'));
    expect(buy).toMatchObject({ kind: 'purchase', productId: 'casalume_credits_10', designId: null });
    expect(JSON.stringify(buy)).not.toContain('GPA.1234');
    expect(publicLedgerEntry(row('welcome', 3))).toMatchObject({ kind: 'welcome', delta: 3, designId: null, productId: null });
  });
});

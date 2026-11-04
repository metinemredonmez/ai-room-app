import { BillingService } from './billing/billing.service.js';
import { CatalogInputSchema, catalogDiff, creditsFor, defaultCatalog, nextCatalog, parseStored, publicCatalog, type CatalogInput } from './billing/plans.rules.js';
import { PlansService } from './billing/plans.service.js';

// API.md §7.21: plans and credit packs. The catalog decides how many credits a store product grants (BUS: money
// in, credits out), so its rules are tested on their own and through the webhook path.

const base = (): CatalogInput => {
  const { plan, packs } = defaultCatalog('casalume_credits_10:10,casalume_credits_50:50');
  return {
    plan: { ...plan, cycles: [{ cycle: 'monthly', active: true, highlight: true, iosProductId: 'pro_monthly', androidProductId: 'pro_monthly' }] },
    packs,
  };
};
const limits = { free: { dailyGenerations: 3, maxVariants: 2 }, pro: { dailyGenerations: 100, maxVariants: 4 } };

describe('plans catalog rules', () => {
  it('starts from CREDIT_PACKS so nothing changes until the catalog is saved', () => {
    const c = defaultCatalog('casalume_credits_10:10, casalume_credits_50:50,bad id:5,zero:0');
    expect(c.packs.map((p) => [p.iosProductId, p.androidProductId, p.credits, p.active])).toEqual([
      ['casalume_credits_10', 'casalume_credits_10', 10, true],
      ['casalume_credits_50', 'casalume_credits_50', 50, true],
    ]);
    expect(creditsFor(c, 'casalume_credits_50')).toBe(50);
    expect(creditsFor(c, 'pro_monthly')).toBeNull();
    expect(CatalogInputSchema.safeParse({ plan: c.plan, packs: c.packs }).success).toBe(true);
  });

  it('one store product means one thing; an active entry needs a product (INP-01)', () => {
    const ok = base();
    expect(CatalogInputSchema.safeParse(ok).success).toBe(true);
    const codes = (c: unknown) => (CatalogInputSchema.safeParse(c).error?.issues ?? []).map((i) => i.message);
    expect(codes({ ...ok, packs: [ok.packs[0], { ...ok.packs[1], iosProductId: 'casalume_credits_10' }] })).toContain('duplicate_product');
    expect(codes({ ...ok, packs: [{ ...ok.packs[0], androidProductId: 'pro_monthly' }, ok.packs[1]] })).toContain('duplicate_product');
    expect(codes({ ...ok, packs: [{ ...ok.packs[0], iosProductId: null, androidProductId: null }] })).toContain('active_needs_product');
    expect(codes({ ...ok, packs: [{ ...ok.packs[0], iosProductId: null, androidProductId: null, active: false }] })).toEqual([]);
    expect(codes({ ...ok, packs: ok.packs.map((p) => ({ ...p, highlight: true })) })).toContain('one_highlight');
    expect(codes({ ...ok, packs: [ok.packs[0], { ...ok.packs[1], key: ok.packs[0].key }] })).toContain('duplicate_key');
    expect(codes({ ...ok, plan: { ...ok.plan, cycles: [...ok.plan.cycles, { ...ok.plan.cycles[0], iosProductId: 'x', androidProductId: 'y', highlight: false }] } })).toContain('duplicate_cycle');
    expect(CatalogInputSchema.safeParse({ ...ok, packs: [{ ...ok.packs[0], credits: 0 }] }).success).toBe(false);
    expect(CatalogInputSchema.safeParse({ ...ok, packs: [{ ...ok.packs[0], iosProductId: 'has space' }] }).success).toBe(false);
    expect(CatalogInputSchema.safeParse({ ...ok, price: 9.99 }).success).toBe(false);
  });

  it('a pack taken off the catalog keeps crediting purchases already made; putting it back un-retires it', () => {
    const start = { ...base(), retired: [] };
    const removed = nextCatalog(start, { ...start, packs: [start.packs[1]] });
    expect(removed.packs).toHaveLength(1);
    expect(creditsFor(removed, 'casalume_credits_10')).toBe(10);
    const renamed = nextCatalog(removed, { ...removed, packs: [{ ...removed.packs[0], iosProductId: 'credits_50_v2' }] });
    expect(creditsFor(renamed, 'casalume_credits_50')).toBe(50); // still on Android, and the iOS id too via the pack
    expect(creditsFor(renamed, 'credits_50_v2')).toBe(50);
    const back = nextCatalog(renamed, { ...renamed, packs: [...renamed.packs, { ...start.packs[0], credits: 12 }] });
    expect(back.retired.map((r) => r.productId)).not.toContain('casalume_credits_10');
    expect(creditsFor(back, 'casalume_credits_10')).toBe(12);
  });

  it('the audit summary names what changed, not the whole catalog', () => {
    const start = { ...base(), retired: [] };
    const next = { ...start, packs: [{ ...start.packs[0], credits: 15 }, { ...start.packs[1], active: false }, { ...start.packs[1], key: 'big', iosProductId: 'big_pack', androidProductId: null }] };
    expect(catalogDiff(start, next)).toEqual(['pack.credits:pack_1:10->15', 'pack.deactivated:pack_2', 'pack.added:big']);
    expect(catalogDiff(start, { ...start, packs: [] })).toEqual(['pack.removed:pack_1', 'pack.removed:pack_2']);
  });

  it('the paywall sees active entries only, in Turkish or English, never a price', () => {
    const c = base();
    const stored = { ...c, packs: [c.packs[0], { ...c.packs[1], active: false }], retired: [] };
    const tr = publicCatalog(stored, 'tr', limits);
    const en = publicCatalog(stored, 'en', limits);
    expect(tr.packs).toEqual([{ key: 'pack_1', name: '10 tasarım hakkı', credits: 10, highlight: false, productIds: { ios: 'casalume_credits_10', android: 'casalume_credits_10' } }]);
    expect(en.plan.features[0]).toBe('Many more designs a day');
    expect(tr.plan.cycles).toEqual([{ cycle: 'monthly', highlight: true, productIds: { ios: 'pro_monthly', android: 'pro_monthly' } }]);
    expect(JSON.stringify(tr)).not.toMatch(/price/i);
  });

  it('a stored value that no longer validates falls back to the default', () => {
    const d = { ...base(), retired: [] };
    expect(parseStored({ plan: 'broken' }, d)).toBe(d);
    expect(parseStored({ ...base(), retired: [{ productId: 'old', credits: 5 }, { productId: 1 }] }, d).retired).toEqual([{ productId: 'old', credits: 5 }]);
  });
});

describe('plans service', () => {
  function service() {
    let row: { key: string; value: unknown; updatedBy: string | null; updatedAt: Date } | null = null;
    let tick = 0;
    const prisma = {
      setting: {
        findUnique: async () => row,
        upsert: async ({ create, update }: { create: { key: string; value: unknown; updatedBy: string }; update: { value: unknown; updatedBy: string } }) => {
          row = { key: create.key, ...(row ? update : create), updatedAt: new Date(Date.UTC(2026, 10, 4, 12, 0, tick++)) };
          return row;
        },
      },
      user: { findUnique: async () => ({ email: 'admin@example.com', name: null }) },
      $queryRaw: async () => [{ locked: 1 }],
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    };
    const settings = { current: { freeDailyGenerations: 3, maxVariantsFree: 2, proDailyGenerations: 100, maxVariantsPro: 4 } };
    const svc = new PlansService(prisma as never, settings as never, { CREDIT_PACKS: 'casalume_credits_10:10' } as never);
    return { svc };
  }

  it('saves with the version it read; a stale version is refused (BUS-02)', async () => {
    const { svc } = service();
    const first = await svc.forAdmin();
    expect(first).toMatchObject({ saved: false, version: null });
    const input = { plan: first.catalog.plan, packs: [{ ...first.catalog.packs[0], credits: 12 }] };
    await expect(svc.save(input, null, 'a1')).resolves.toMatchObject({ changes: ['pack.credits:pack_1:10->12'] });
    expect(await svc.creditsFor('casalume_credits_10')).toBe(12);
    await expect(svc.save(input, null, 'a2')).rejects.toMatchObject({ status: 409, code: 'version_conflict' });
    const now = await svc.forAdmin();
    expect(now).toMatchObject({ saved: true, updatedBy: 'admin@example.com' });
    await expect(svc.save(input, now.version, 'a2')).resolves.toBeTruthy();
  });
});

describe('credit packs through the RevenueCat path', () => {
  it('credits what the catalog says and nothing for an unknown product', async () => {
    const calls: Array<[string, unknown]> = [];
    const op = (name: string) => async (args: unknown) => void calls.push([name, args]);
    const prisma = {
      storePurchase: { create: op('purchase') },
      user: { update: op('user') },
      creditLedger: { create: op('ledger') },
      $transaction: (ops: Array<Promise<unknown>>) => Promise.all(ops),
    };
    const plans = { creditsFor: async (id: string) => (id === 'pack_seven' ? 7 : null) };
    const billing = new BillingService(prisma as never, {} as never, { REVENUECAT_ENTITLEMENT: 'pro' } as never, plans as never);
    await billing.applyEvent('u1', { id: 'e1', type: 'NON_RENEWING_PURCHASE', product_id: 'pack_seven', transaction_id: 't1', store: 'APP_STORE' });
    expect(calls.find(([n]) => n === 'user')?.[1]).toMatchObject({ data: { credits: { increment: 7 } } });
    calls.length = 0;
    await billing.applyEvent('u1', { id: 'e2', type: 'NON_RENEWING_PURCHASE', product_id: 'something_else', transaction_id: 't2', store: 'APP_STORE' });
    expect(calls).toEqual([]);
  });
});

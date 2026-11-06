import { randomUUID } from 'node:crypto';
import { overlaps, windowError } from './prices/price-schedule.rules.js';
import { PriceScheduleService } from './prices/price-schedule.service.js';

// API.md §7.36: scheduled price changes start and end on time, never twice; ending one never undoes a hand edit;
// two plans for the same tool or pack never overlap; a removed target fails cleanly.

const MIN = 60_000;
const t0 = new Date('2026-12-01T09:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * MIN);

describe('price schedule rules', () => {
  it('windows: not in the past, at most a year ahead, 15 min – 180 days long', () => {
    expect(windowError(at(0), at(60), t0)).toBeNull();
    expect(windowError(at(-3), null, t0)).toBeNull(); // "now" with a little clock slack
    expect(windowError(at(-10), null, t0)).toMatch(/geçmişte/);
    expect(windowError(at(0), at(10), t0)).toMatch(/15 dakika/);
    expect(windowError(at(0), at(181 * 24 * 60), t0)).toMatch(/180 gün/);
    expect(windowError(at(366 * 24 * 60), null, t0)).toMatch(/bir yıl/);
  });

  it('overlap: half-open windows; an open end runs forever', () => {
    expect(overlaps({ startsAt: at(0), endsAt: at(60) }, { startsAt: at(60), endsAt: at(120) })).toBe(false);
    expect(overlaps({ startsAt: at(0), endsAt: at(61) }, { startsAt: at(60), endsAt: at(120) })).toBe(true);
    expect(overlaps({ startsAt: at(0), endsAt: null }, { startsAt: at(9999), endsAt: at(10_100) })).toBe(true);
  });
});

type Row = { id: string; kind: string; targetKey: string; value: number; previousValue: number | null; startsAt: Date; endsAt: Date | null; status: string; note: string; outcome: string | null; createdById: string | null; createdAt: Date; appliedAt: Date | null; endedAt: Date | null };

function setup() {
  const rows: Row[] = [];
  const tools = new Map([['paint', 1], ['staging', 2]]);
  const packs = new Map([['small', 50]]);
  const audit: Array<{ action: string; actor: string | null; meta: Record<string, unknown> }> = [];
  const match = (r: Row, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => {
      const x = (r as unknown as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes(x);
      if (v && typeof v === 'object' && 'lte' in v) return x instanceof Date && x <= (v.lte as Date);
      return x === v;
    });
  const priceSchedule = {
    findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where)).map((r) => ({ ...r })),
    findUnique: async ({ where }: { where: { id: string } }) => {
      const r = rows.find((x) => x.id === where.id);
      return r ? { ...r } : null;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      const hit = rows.filter((r) => match(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
    create: async ({ data }: { data: Partial<Row> }) => {
      const r = { id: randomUUID(), previousValue: null, endsAt: null, status: 'SCHEDULED', outcome: null, createdById: null, createdAt: new Date(), appliedAt: null, endedAt: null, ...data } as Row;
      rows.push(r);
      return r;
    },
  };
  const prisma = { priceSchedule, user: { findMany: async () => [] }, $queryRaw: async () => [], $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ priceSchedule, $queryRaw: async () => [] }) };
  const setter = (m: Map<string, number>) => async (key: string, value: number, onlyIf: number | null) => {
    if (!m.has(key)) return { status: 'missing' as const };
    const cur = m.get(key)!;
    if (onlyIf !== null && cur !== onlyIf) return { status: 'changed' as const, current: cur };
    m.set(key, value);
    return { status: 'ok' as const, before: cur };
  };
  const product = { current: { tools: [...tools.keys()].map((id) => ({ id, nameTr: id, credits: tools.get(id)!, enabled: true })) }, setToolCredits: setter(tools) };
  Object.defineProperty(product, 'current', { get: () => ({ tools: [...tools.keys()].map((id) => ({ id, nameTr: id, credits: tools.get(id)!, enabled: true })) }) });
  const plans = { packs: async () => [...packs.keys()].map((key) => ({ key, nameTr: key, credits: packs.get(key)!, active: true })), setPackCredits: setter(packs) };
  const auditSvc = { record: async (actor: string | null, action: string, _t: string, _id: string | null, meta: Record<string, unknown> = {}) => void audit.push({ actor, action, meta }) };
  const svc = new PriceScheduleService(prisma as never, product as never, plans as never, auditSvc as never);
  const plan = (over: Partial<{ kind: 'tool' | 'pack'; key: string; value: number; startsAt: Date; endsAt: Date | null }> = {}) => {
    const o = { kind: 'tool' as const, key: 'staging', value: 1, startsAt: at(0), endsAt: at(60), ...over };
    return svc.create({ kind: o.kind, key: o.key, value: o.value, startsAt: o.startsAt.toISOString(), endsAt: o.endsAt?.toISOString() ?? null, reason: 'kampanya' }, 'admin-1', at(-1));
  };
  return { svc, rows, tools, packs, audit, plan };
}

describe('price schedule service', () => {
  it('starts on time, ends on time, goes back to the old price; a second run changes nothing', async () => {
    const f = setup();
    await f.plan();
    expect(await f.svc.due(at(-1))).toEqual({ started: 0, ended: 0, failed: 0 });
    expect(await f.svc.due(at(0))).toEqual({ started: 1, ended: 0, failed: 0 });
    expect(f.tools.get('staging')).toBe(1);
    expect(f.rows[0]).toMatchObject({ status: 'ACTIVE', previousValue: 2 });
    expect(await f.svc.due(at(30))).toEqual({ started: 0, ended: 0, failed: 0 });
    expect(await f.svc.due(at(60))).toEqual({ started: 0, ended: 1, failed: 0 });
    expect(f.tools.get('staging')).toBe(2);
    expect(f.rows[0]).toMatchObject({ status: 'DONE', outcome: 'Eski değere (2) dönüldü.' });
    expect(await f.svc.due(at(61))).toEqual({ started: 0, ended: 0, failed: 0 });
    expect(f.audit.map((a) => [a.action, a.actor])).toEqual([['price_schedule.start', null], ['price_schedule.end', null]]);
  });

  it('a price changed by hand during the campaign is left alone at the end', async () => {
    const f = setup();
    await f.plan();
    await f.svc.due(at(0));
    f.tools.set('staging', 3); // the admin edits the catalog meanwhile
    await f.svc.due(at(60));
    expect(f.tools.get('staging')).toBe(3);
    expect(f.rows[0].outcome).toBe('Değer bu arada elle 3 yapılmış; dokunulmadı.');
  });

  it('no end means permanent: applied once and done', async () => {
    const f = setup();
    await f.plan({ kind: 'pack', key: 'small', value: 75, endsAt: null });
    await f.svc.due(at(0));
    expect(f.packs.get('small')).toBe(75);
    expect(f.rows[0]).toMatchObject({ status: 'DONE', previousValue: 50, outcome: 'Kalıcı değişiklik uygulandı.' });
  });

  it('overlapping plans for one target are refused; other targets are fine', async () => {
    const f = setup();
    await f.plan({ startsAt: at(0), endsAt: at(60) });
    await expect(f.plan({ startsAt: at(30), endsAt: at(90) })).rejects.toMatchObject({ status: 409 });
    await expect(f.plan({ startsAt: at(60), endsAt: at(90) })).resolves.toBeDefined();
    await expect(f.plan({ key: 'paint', startsAt: at(30), endsAt: at(90) })).resolves.toBeDefined();
  });

  it('unknown targets, too-high values and bad windows are refused', async () => {
    const f = setup();
    await expect(f.plan({ key: 'nope' })).rejects.toMatchObject({ status: 400 });
    await expect(f.plan({ value: 11 })).rejects.toMatchObject({ status: 400 }); // tools: at most 10 credits
    await expect(f.plan({ endsAt: at(5) })).rejects.toMatchObject({ status: 400 });
  });

  it('cancel: before the start it never runs; while running it ends now and goes back', async () => {
    const f = setup();
    const a = await f.plan({ startsAt: at(10) });
    await expect(f.svc.cancel(a.id)).resolves.toEqual({ id: a.id, result: 'cancelled' });
    expect(await f.svc.due(at(10))).toEqual({ started: 0, ended: 0, failed: 0 });
    expect(f.tools.get('staging')).toBe(2);
    const b = await f.plan({ startsAt: at(20), endsAt: at(80) });
    await f.svc.due(at(20));
    expect(f.tools.get('staging')).toBe(1);
    await expect(f.svc.cancel(b.id)).resolves.toEqual({ id: b.id, result: 'ended' });
    expect(f.tools.get('staging')).toBe(2);
    await expect(f.svc.cancel(b.id)).rejects.toMatchObject({ status: 409 });
    await expect(f.svc.cancel('not-a-uuid')).rejects.toMatchObject({ status: 404 });
  });

  it('a target removed before the start fails cleanly', async () => {
    const f = setup();
    await f.plan();
    f.tools.delete('staging');
    expect(await f.svc.due(at(0))).toEqual({ started: 0, ended: 0, failed: 1 });
    expect(f.rows[0]).toMatchObject({ status: 'FAILED' });
  });
});

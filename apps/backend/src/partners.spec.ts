import { randomUUID } from 'node:crypto';
import { Prisma } from './generated/prisma/client.js';
import { CreatePartnerSchema, PartnersService, SLUG } from './partners/partners.service.js';

// API.md §7.33: partner links. A visit counts only for an active link; a new account (≤ 24 h) is attributed once and the
// first partner stays; staff accounts are never attributed. (The report SQL runs against PostgreSQL in the smoke test.)

function setup() {
  const partners = new Map<string, { id: string; active: boolean }>([
    ['ayse-dekor', { id: randomUUID(), active: true }],
    ['eski-ortak', { id: randomUUID(), active: false }],
  ]);
  const users = new Map<string, { createdAt: Date; role: string }>();
  const attributions = new Map<string, string>();
  let visits = 0;
  const prisma = {
    partner: { findUnique: async ({ where }: { where: { slug: string } }) => partners.get(where.slug) ?? null },
    user: { findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null },
    partnerAttribution: {
      create: async ({ data }: { data: { userId: string; partnerId: string } }) => {
        if (attributions.has(data.userId)) throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
        attributions.set(data.userId, data.partnerId);
      },
    },
    $executeRaw: async () => (visits++, 1),
  };
  const svc = new PartnersService(prisma as never, { WEB_APP_URL: 'https://casalume.app' } as never);
  const account = (over: Partial<{ createdAt: Date; role: string }> = {}) => {
    const id = randomUUID();
    users.set(id, { createdAt: new Date(), role: 'USER', ...over });
    return id;
  };
  return { svc, partners, attributions, account, visits: () => visits };
}

describe('partner links', () => {
  it('a visit counts only for an active link; odd slugs are ignored', async () => {
    const f = setup();
    await expect(f.svc.visit('Ayse-Dekor')).resolves.toEqual({ counted: true });
    await expect(f.svc.visit('eski-ortak')).resolves.toEqual({ counted: false });
    await expect(f.svc.visit('yok-boyle')).resolves.toEqual({ counted: false });
    await expect(f.svc.visit('../admin')).resolves.toEqual({ counted: false });
    expect(f.visits()).toBe(1);
    expect(f.svc.link('ayse-dekor')).toBe('https://casalume.app/p/ayse-dekor');
  });

  it('a new account is attributed once; the first partner stays', async () => {
    const f = setup();
    const u = f.account();
    await expect(f.svc.attribute(u, 'ayse-dekor')).resolves.toEqual({ attributed: true });
    f.partners.set('ikinci', { id: randomUUID(), active: true });
    await expect(f.svc.attribute(u, 'ikinci')).resolves.toEqual({ attributed: false });
    expect(f.attributions.get(u)).toBe(f.partners.get('ayse-dekor')!.id);
  });

  it('old accounts, staff, paused or unknown links are never attributed', async () => {
    const f = setup();
    await expect(f.svc.attribute(f.account({ createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) }), 'ayse-dekor')).resolves.toEqual({ attributed: false });
    await expect(f.svc.attribute(f.account({ role: 'ADMIN' }), 'ayse-dekor')).resolves.toEqual({ attributed: false });
    await expect(f.svc.attribute(f.account(), 'eski-ortak')).resolves.toEqual({ attributed: false });
    await expect(f.svc.attribute(f.account(), 'yok-boyle')).resolves.toEqual({ attributed: false });
    expect(f.attributions.size).toBe(0);
  });

  it('link names are short, lowercase and URL-safe; commission is 0–50 %', () => {
    expect(SLUG.test('ayse-dekor')).toBe(true);
    expect(SLUG.test('ab')).toBe(false);
    expect(SLUG.test('-ayse')).toBe(false);
    expect(SLUG.test('ayse_dekor')).toBe(false);
    const ok = { name: 'Ayşe Dekor', slug: 'Ayse-Dekor', reason: 'yeni ortak' };
    expect(CreatePartnerSchema.parse(ok).slug).toBe('ayse-dekor');
    expect(CreatePartnerSchema.safeParse({ ...ok, commissionPct: 51 }).success).toBe(false);
    expect(CreatePartnerSchema.safeParse({ ...ok, slug: 'ayşe' }).success).toBe(false);
  });
});

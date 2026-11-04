import { randomUUID } from 'node:crypto';
import { AiError } from './ai/ai.client.js';
import { STYLES_FOR_TEST } from './marketing.spec.fixtures.js';
import { ASO_LIMITS, AsoListingSchema, AsoRunSchema, SocialRunSchema, buildFacts, playListings, socialPostSchema, storeConfig, violationsOf, type AsoListing } from './marketing/marketing.rules.js';
import { renderWeeklyReport } from './marketing/weekly-report.js';
import { MarketingService } from './marketing/marketing.service.js';

// API.md §7.18: Pazarlama — store listing drafts. AI-02 (drafts only), RES-01 (budget, one run per language),
// INP-01 (store limits on every edit).

const listing = (over: Partial<AsoListing> = {}): AsoListing => ({
  app_name: 'Casalume: AI Room Design', app_subtitle: 'Change one thing at a time', app_keywords: 'interior,decor',
  app_promo: 'Tap a cushion, change it.', app_description: 'Description.', app_whats_new: 'Fixes.',
  play_title: 'Casalume: AI Room Design', play_short: 'Change one item in your room photo.', play_description: 'Long.',
  ...over,
});

type Row = Record<string, unknown> & { id: string; kind: string; locale: string; status: string; violations: string[]; createdAt: Date };

/** In-memory MarketingDraft table: just enough Prisma for the service. */
function fakePrisma() {
  const rows: Row[] = [];
  const match = (r: Row, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in v) return (v as { in: unknown[] }).in.includes(r[k]);
      if (v && typeof v === 'object' && 'not' in v) return r[k] !== (v as { not: unknown }).not;
      if (v && typeof v === 'object' && 'lt' in v) return (r[k] as Date) < (v as { lt: Date }).lt;
      return r[k] === v;
    });
  const table = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: randomUUID(), status: 'PENDING', violations: [], output: null, error: null, costUsd: 0, approvedAt: null, approvedById: null, createdAt: new Date(), updatedAt: new Date(), ...data } as unknown as Row;
      rows.push(row);
      return row;
    },
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => rows.filter((r) => match(r, where)),
    findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = rows.find((x) => x.id === where.id)!;
      Object.assign(r, data, { updatedAt: new Date() });
      return r;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = rows.filter((r) => match(r, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
  };
  const prisma = {
    marketingDraft: table,
    $transaction: async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])),
  };
  return { prisma, rows };
}

function service(opts: { budget?: 'normal' | 'exceeded'; ai?: () => Promise<unknown>; commercial?: boolean } = {}) {
  const { prisma, rows } = fakePrisma();
  const queued: string[] = [];
  const recorded: unknown[] = [];
  const asked: unknown[] = [];
  const queues = { marketing: { add: async (_: string, data: { draftId: string }) => void queued.push(data.draftId) } };
  const created: unknown[] = [];
  const ai = {
    marketingSocial: async (input: unknown) => {
      asked.push(input);
      return { post: { title: 'Japandi', caption: 'Same room, AI redesign.', hashtags: ['japandi', 'casalume'], alt_text: 'Before and after.' }, violations: [], usage: { kind: 'marketing', cost_usd: 0.02 } };
    },
    marketingCampaign: async (input: unknown) => {
      asked.push(input);
      return { message: { title: 'Yeni stiller', body: 'Kapadokya stilini dene.', link: '/studio' }, violations: [], usage: { kind: 'marketing', cost_usd: 0.01 } };
    },
    marketingAso: async (input: unknown) => {
      asked.push(input);
      return opts.ai ? opts.ai() : { listing: listing(), violations: [], usage: { provider: 'anthropic', model: 'claude-opus-5-5', kind: 'marketing', cost_usd: 0.07 } };
    },
  };
  const usage = { budget: async () => ({ state: opts.budget ?? 'normal' }), record: async (u: unknown) => void recorded.push(u) };
  const catalog = {
    styles: async () => STYLES_FOR_TEST,
    style: async (id: string) => ({ ...STYLES_FOR_TEST.find((x) => x.id === id)!, descriptionTr: 'Sakin', descriptionEn: 'Calm' }),
    previewUrl: (id: string) => `https://api.example/v1/styles/${id}/preview.jpg`,
  };
  const settings = { current: { freeDailyGenerations: 3, maxVariantsFree: 2 } };
  const broadcasts = {
    precheck: (c: { kind: string }) => (opts.commercial ? { signals: ['indirim'], blocked: c.kind === 'SERVICE' } : { signals: [], blocked: false }),
    create: async (input: unknown) => { created.push(input); return { id: 'b1' }; },
  };
  const svc = new MarketingService(prisma as never, queues as never, ai as never, usage as never, catalog as never, settings as never, broadcasts as never, {} as never, {} as never);
  return { svc, rows, queued, recorded, asked, created };
}

describe('store listing rules', () => {
  it('builds facts from the catalog without prices', () => {
    const facts = buildFacts({ locale: 'en', styles: STYLES_FOR_TEST, freeDaily: 3, maxVariantsFree: 2 });
    expect(facts).toContain('Instant Remodel');
    expect(facts).toContain('Styles (2): Modern, Cappadocia Cave House (PRO).');
    expect(facts).toContain('3 free designs a day');
    expect(facts).toMatch(/only those/);
    expect(facts).not.toMatch(/₺|TRY|\d+[.,]\d{2}/);
  });

  it('names tools, styles and rooms as the app shows them in that language', () => {
    const tr = buildFacts({ locale: 'tr', styles: STYLES_FOR_TEST, freeDaily: 3, maxVariantsFree: 2 });
    expect(tr).toContain('- Nesne Sil: Remove clutter or empty the room');
    expect(tr).toContain('Kapadokya Mağara Evi (PRO)');
    expect(tr).toContain('Oturma Odası');
    const de = buildFacts({ locale: 'de', styles: STYLES_FOR_TEST, freeDaily: 3, maxVariantsFree: 2 });
    expect(de).toContain('Wandfarbe');
    expect(de).toContain('Wohnzimmer');
  });

  it('holds every field to the store limit (INP-01)', () => {
    expect(AsoListingSchema.safeParse(listing()).success).toBe(true);
    for (const [k, max] of Object.entries(ASO_LIMITS)) {
      expect(AsoListingSchema.safeParse(listing({ [k]: 'x'.repeat(max + 1) })).success).toBe(false);
      expect(AsoListingSchema.safeParse(listing({ [k]: 'x'.repeat(max) })).success).toBe(true);
    }
    expect(AsoListingSchema.safeParse({ ...listing(), extra: 'x' }).success).toBe(false);
    expect(violationsOf({ ...listing(), play_short: 'x'.repeat(81) })).toEqual(['play_short']);
  });

  it('accepts known languages only, once each', () => {
    expect(AsoRunSchema.parse({ locales: ['de', 'de', 'ja'] }).locales).toEqual(['de', 'ja']);
    expect(AsoRunSchema.safeParse({ locales: ['pt'] }).success).toBe(false);
    expect(AsoRunSchema.safeParse({ locales: [] }).success).toBe(false);
    expect(AsoRunSchema.safeParse({ locales: ['de'], brief: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('exports EAS Metadata for the App Store and text for Google Play', () => {
    const cfg = storeConfig({ de: listing({ app_keywords: 'raum, deko' }), zh: listing() });
    expect(Object.keys(cfg.apple.info)).toEqual(['de-DE', 'zh-Hans']);
    expect(cfg.apple.info['de-DE']).toMatchObject({ title: 'Casalume: AI Room Design', keywords: ['raum', 'deko'], promoText: 'Tap a cushion, change it.' });
    expect(Object.keys(playListings({ ja: listing() }))).toEqual(['ja-JP']);
  });
});

describe('marketing drafts', () => {
  it('queues one draft per language with the brief', async () => {
    const { svc, rows, queued } = service();
    const out = await svc.runAso({ locales: ['de', 'ja'], brief: 'Küçük daireler' }, 'admin');
    expect(out.items.map((d) => d.locale)).toEqual(['de', 'ja']);
    expect(queued).toEqual(rows.map((r) => r.id));
    expect(rows[0].input).toEqual({ brief: 'Küçük daireler', whatsNew: null });
  });

  it('refuses when the daily AI budget is spent or the language is already being written (RES-01)', async () => {
    await expect(service({ budget: 'exceeded' }).svc.runAso({ locales: ['de'] }, 'admin')).rejects.toMatchObject({ status: 503, code: 'budget_exceeded' });
    const { svc } = service();
    await svc.runAso({ locales: ['de'] }, 'admin');
    await expect(svc.runAso({ locales: ['fr', 'de'] }, 'admin')).rejects.toMatchObject({ status: 409 });
  });

  it('writes the draft, records the cost and keeps the over-limit fields', async () => {
    const { svc, rows, recorded, asked } = service({
      ai: async () => ({ listing: listing({ play_title: 'x'.repeat(33) }), violations: ['play_title'], usage: { kind: 'marketing', cost_usd: 0.09 } }),
    });
    await svc.runAso({ locales: ['de'], whatsNew: 'Dokunarak seçim' }, 'admin');
    await svc.process(rows[0].id, false);
    expect(rows[0]).toMatchObject({ status: 'READY', violations: ['play_title'] });
    expect(recorded).toHaveLength(1);
    expect(asked[0]).toMatchObject({ locale: 'de', whats_new: 'Dokunarak seçim' });
    expect((asked[0] as { facts: string }).facts).toContain('Wandfarbe');
    await expect(svc.approve(rows[0].id, 'admin')).rejects.toMatchObject({ status: 422, code: 'over_limit' });
  });

  it('retries only retryable AI errors, then fails the draft', async () => {
    const { svc, rows } = service({ ai: async () => { throw new AiError(502, 'ai_unavailable', 'x', true); } });
    await svc.runAso({ locales: ['de'] }, 'admin');
    await expect(svc.process(rows[0].id, false)).rejects.toBeInstanceOf(AiError);
    expect(rows[0].status).toBe('PENDING');
    await svc.process(rows[0].id, true);
    expect(rows[0]).toMatchObject({ status: 'FAILED', error: 'ai_unavailable' });
  });

  it('an edit is checked, and approving archives the previous text of that language', async () => {
    const { svc, rows } = service();
    await svc.runAso({ locales: ['de'] }, 'admin');
    await svc.process(rows[0].id, false);
    await svc.approve(rows[0].id, 'admin');
    await svc.runAso({ locales: ['de'] }, 'admin');
    await svc.process(rows[1].id, false);
    await expect(svc.update(rows[1].id, listing({ play_short: 'x'.repeat(81) }))).rejects.toMatchObject({ status: 400 });
    await svc.update(rows[1].id, listing({ play_short: 'Neu' }));
    await svc.approve(rows[1].id, 'admin');
    expect(rows.map((r) => r.status)).toEqual(['ARCHIVED', 'APPROVED']);
    // Editing the approved text needs approval again.
    await svc.update(rows[1].id, listing({ play_short: 'Neu 2' }));
    expect(rows[1]).toMatchObject({ status: 'READY', approvedAt: null });
    const exp = await svc.exportAso();
    expect(exp.locales).toEqual([]);
  });
});

describe('social posts', () => {
  it('caps a run at 30 posts and holds captions to the platform', () => {
    expect(SocialRunSchema.safeParse({ styleIds: ['japandi', 'modern'], platforms: ['instagram', 'pinterest'], locales: ['tr', 'de'] }).success).toBe(true);
    expect(SocialRunSchema.safeParse({ styleIds: ['a_a', 'b_b', 'c_c', 'd_d', 'e_e'], platforms: ['instagram', 'tiktok', 'pinterest'], locales: ['tr', 'de', 'ja'] }).success).toBe(false);
    expect(SocialRunSchema.safeParse({ styleIds: ['../x'], platforms: ['instagram'], locales: ['tr'] }).success).toBe(false);
    const post = { title: 'T', caption: 'x'.repeat(501), hashtags: ['japandi'], alt_text: 'A' };
    expect(socialPostSchema('pinterest').safeParse(post).success).toBe(false);
    expect(socialPostSchema('instagram').safeParse(post).success).toBe(true);
    expect(socialPostSchema('instagram').safeParse({ ...post, hashtags: ['#japandi'] }).success).toBe(false);
    expect(socialPostSchema('instagram').safeParse({ ...post, hashtags: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false);
  });

  it('writes one draft per style × platform × language, only for styles with a photo', async () => {
    const { svc, rows, asked } = service();
    await expect(svc.runSocial({ styleIds: ['ghost'], platforms: ['instagram'], locales: ['tr'] }, 'admin')).rejects.toMatchObject({ status: 400 });
    const out = await svc.runSocial({ styleIds: ['modern'], platforms: ['instagram', 'pinterest'], locales: ['tr', 'de'] }, 'admin');
    expect(out.items).toHaveLength(4);
    await svc.process(rows[0].id, false);
    expect(rows[0]).toMatchObject({ kind: 'social', status: 'READY', violations: [] });
    expect(asked[0]).toMatchObject({ locale: 'tr', platform: 'instagram', style_name: 'Modern' });
  });
});

describe('campaign texts', () => {
  it('flags commercial wording in a service message and blocks approval', async () => {
    const { svc, rows } = service({ commercial: true });
    await svc.runCampaign({ locales: ['tr'], channel: 'PUSH', kind: 'SERVICE', goal: 'Yeni stilleri duyur' }, 'admin');
    await svc.process(rows[0].id, false);
    expect(rows[0].violations).toEqual(['looks_commercial']);
    await expect(svc.approve(rows[0].id, 'admin')).rejects.toMatchObject({ status: 422 });
  });

  it('only offers the pricing link to marketing messages and turns an approved text into one broadcast draft', async () => {
    const { svc, rows, asked, created } = service();
    await svc.runCampaign({ locales: ['de'], channel: 'EMAIL', kind: 'SERVICE', goal: 'Neue Stile ankündigen' }, 'admin');
    await svc.process(rows[0].id, false);
    expect((asked[0] as { links: string[] }).links).not.toContain('/fiyatlar');
    await expect(svc.toBroadcast(rows[0].id, 'admin')).rejects.toMatchObject({ status: 409 });
    await svc.approve(rows[0].id, 'admin');
    expect(await svc.toBroadcast(rows[0].id, 'admin')).toEqual({ broadcastId: 'b1' });
    expect(created[0]).toMatchObject({ kind: 'SERVICE', channel: 'EMAIL', audience: { accounts: 'all', locale: 'de' }, link: '/studio' });
    await expect(svc.toBroadcast(rows[0].id, 'admin')).rejects.toMatchObject({ status: 409 });
  });

  it('edits keep links inside the app', async () => {
    const { svc, rows } = service();
    await svc.runCampaign({ locales: ['tr'], channel: 'PUSH', kind: 'MARKETING', goal: 'PRO dene' }, 'admin');
    await svc.process(rows[0].id, false);
    await expect(svc.update(rows[0].id, { title: 'Yeni', body: 'Dene bakalım', link: 'https://evil.example' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.update(rows[0].id, { title: 'Yeni', body: 'x'.repeat(301), link: null })).rejects.toMatchObject({ status: 400 });
    await svc.update(rows[0].id, { title: 'Yeni', body: 'Dene bakalım', link: '/fiyatlar' });
    expect(rows[0].status).toBe('READY');
  });
});

describe('weekly report mail', () => {
  const week = (n: number) => ({
    users: { registered: n, guests: 2 * n, active: 3 * n },
    designs: { created: 10 * n, succeeded: 9 * n, failed: n, failRate: 0.1 },
    store: { subscriptionsStarted: n, renewals: 0, cancellations: 0, creditPacks: 0 },
    ai: { calls: 20 * n, costUsd: 1.5 * n, costPerDesignUsd: 0.167 },
    ops: { jobErrors: 0, broadcastsSent: 0 },
  });
  const metrics = {
    period: { from: '2026-10-28T06:00:00.000Z', to: '2026-11-04T06:00:00.000Z' },
    thisWeek: week(2), lastWeek: week(1), topTools: [], topStyles: [],
    now: { registeredUsers: 40, activeSubscriptions: 3, openContentReports: 0, openKvkkRequests: 1 },
  };

  it('always carries the numbers, escapes the AI text and needs no personal data', () => {
    const mail = renderWeeklyReport({ to: 'owner@example.com', metrics, text: { summary: '<b>İyi</b> hafta', highlights: ['Kayıt 2 kat'], actions: [] }, adminUrl: 'https://admin.example/marketing/report' });
    expect(mail.subject).toContain('Casalume haftalık rapor');
    expect(mail.html).toContain('&lt;b&gt;İyi&lt;/b&gt;');
    expect(mail.text).toContain('Yeni kayıtlı kullanıcı: 2 (+100%)');
    const bare = renderWeeklyReport({ to: 'owner@example.com', metrics, text: null, adminUrl: 'https://admin.example' });
    expect(bare.text).toContain('AI maliyeti: $3.00 (+100%)');
  });
});

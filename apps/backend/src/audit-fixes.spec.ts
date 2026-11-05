import { randomUUID } from 'node:crypto';
import { ProductCatalogService } from './catalog/product.service.js';
import { afterEach, vi } from 'vitest';
import { UserController } from './app.controller.js';
import { BlogService } from './blog/blog.service.js';
import { BroadcastsService } from './broadcasts/broadcasts.service.js';
import { commercialSignals } from './broadcasts/broadcast.rules.js';
import { AppError } from './common/errors.js';
import { resolveClientIp } from './common/http.js';
import { scrub } from './common/log.js';
import { DesignsService } from './designs/designs.service.js';
import { PushPartialError, PushService } from './push/push.service.js';

// Codex audit (docs/CODEX-DENETIM.md), 4 Nov 2026: each test reproduces the reported failure first.

const DESIGN_ID = '6f1c2b0a-1d2e-4f3a-8b4c-5d6e7f8a9b0c';
const consentRequired = { status: 403, code: 'consent_required' };
const paused = { status: 503, code: 'generation_paused' };

/** DesignsService with just the parts these tests touch. */
function designs(opts: { consent?: boolean; budget?: 'normal' | 'exceeded'; pro?: boolean; design?: Record<string, unknown>; refundFails?: number } = {}) {
  const calls = { analyze: 0, segment: 0, refunds: 0, refundAttempts: 0 };
  const rows = new Map<string, Record<string, unknown>>();
  if (opts.design) rows.set(String(opts.design.id), { ...opts.design });
  let refundFails = opts.refundFails ?? 0;
  const db = {
    design: {
      findUnique: async ({ where }: { where: { id: string } }) => (rows.has(where.id) ? { ...rows.get(where.id)!, user: { plan: opts.pro ? 'PRO' : 'FREE' } } : null),
      findFirst: async () => ({ ...rows.get(DESIGN_ID)!, results: [{ id: 'r1' }] }),
      findMany: async ({ where }: { where: { status: string; chargeState?: string } }) =>
        [...rows.values()].filter((r) => r.status === where.status && (!where.chargeState || r.chargeState === where.chargeState)).map((r) => ({ id: r.id })),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(rows.get(where.id)!, data),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const r = rows.get(String(where.id));
        if (!r || Object.entries(where).some(([k, v]) => k !== 'id' && r[k] !== v)) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
    },
    analysis: { findUnique: async () => null },
  };
  // Interactive transaction with rollback: a throw inside restores every row as it was.
  const prisma = {
    ...db,
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => {
      const snapshot = new Map([...rows].map(([k, v]) => [k, { ...v }]));
      try {
        return await fn(db);
      } catch (e) {
        rows.clear();
        for (const [k, v] of snapshot) rows.set(k, v);
        throw e;
      }
    },
  };
  const users = {
    get: async () => ({ id: 'u1', plan: opts.pro ? 'PRO' : 'FREE' }),
    isPro: (u: { plan: string }) => u.plan === 'PRO',
    refund: async () => {
      calls.refundAttempts++;
      if (refundFails-- > 0) throw new Error('db_down');
      calls.refunds++;
    },
  };
  const ai = {
    analyze: async () => void calls.analyze++,
    segment: async () => void calls.segment++,
  };
  const settings = { current: { maintenance: { enabled: false }, requireAiConsent: true } };
  const usage = { budget: async () => ({ state: opts.budget ?? 'normal', brakeMode: 'free_paused' }), record: async () => undefined };
  const consents = { hasCurrent: async () => opts.consent ?? true };
  const images = { owned: async () => ({ id: 'img' }), read: async () => Buffer.from('jpeg') };
  const svc = new DesignsService(
    prisma as never, images as never, users as never, {} as never, ai as never, settings as never, usage as never, {} as never,
    consents as never, { MAX_CONCURRENT_GENERATIONS: 1 } as never, {} as never, {} as never,
    new ProductCatalogService({} as never),
    { forTool: () => ({ versions: {} }) } as never,
  );
  return { svc, calls, rows };
}

describe('1. AI-processing consent on every path that sends a photo', () => {
  it('a cost analysis needs it (the result image goes to the AI provider)', async () => {
    const { svc, calls } = designs({ consent: false, design: { id: DESIGN_ID, userId: 'u1' } });
    await expect(svc.analysis('u1', DESIGN_ID, undefined, 'tr', 'rid')).rejects.toMatchObject(consentRequired);
    expect(calls.analyze).toBe(0);
  });

  it('a chat message with a photo needs it; text-only chat does not', async () => {
    let read = 0;
    const ds = {
      assertAiConsent: async () => {
        throw new AppError(403, 'consent_required', 'x');
      },
      assertBudgetFor: async () => undefined,
    };
    const images = { owned: async () => ({ id: 'img' }), read: async () => (read++, Buffer.from('jpeg')) };
    const limiter = { hit: async () => undefined };
    const ai = { chat: async () => ({ reply: 'ok', suggestions: [] }) };
    const catalog = { catalog: async () => ({ tools: [], styles: [], rooms: [] }) };
    const usage = { record: async () => undefined };
    const ctrl = new UserController(
      {} as never, {} as never, images as never, ds as never, catalog as never, ai as never, {} as never, limiter as never,
      {} as never, usage as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    );
    const req = { query: {}, headers: {}, clientIp: '1', id: 'rid' } as never;
    const withPhoto = { messages: [{ role: 'user', text: 'Bu oda?', imageId: randomUUID() }] };
    await expect(ctrl.chat({ userId: 'u1' } as never, withPhoto, req)).rejects.toMatchObject(consentRequired);
    expect(read).toBe(0);
    await expect(ctrl.chat({ userId: 'u1' } as never, { messages: [{ role: 'user', text: 'Salon fikri?' }] }, req)).resolves.toMatchObject({ reply: 'ok' });
  });
});

describe('2. refunds commit together with the charge-state change', () => {
  const failed = { id: DESIGN_ID, userId: 'u1', status: 'PENDING', chargeState: 'HELD', chargeDay: '2026-11-04', freeUsed: 1, creditsUsed: 1, tool: 'paint', params: {} };

  it('a refund that fails leaves the design HELD, and the reconciler refunds it once later', async () => {
    const { svc, calls, rows } = designs({ design: failed, refundFails: 1 });
    await svc.fail(DESIGN_ID, 'ai_unavailable');
    expect(rows.get(DESIGN_ID)).toMatchObject({ status: 'FAILED', chargeState: 'HELD' }); // not RELEASED without the credits
    expect(calls.refunds).toBe(0);
    await svc.reconcile();
    expect(rows.get(DESIGN_ID)).toMatchObject({ chargeState: 'RELEASED' });
    expect(calls.refunds).toBe(1);
    await svc.reconcile();
    await svc.fail(DESIGN_ID, 'again');
    expect(calls.refunds).toBe(1); // never twice
  });

  it('a partial success refunds the missing variants once, even if the job runs again', async () => {
    const { svc, calls, rows } = designs({ design: { ...failed, params: { variants: 2 } } });
    const settle = (svc as unknown as { settleSuccess: (d: unknown, n: number, data: unknown) => Promise<void> }).settleSuccess.bind(svc);
    await settle(rows.get(DESIGN_ID), 1, { status: 'SUCCEEDED' });
    await settle({ ...failed, params: { variants: 2 } }, 1, { status: 'SUCCEEDED' }); // retried job, stale read
    expect(calls.refunds).toBe(1);
    expect(rows.get(DESIGN_ID)).toMatchObject({ chargeState: 'CAPTURED', status: 'SUCCEEDED', creditsUsed: 0, freeUsed: 1 });
  });

  it('a failed refund inside a partial success rolls the capture back (nothing half-done)', async () => {
    const { svc, rows } = designs({ design: { ...failed, params: { variants: 2 } }, refundFails: 1 });
    const settle = (svc as unknown as { settleSuccess: (d: unknown, n: number, data: unknown) => Promise<void> }).settleSuccess.bind(svc);
    await expect(settle(rows.get(DESIGN_ID), 1, { status: 'SUCCEEDED' })).rejects.toThrow('db_down');
    expect(rows.get(DESIGN_ID)).toMatchObject({ chargeState: 'HELD', creditsUsed: 1 });
  });
});

describe('3. a partial push failure never re-sends to devices that got it', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('only the unsent devices are retried', async () => {
    const tokens = Array.from({ length: 150 }, (_, i) => `ExponentPushToken[device${String(i).padStart(4, '0')}abc]`);
    const sentTo: string[] = [];
    let call = 0;
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      call++;
      const msgs = JSON.parse(init.body) as Array<{ to: string }>;
      if (call === 2) return new Response('busy', { status: 503 }); // second chunk: Expo overloaded
      sentTo.push(...msgs.map((m) => m.to));
      return Response.json({ data: msgs.map((_, i) => ({ status: 'ok', id: `t${call}-${i}` })) });
    });
    const prisma = {
      design: { findUnique: async () => ({ id: 'd1', status: 'SUCCEEDED', user: { locale: 'tr', pushTokens: tokens.map((token) => ({ token })) } }) },
      pushToken: { deleteMany: async () => undefined },
    };
    const push = new PushService(prisma as never, { PUSH_TRANSPORT: 'expo', DATA_DIR: '/tmp' } as never);
    const err = await push.notifyDesign('d1', async () => 'Salon').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PushPartialError);
    const unsent = (err as PushPartialError).unsent;
    expect(sentTo).toHaveLength(100);
    expect(unsent).toEqual(tokens.slice(100));
    await push.notifyDesign('d1', async () => 'Salon', unsent); // the retry job
    expect(sentTo).toHaveLength(150);
    expect(new Set(sentTo).size).toBe(150); // nobody twice
  });
});

describe('5. marketing e-mail: consent and quiet hours checked before every message', () => {
  function broadcasts(opts: { quietAfter?: number; withdrawAfter?: number }) {
    const deliveries = [
      { id: 'd1', userId: 'u1', status: 'SENDING' },
      { id: 'd2', userId: 'u2', status: 'SENDING' },
    ];
    const consentRows = [
      { userId: 'u1', granted: true, version: 'v1', createdAt: new Date(1) },
      { userId: 'u2', granted: true, version: 'v1', createdAt: new Date(1) },
    ];
    const mailed: string[] = [];
    const settings = { current: { broadcast: { emailDailyCap: 300, quietStart: '00:00', quietEnd: '00:00', weeklyMarketingCap: 5 } } };
    const prisma = {
      broadcastDelivery: {
        count: async () => 0,
        groupBy: async () => [],
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(deliveries.find((d) => d.id === where.id)!, data),
        updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: Record<string, unknown> }) => {
          for (const d of deliveries) if (where.id.in.includes(d.id)) Object.assign(d, data);
          return { count: where.id.in.length };
        },
      },
      user: { findMany: async () => ['u1', 'u2'].map((id) => ({ id, status: 'ACTIVE', email: `${id}@example.com`, emailVerifiedAt: new Date(), locale: 'tr' })) },
      consent: {
        findMany: async ({ where }: { where: { userId: { in: string[] } } }) =>
          consentRows.filter((r) => where.userId.in.includes(r.userId)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      },
    };
    const mailer = {
      send: async (m: { to: string }) => {
        mailed.push(m.to);
        if (opts.withdrawAfter === mailed.length) consentRows.push({ userId: 'u2', granted: false, version: 'v1', createdAt: new Date(2) });
        // Quiet hours start now: a window around the current Istanbul minute.
        if (opts.quietAfter === mailed.length) Object.assign(settings.current.broadcast, { quietStart: '00:00', quietEnd: '23:59' });
      },
    };
    const legal = { acceptanceValid: () => true, versionOf: () => ({ version: 'v1' }) };
    const svc = new BroadcastsService(
      prisma as never, {} as never, mailer as never, settings as never, {} as never, legal as never, {} as never,
      { JWT_SECRET: 'j'.repeat(40), WEB_APP_URL: 'https://casalume.app', PUBLIC_BASE_URL: 'https://api.casalume.app', LEGAL_CONTROLLER_NAME: 'C', LEGAL_CONTROLLER_ADDRESS: 'A', LEGAL_CONTACT_EMAIL: 'k@example.com' } as never,
    );
    const b = { id: 'b1', kind: 'MARKETING', channel: 'EMAIL', title: 'Yeni', body: 'Yeni stiller', link: null, audience: {} };
    const round = () => (svc as unknown as { emailRound: (b: unknown, batch: unknown) => Promise<string | null> }).emailRound(b, deliveries.map((d) => ({ id: d.id, userId: d.userId })));
    return { round, deliveries, mailed };
  }

  it('an unsubscribe during the round is honoured for the next message', async () => {
    const { round, deliveries, mailed } = broadcasts({ withdrawAfter: 1 });
    await expect(round()).resolves.toBeNull();
    expect(mailed).toEqual(['u1@example.com']);
    expect(deliveries[1]).toMatchObject({ status: 'SKIPPED', reason: 'consent_missing' });
  });

  it('reaching the quiet hours pauses the round and gives the rest back', async () => {
    const { round, deliveries, mailed } = broadcasts({ quietAfter: 1 });
    await expect(round()).resolves.toBe('quiet_hours');
    expect(mailed).toEqual(['u1@example.com']);
    expect(deliveries[1].status).toBe('PENDING');
  });
});

describe('6. the AI budget brake covers every paid path and queued work', () => {
  it('selection, analysis and chat pause for FREE users when the hard brake is on', async () => {
    const free = designs({ budget: 'exceeded', design: { id: DESIGN_ID, userId: 'u1' } });
    await expect(free.svc.selection('u1', 'img', { points: [{ x: 0.5, y: 0.5 }] }, 'rid')).rejects.toMatchObject(paused);
    await expect(free.svc.analysis('u1', DESIGN_ID, undefined, 'tr', 'rid')).rejects.toMatchObject(paused);
    await expect(free.svc.assertBudgetFor('u1')).rejects.toMatchObject(paused);
    expect(free.calls).toMatchObject({ segment: 0, analyze: 0 });
    const pro = designs({ budget: 'exceeded', pro: true });
    await expect(pro.svc.assertBudgetFor('u1')).resolves.toBeUndefined();
  });

  it('a FREE design queued before the budget ran out stops at the worker and is refunded', async () => {
    const { svc, rows, calls } = designs({
      budget: 'exceeded',
      design: { id: DESIGN_ID, userId: 'u1', status: 'PENDING', chargeState: 'HELD', chargeDay: '2026-11-04', freeUsed: 1, creditsUsed: 0, tool: 'paint', params: {} },
    });
    await svc.process(DESIGN_ID, { finalAttempt: false });
    expect(rows.get(DESIGN_ID)).toMatchObject({ status: 'FAILED', error: 'generation_paused', chargeState: 'RELEASED' });
    expect(calls.refunds).toBe(1);
  });
});

describe('7. an edited blog article is published again under the same slug', () => {
  it('re-approving the same draft updates its own post instead of colliding with it', async () => {
    const posts: Array<Record<string, unknown>> = [];
    const tx = {
      blogPost: {
        findFirst: async ({ where }: { where: { draftId: string; locale: string } }) => posts.find((p) => p.draftId === where.draftId && p.locale === where.locale) ?? null,
        findUnique: async ({ where }: { where: { locale_slug?: { locale: string; slug: string }; id?: string } }) =>
          where.locale_slug ? posts.find((p) => p.locale === where.locale_slug!.locale && p.slug === where.locale_slug!.slug) ?? null : null,
        upsert: async ({ where, create, update }: { where: { groupId_locale: { groupId: string; locale: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const hit = posts.find((p) => p.groupId === where.groupId_locale.groupId && p.locale === where.groupId_locale.locale);
          if (hit) return Object.assign(hit, update);
          const row = { id: randomUUID(), ...create };
          posts.push(row);
          return row;
        },
      },
    };
    const blog = new BlogService({} as never, {} as never);
    const article = { title: 'Küçük salon', description: 'd'.repeat(120), slug: 'kucuk-salon', body: 'b'.repeat(300) };
    const draft = { id: randomUUID(), locale: 'tr', input: { mode: 'write' }, output: article };
    await blog.publish(tx as never, draft as never, 'admin');
    await blog.publish(tx as never, { ...draft, output: { ...article, body: 'yeni '.repeat(80) } } as never, 'admin');
    expect(posts).toHaveLength(1);
    expect(String(posts[0].body)).toContain('yeni');
    // Another article may still not take the slug.
    await expect(blog.publish(tx as never, { ...draft, id: randomUUID() } as never, 'admin')).rejects.toMatchObject({ status: 409, code: 'slug_taken' });
  });
});

describe('review: commercial-message check (6563 / İYS)', () => {
  const sig = (body: string) => commercialSignals({ title: 'Duyuru', body });

  it('is not fooled by spaced-out letters or digits for letters', () => {
    expect(sig('i n d i r i m başladı')).toContain('indirim');
    expect(sig('i.n.d.i.r.i.m')).toContain('indirim');
    expect(sig('1nd1r1m günleri')).toContain('indirim');
  });

  it('knows the other campaign languages and currencies', () => {
    expect(sig('Jetzt Rabatt sichern')).toContain('yabanci_ticari');
    expect(sig('Oferta especial')).toContain('yabanci_ticari');
    expect(sig('今だけ割引')).toContain('yabanci_ticari');
    expect(sig('Скидка на подписку')).toContain('yabanci_ticari');
    expect(sig('Nur 9,99 €')).toContain('para_birimi');
  });

  it('still lets plain service text through in any language', () => {
    for (const body of ['Kapadokya stilini stüdyoda dene.', 'Neue Stile sind da', 'Il nuovo stile è arrivato', '新しいスタイルが追加されました']) {
      expect(sig(body)).toEqual([]);
    }
  });
});

describe('review: log masking (LOG-02)', () => {
  it('drops secret keys and masks e-mail addresses inside text', () => {
    const out = scrub({ email: 'a@b.co', idToken: 'x', backupCode: 'y', 'x-admin-panel-key': 'z', error: 'user ayse.yilmaz@example.com not found', ip: '203.0.113.7' }) as Record<string, string>;
    expect(out).toMatchObject({ email: '[redacted]', idToken: '[redacted]', backupCode: '[redacted]', 'x-admin-panel-key': '[redacted]', ip: '203.0.113.7' });
    expect(out.error).toBe('user [email] not found');
  });
});

describe('review: client IP behind the BFF', () => {
  const req = (xff?: string) => ({ socket: { remoteAddress: '127.0.0.1' }, headers: xff ? { 'x-forwarded-for': xff } : {} }) as never;

  it('uses the IP the BFF forwards (one trusted hop), not the BFF itself', () => {
    expect(resolveClientIp(req('203.0.113.7'), 1)).toBe('203.0.113.7');
    expect(resolveClientIp(req(), 1)).toBe('127.0.0.1');
    // A browser-supplied value never reaches the backend: nginx overwrites it and the BFF forwards only the last entry.
    expect(resolveClientIp(req('6.6.6.6, 203.0.113.7'), 1)).toBe('203.0.113.7');
  });
});

import { describe, expect, it } from 'vitest';
import { TrackEventBody } from './app-events/app-events.schema.js';
import { AppEventsService } from './app-events/app-events.service.js';

// App event tracking (API.md §7.55): white-listed names, anonymous or signed-in, admin funnel.

describe('app events', () => {
  it('accepts only white-listed event names with bounded meta', () => {
    expect(TrackEventBody.parse({ name: 'share_link_created' }).name).toBe('share_link_created');
    expect(TrackEventBody.parse({ name: 'studio_open', platform: 'web', meta: { tool: 'redesign' } }).meta).toEqual({ tool: 'redesign' });
    expect(() => TrackEventBody.parse({ name: 'custom_event' })).toThrow();
    expect(() => TrackEventBody.parse({ name: 'share_link_created', platform: 'desktop' })).toThrow();
  });

  it('refuses anything big or nested on the public endpoint (INP, RES-01)', () => {
    const bad = (body: Record<string, unknown>) => TrackEventBody.safeParse({ name: 'studio_open', ...body }).success;
    expect(bad({ meta: { designId: 'd1', tool: 'redesign', count: 2, ok: true } })).toBe(true);
    expect(bad({ meta: { nested: { a: 1 } } })).toBe(false);
    expect(bad({ meta: { note: 'x'.repeat(81) } })).toBe(false);
    expect(bad({ meta: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i])) })).toBe(false);
    expect(bad({ meta: { 'bad key': 1 } })).toBe(false);
    expect(bad({ userId: 'someone-else' })).toBe(false); // the user comes only from a valid session
    expect(bad({ sessionId: 'x' })).toBe(false);
  });

  it('builds a funnel from raw event counts', async () => {
    const rows = [
      { name: 'studio_open', total: 100, users: 80 },
      { name: 'generate_start', total: 60, users: 50 },
      { name: 'generate_success', total: 40, users: 35 },
      { name: 'share_link_created', total: 10, users: 8 },
    ];
    const prisma = {
      $queryRaw: async () => rows,
    } as never;
    const svc = new AppEventsService(prisma);
    const out = await svc.funnel(30);
    expect(out.days).toBe(30);
    expect(out.steps.find((s) => s.name === 'studio_open')?.users).toBe(80);
    expect(out.steps.find((s) => s.name === 'generate_success')?.conversionFromFirst).toBe(43.8);
    expect(out.steps.find((s) => s.name === 'share_link_created')?.conversionFromPrevious).toBe(22.9);
  });
});

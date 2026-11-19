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

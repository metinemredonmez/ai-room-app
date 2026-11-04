import { AiError } from './ai/ai.client.js';
import { TOOLS, TOOL_IDS } from './catalog/catalog.data.js';
import { AppError } from './common/errors.js';
import { CreateDesignSchema, DesignsService, PointsSchema, SelectionSchema } from './designs/designs.service.js';

// API.md §7.15: tap selection. INP-01 (bounded input), AZ-01 (own photos only), RES-01 (paid calls are recorded).

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
const usage = { provider: 'falai', model: 'fal-ai/sam-3/image', kind: 'segment' as const, cost_usd: 0.005 };

function service(opts: { owned?: boolean; consent?: boolean; requireConsent?: boolean; segment?: () => Promise<unknown> } = {}) {
  const calls = { segment: 0, recorded: [] as unknown[] };
  const images = {
    owned: async () => {
      if (opts.owned === false) throw new AppError(404, 'not_found', 'Görsel bulunamadı');
      return { id: 'img' };
    },
    read: async () => Buffer.from('jpeg'),
  };
  const ai = {
    segment: async () => {
      calls.segment++;
      return opts.segment ? opts.segment() : { mask_b64: PNG, coverage: 0.12, method: 'sam3', usage };
    },
  };
  const settings = { current: { maintenance: { enabled: false }, requireAiConsent: opts.requireConsent ?? false } };
  const consents = { hasCurrent: async () => opts.consent ?? true };
  const usageSvc = { record: async (u: unknown) => void calls.recorded.push(u) };
  const designs = new DesignsService(
    {} as never, images as never, {} as never, {} as never, ai as never, settings as never, usageSvc as never,
    {} as never, consents as never, { MAX_CONCURRENT_GENERATIONS: 1 } as never,
  );
  return { designs, calls };
}

describe('tap selection input (INP-01)', () => {
  it('accepts 1–8 points inside the photo and nothing else', () => {
    expect(PointsSchema.safeParse([{ x: 0, y: 1 }]).success).toBe(true);
    expect(PointsSchema.safeParse([]).success).toBe(false);
    expect(PointsSchema.safeParse([{ x: 1.01, y: 0.5 }]).success).toBe(false);
    expect(PointsSchema.safeParse([{ x: 0.5, y: 0.5, label: 0 }]).success).toBe(false);
    expect(PointsSchema.safeParse(Array.from({ length: 9 }, () => ({ x: 0.5, y: 0.5 }))).success).toBe(false);
    expect(SelectionSchema.safeParse({ points: [{ x: 0.5, y: 0.5 }], extra: 1 }).success).toBe(false);
    const design = { tool: 'replace', inputImageId: '6f1c2b0a-1d2e-4f3a-8b4c-5d6e7f8a9b0c', points: [{ x: 0.2, y: 0.7 }] };
    expect(CreateDesignSchema.safeParse(design).success).toBe(true);
  });

  it('is offered only by the object tools', () => {
    expect(TOOL_IDS.filter((id) => TOOLS[id].needs.points).sort()).toEqual(['declutter', 'paint', 'replace']);
  });
});

describe('selection preview', () => {
  it('returns the mask as a PNG data URI and records the cost', async () => {
    const { designs, calls } = service();
    const out = await designs.selection('u1', 'img', { points: [{ x: 0.3, y: 0.6 }] }, 'rid');
    expect(out).toEqual({ mask: `data:image/png;base64,${PNG}`, coverage: 0.12, method: 'sam3' });
    expect(calls.recorded).toEqual([usage]);
  });

  it("never segments someone else's photo (AZ-01)", async () => {
    const { designs, calls } = service({ owned: false });
    await expect(designs.selection('u2', 'img', { points: [{ x: 0.3, y: 0.6 }] }, 'rid')).rejects.toMatchObject({ status: 404 });
    expect(calls.segment).toBe(0);
  });

  it('needs taps or a name, and the AI-processing consent when required', async () => {
    await expect(service().designs.selection('u1', 'img', {}, 'rid')).rejects.toMatchObject({ status: 400 });
    const { designs, calls } = service({ requireConsent: true, consent: false });
    await expect(designs.selection('u1', 'img', { target: 'koltuk' }, 'rid')).rejects.toMatchObject({ status: 403, code: 'consent_required' });
    expect(calls.segment).toBe(0);
  });

  it('records the cost of a failed selection and refuses a mask that is not a PNG', async () => {
    const failed = service({ segment: () => Promise.reject(new AiError(422, 'selection_failed', 'x', false, usage)) });
    await expect(failed.designs.selection('u1', 'img', { points: [{ x: 0.3, y: 0.6 }] }, 'rid')).rejects.toMatchObject({ code: 'selection_failed' });
    expect(failed.calls.recorded).toEqual([usage]);
    const html = Buffer.from('<svg onload=alert(1)>').toString('base64');
    const bad = service({ segment: async () => ({ mask_b64: html, coverage: 0.1, method: 'sam3', usage }) });
    await expect(bad.designs.selection('u1', 'img', { points: [{ x: 0.3, y: 0.6 }] }, 'rid')).rejects.toMatchObject({ status: 502 });
  });
});

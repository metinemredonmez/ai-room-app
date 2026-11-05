import { AiError, type EngineCatalog } from './ai/ai.client.js';
import { EngineService, engineIssues, parseEngine } from './ai/engine.service.js';

// API.md §7.27: the image provider chain and models from the admin. The panel chooses only among providers that have
// keys and models the server allows; nothing is saved when the AI service cannot confirm that (fail-closed); two
// admins cannot overwrite each other (BUS-02); null returns to the server's own chain.

const CATALOG: EngineCatalog = {
  providers: [
    { name: 'mock', configured: true, usable: false, default_model: 'mock-tint', models: [{ id: 'mock-tint', label: 'Demo', cost_usd: 0 }] },
    { name: 'gemini', configured: true, usable: true, default_model: 'gemini-3.1-flash-image', models: [{ id: 'gemini-3.1-flash-image', label: 'Gemini', cost_usd: 0.067 }] },
    { name: 'falai', configured: true, usable: true, default_model: 'fal-ai/flux-2/klein/4b/edit', models: [{ id: 'fal-ai/flux-2/klein/4b/edit', label: 'klein 4B', cost_usd: 0.012 }, { id: 'fal-ai/other/edit', label: 'Other', cost_usd: 0.03 }] },
    { name: 'replicate', configured: false, usable: false, default_model: 'black-forest-labs/flux-kontext-pro', models: [] },
  ],
  default_chain: ['gemini'],
  breakers: [],
};

function setup(opts: { aiDown?: boolean } = {}) {
  let row: { value: unknown; updatedAt: Date; updatedBy: string } | null = null;
  const tx = {
    $queryRaw: async () => [{ locked: 1 }],
    setting: {
      findUnique: async () => row,
      upsert: async ({ create }: { create: { value: unknown; updatedBy: string } }) => (row = { value: structuredClone(create.value), updatedAt: new Date(Date.now() + Math.random() * 1000), updatedBy: create.updatedBy }),
      delete: async () => void (row = null),
    },
  };
  const prisma = { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx), user: { findUnique: async () => ({ name: 'Ada', email: 'a@x' }) } };
  const ai = {
    engineCatalog: async () => {
      if (opts.aiDown) throw new AiError(502, 'ai_unavailable', 'x', true);
      return CATALOG;
    },
  };
  return { svc: new EngineService(prisma as never, ai as never), row: () => row };
}

describe('image engine from the admin', () => {
  it('nothing chosen: generations use the server chain (nothing is sent)', async () => {
    const { svc } = setup();
    await svc.reload();
    expect(svc.current).toBeUndefined();
  });

  it('only providers with keys and allowed models can be chosen, with the reason in Turkish', () => {
    expect(engineIssues({ chain: ['falai', 'gemini'], models: { falai: 'fal-ai/other/edit' } }, CATALOG)).toEqual([]);
    expect(engineIssues({ chain: ['replicate'], models: {} }, CATALOG)).toEqual(['replicate: sunucuda anahtarı yok ya da burada kullanılamaz']);
    expect(engineIssues({ chain: ['mock'], models: {} }, CATALOG)).toHaveLength(1);
    expect(engineIssues({ chain: ['dalle'], models: {} }, CATALOG)).toEqual(['“dalle” diye bir sağlayıcı yok']);
    expect(engineIssues({ chain: ['gemini', 'gemini'], models: {} }, CATALOG)).toEqual(['bir sağlayıcı zincirde bir kez olabilir']);
    expect(engineIssues({ chain: ['gemini'], models: { gemini: 'gemini-made-up' } }, CATALOG)).toEqual(['gemini: “gemini-made-up” izinli modeller arasında değil']);
    expect(engineIssues({ chain: ['gemini'], models: { falai: 'fal-ai/other/edit' } }, CATALOG)).toEqual(['falai: zincirde olmayan sağlayıcıya model seçilemez']);
  });

  it('a saved choice goes with every generation; null returns to the server chain', async () => {
    const { svc, row } = setup();
    await svc.reload();
    await svc.save({ chain: ['falai', 'gemini'], models: { falai: 'fal-ai/other/edit' } }, null, 'admin');
    expect(svc.current).toEqual({ chain: ['falai', 'gemini'], models: { falai: 'fal-ai/other/edit' } });
    const version = row()!.updatedAt.toISOString();
    const { previous } = await svc.save(null, version, 'admin');
    expect(previous).toEqual({ chain: ['falai', 'gemini'], models: { falai: 'fal-ai/other/edit' } });
    expect(row()).toBeNull();
    expect(svc.current).toBeUndefined();
  });

  it('an invalid choice is refused and nothing changes; without the AI service nothing is saved (fail-closed)', async () => {
    const { svc, row } = setup();
    await svc.reload();
    await expect(svc.save({ chain: ['replicate'], models: {} }, null, 'admin')).rejects.toMatchObject({ status: 400, code: 'invalid_engine' });
    expect(row()).toBeNull();
    const down = setup({ aiDown: true });
    await down.svc.reload();
    await expect(down.svc.save({ chain: ['gemini'], models: {} }, null, 'admin')).rejects.toMatchObject({ status: 502 });
    expect(down.row()).toBeNull();
  });

  it('two admins cannot overwrite each other (BUS-02)', async () => {
    const { svc } = setup();
    await svc.reload();
    await svc.save({ chain: ['gemini'], models: {} }, null, 'a1');
    await expect(svc.save({ chain: ['falai'], models: {} }, null, 'a2')).rejects.toMatchObject({ status: 409, code: 'version_conflict' });
  });

  it('the panel sees a saved choice the server can no longer honour', async () => {
    const { svc } = setup();
    await svc.reload();
    await svc.save({ chain: ['falai'], models: { falai: 'fal-ai/other/edit' } }, null, 'admin');
    CATALOG.providers[2].models.pop(); // the model left the server's allowlist
    const view = await svc.forAdmin();
    expect(view.ignored).toEqual(['falai: “fal-ai/other/edit” izinli modeller arasında değil']);
    expect(view.updatedBy).toBe('Ada');
    CATALOG.providers[2].models.push({ id: 'fal-ai/other/edit', label: 'Other', cost_usd: 0.03 });
  });

  it('stored junk is never sent', () => {
    expect(parseEngine({ chain: [], models: {} })).toBeNull();
    expect(parseEngine({ chain: ['gemini'], models: {}, extra: 1 })).toBeNull();
    expect(parseEngine({ chain: ['Gemini!'] })).toBeNull();
    expect(parseEngine({ chain: ['gemini'] })).toEqual({ chain: ['gemini'], models: {} });
  });
});

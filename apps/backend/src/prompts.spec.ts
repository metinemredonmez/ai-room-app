import { randomUUID } from 'node:crypto';
import { AiError } from './ai/ai.client.js';
import { PromptTemplatesService, parseActive, templateIssues } from './prompts/prompts.service.js';

// API.md §7.26: image prompt templates from the admin. Only the tool's own templates go with a generation; a
// template is checked by the AI service before it goes live (fail-closed); two admins cannot overwrite each other
// (BUS-02); any earlier version or the default can be put back.

const KEYS = ['keep', 'redesign', 'declutter', 'declutter_all', 'paint', 'replace'];

function setup(opts: { aiDown?: boolean } = {}) {
  let setting: { value: unknown; updatedAt: Date } | null = null;
  const versions: Array<{ id: string; key: string; text: string; note: string; createdById: string | null; createdAt: Date }> = [];
  const tx = {
    $queryRaw: async () => [{ locked: 1 }],
    setting: {
      findUnique: async () => setting,
      upsert: async ({ create }: { create: { value: unknown } }) => (setting = { value: structuredClone(create.value), updatedAt: new Date() }),
    },
    promptVersion: {
      create: async ({ data }: { data: { key: string; text: string; note: string; createdById: string } }) => {
        const v = { id: randomUUID(), createdAt: new Date(Date.now() + versions.length), ...data };
        versions.push(v);
        return v;
      },
    },
  };
  const prisma = {
    ...tx,
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    promptVersion: {
      ...tx.promptVersion,
      findMany: async ({ where }: { where?: { id?: { in: string[] } } } = {}) =>
        where?.id ? versions.filter((v) => where.id!.in.includes(v.id)) : [...versions].reverse(),
      findUnique: async ({ where }: { where: { id: string } }) => versions.find((v) => v.id === where.id) ?? null,
    },
    user: { findMany: async () => [] },
  };
  const down = () => {
    throw new AiError(502, 'ai_unavailable', 'x', true);
  };
  const ai = {
    promptCatalog: async () =>
      opts.aiDown ? down() : { templates: KEYS.map((key) => ({ key, tool: key === 'keep' ? '' : key.split('_')[0], default: `default ${key} {keep}`, placeholders: [], required: [] })), placeholders: {} },
    previewPrompt: async ({ key, template }: { key: string; template: string }) => {
      if (opts.aiDown) down();
      if (!KEYS.includes(key)) return { prompt: null, errors: ['unknown_key'] };
      const errors = template.includes('{style}') && key === 'paint' ? ['unknown_placeholder:style'] : template.length < 10 ? ['length'] : [];
      return { prompt: errors.length ? null : template, errors };
    },
  };
  const svc = new PromptTemplatesService(prisma as never, ai as never);
  return { svc, versions, setting: () => setting };
}

describe('image prompt templates from the admin', () => {
  it('until something is published every tool uses the service defaults (nothing is sent)', async () => {
    const { svc } = setup();
    await svc.reload();
    expect(svc.forTool('paint')).toEqual({ versions: {} });
  });

  it('a generation gets only its own tool’s templates plus the shared sentence', async () => {
    const { svc } = setup();
    await svc.reload();
    const a = await svc.publish('paint', 'Paint {walls} in {color}. {keep}', 'eggshell finish', null, 'admin');
    await svc.publish('keep', 'Keep the room exactly as it is.', 'shorter', null, 'admin');
    await svc.publish('declutter_all', 'Empty this {room} completely. {keep}', 'test', null, 'admin');
    const paint = svc.forTool('paint');
    expect(Object.keys(paint.templates!).sort()).toEqual(['keep', 'paint']);
    expect(paint.versions.paint).toBe(a.versionId);
    expect(Object.keys(svc.forTool('declutter').templates!).sort()).toEqual(['declutter_all', 'keep']);
    expect(Object.keys(svc.forTool('redesign').templates!)).toEqual(['keep']);
  });

  it('a template the AI service refuses is not published, with the reason in Turkish (INP-01)', async () => {
    const { svc, versions } = setup();
    await svc.reload();
    await expect(svc.publish('paint', 'Repaint as a {style}', 'x note', null, 'admin')).rejects.toMatchObject({ status: 400, code: 'invalid_template', message: expect.stringContaining('{style} bu şablonda kullanılamaz') });
    await expect(svc.publish('no_such_key', 'Some long enough template', 'note', null, 'admin')).rejects.toMatchObject({ status: 404 });
    await expect(svc.publish('../etc', 'Some long enough template', 'note', null, 'admin')).rejects.toMatchObject({ status: 404 });
    expect(versions).toHaveLength(0);
  });

  it('nothing goes live when the AI service cannot check it (fail-closed)', async () => {
    const { svc, versions } = setup({ aiDown: true });
    await svc.reload();
    await expect(svc.publish('paint', 'Paint {walls} in {color}. {keep}', 'note', null, 'admin')).rejects.toMatchObject({ status: 502 });
    expect(versions).toHaveLength(0);
  });

  it('two admins cannot overwrite each other; publishing the live text again is refused', async () => {
    const { svc } = setup();
    await svc.reload();
    const first = await svc.publish('replace', 'Swap the {thing} for {replacement}. {keep}', 'first', null, 'a1');
    await expect(svc.publish('replace', 'Change the {thing} into {replacement}. {keep}', 'second', null, 'a2')).rejects.toMatchObject({ status: 409, code: 'version_conflict' });
    await expect(svc.publish('replace', 'Swap the {thing} for {replacement}. {keep}', 'again', first.versionId, 'a1')).rejects.toMatchObject({ status: 400, code: 'no_change' });
  });

  it('an earlier version or the default can be put back; a version of another key cannot', async () => {
    const { svc, setting } = setup();
    await svc.reload();
    const v1 = await svc.publish('paint', 'Paint {walls} in {color}. {keep}', 'v1', null, 'admin');
    const v2 = await svc.publish('paint', 'Repaint {walls} using {color}, satin. {keep}', 'v2', v1.versionId, 'admin');
    const other = await svc.publish('replace', 'Swap the {thing} for {replacement}. {keep}', 'r1', null, 'admin');
    await expect(svc.activate('paint', other.versionId!, v2.versionId, 'admin')).rejects.toMatchObject({ status: 404 });
    const back = await svc.activate('paint', v1.versionId, v2.versionId, 'admin');
    expect(back).toEqual({ previous: v2.versionId, versionId: v1.versionId });
    expect(svc.forTool('paint').templates!.paint).toBe('Paint {walls} in {color}. {keep}');
    await svc.activate('paint', null, v1.versionId, 'admin');
    expect(svc.forTool('paint')).toEqual({ versions: {} });
    expect(parseActive(setting()!.value)).toEqual({ replace: other.versionId });
  });

  it('the admin list shows the live text, the default and the history newest first', async () => {
    const { svc } = setup();
    await svc.reload();
    const v1 = await svc.publish('paint', 'Paint {walls} in {color}. {keep}', 'v1', null, 'admin');
    await svc.publish('paint', 'Repaint {walls} using {color}, satin. {keep}', 'v2', v1.versionId, 'admin');
    const list = await svc.forAdmin();
    const paint = list.templates.find((t) => t.key === 'paint')!;
    expect(paint).toMatchObject({ default: 'default paint {keep}', text: 'Repaint {walls} using {color}, satin. {keep}' });
    expect(paint.versions.map((v) => v.note)).toEqual(['v2', 'v1']);
    expect(list.templates.find((t) => t.key === 'redesign')).toMatchObject({ activeVersionId: null, text: 'default redesign {keep}' });
  });

  it('stored junk never reaches a generation; reasons read in Turkish', () => {
    expect(parseActive({ paint: 'not-a-uuid', '../x': randomUUID(), keep: 5, redesign: randomUUID() })).toEqual({ redesign: expect.any(String) });
    expect(parseActive(['x'])).toEqual({});
    expect(templateIssues(['missing_placeholder:color', 'stray_brace', 'keep:length'])).toBe(
      '{color} şablonda bulunmalı; süslü parantez yalnız {alan} biçiminde kullanılabilir; uzunluk 10–1500 karakter olmalı (ortak cümlede en çok 600)',
    );
  });
});

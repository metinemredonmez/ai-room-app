import type { Config } from './config.js';
import type { PrismaService } from './common/infra.js';
import { SettingsSchema, type SettingsService } from './settings/settings.service.js';
import { SitePreviewService } from './site/site-preview.service.js';

// API.md §7.52: the web site's maintenance switch and the staff preview link. A row saved before the switch existed
// must still parse (a failed parse falls back to every default); only the link's hash is stored; a new link
// replaces the old one; malformed or cancelled tokens never pass.

function fakePrisma() {
  const rows = new Map<string, { key: string; value: unknown; updatedBy: string | null; updatedAt: Date }>();
  return {
    rows,
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null,
      upsert: async ({ where, create }: { where: { key: string }; create: { key: string; value: unknown; updatedBy: string } }) => {
        rows.set(where.key, { key: create.key, value: create.value, updatedBy: create.updatedBy, updatedAt: new Date() });
      },
      deleteMany: async ({ where }: { where: { key: string } }) => ({ count: rows.delete(where.key) ? 1 : 0 }),
    },
    user: { findUnique: async () => ({ id: 'a1', email: 'admin@example.test', name: 'Admin' }) },
  };
}

const maintenance = { enabled: false, site: true, messageTr: 'Bakımdayız.', messageEn: 'Down for maintenance.' };
const make = (prisma = fakePrisma(), m: Record<string, unknown> = maintenance, aiCrawlers = { assistants: true, training: false }) => ({
  prisma,
  svc: new SitePreviewService(prisma as unknown as PrismaService, { current: { maintenance: m, aiCrawlers } } as unknown as SettingsService, { WEB_APP_URL: 'https://casalume.app' } as Config),
});
const tokenOf = (url: string) => new URL(url).hash.replace('#onizleme=', '');

describe('site maintenance switch', () => {
  it('a maintenance row saved before the switch existed still parses, with the site open', () => {
    const shape = SettingsSchema.shape.maintenance;
    expect(shape.parse({ enabled: true, messageTr: 'a', messageEn: 'b' })).toEqual({ enabled: true, site: false, messageTr: 'a', messageEn: 'b' });
    expect(shape.safeParse({ enabled: false, site: 'yes', messageTr: '', messageEn: '' }).success).toBe(false);
  });

  it('public status carries the message only while the site is closed', () => {
    expect(make().svc.status).toEqual({ maintenance: true, messageTr: 'Bakımdayız.', messageEn: 'Down for maintenance.' });
    expect(make(fakePrisma(), { ...maintenance, site: false }).svc.status).toEqual({ maintenance: false, messageTr: '', messageEn: '' });
  });
});

describe('AI crawler switches (API.md §7.53)', () => {
  it('public answer mirrors the setting; only booleans are accepted', () => {
    expect(make().svc.discovery).toEqual({ aiAssistants: true, aiTraining: false });
    const shape = SettingsSchema.shape.aiCrawlers;
    expect(shape.safeParse({ assistants: true, training: true }).success).toBe(true);
    expect(shape.safeParse({ assistants: 'yes', training: true }).success).toBe(false);
    expect(shape.safeParse({ assistants: true, training: true, extra: 1 }).success).toBe(false);
  });
});

describe('staff preview link', () => {
  it('stores only the hash; the link token verifies, others do not', async () => {
    const { prisma, svc } = make();
    const { url, info } = await svc.rotate('a1');
    expect(url).toMatch(/^https:\/\/casalume\.app\/#onizleme=[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(url);
    expect(JSON.stringify([...prisma.rows.values()])).not.toContain(token);
    expect(info).toMatchObject({ active: true, createdBy: { id: 'a1' } });
    expect(await svc.verify(token)).toBe(true);
    expect(await svc.verify(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).toBe(false);
    expect(await svc.verify('')).toBe(false);
    expect(await svc.verify(`${token}x`)).toBe(false);
    expect(await svc.verify('../../etc/passwd')).toBe(false);
  });

  it('a new link replaces the old one; cancelling stops it', async () => {
    const { svc } = make();
    const first = tokenOf((await svc.rotate('a1')).url);
    const second = tokenOf((await svc.rotate('a1')).url);
    expect(first).not.toBe(second);
    expect(await svc.verify(first)).toBe(false);
    expect(await svc.verify(second)).toBe(true);
    expect(await svc.revoke()).toBe(true);
    expect(await svc.verify(second)).toBe(false);
    expect(await svc.revoke()).toBe(false);
    expect(await svc.info()).toEqual({ active: false, createdAt: null, createdBy: null });
  });

  it('a corrupt stored row never lets anything through', async () => {
    const { prisma, svc } = make();
    prisma.rows.set('site.preview', { key: 'site.preview', value: { hash: 'nope' }, updatedBy: null, updatedAt: new Date() });
    expect(await svc.verify('A'.repeat(43))).toBe(false);
    expect((await svc.info()).active).toBe(false);
  });
});

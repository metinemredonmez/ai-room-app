import { BUILTIN_THEME, contrast, contrastReport, deriveTokens, parseTheme, publicTheme, themeDiff, ThemeSchema, type Theme } from './theme/theme.rules.js';
import { ThemeService } from './theme/theme.service.js';

// API.md §7.34: colour themes from the admin. Every shipped palette must be readable; nothing but #rrggbb colours and
// slug ids may reach the web's <style> element; a palette that fails contrast cannot be switched on.

const clone = (t: Theme): Theme => JSON.parse(JSON.stringify(t)) as Theme;

describe('theme rules', () => {
  it('contrast matches WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#777777')).toBeCloseTo(4.48, 2);
  });

  it('every built-in palette passes the blocking checks', () => {
    expect(BUILTIN_THEME.palettes).toHaveLength(36);
    for (const p of BUILTIN_THEME.palettes) expect({ id: p.id, blocking: contrastReport(p.tokens).blocking }).toEqual({ id: p.id, blocking: [] });
    expect(ThemeSchema.safeParse(BUILTIN_THEME).success).toBe(true);
  });

  it('derived tokens: dark text on the lightest tone, white text on the primary', () => {
    const k = deriveTokens(['#211713', '#493126', '#78533B', '#B18A62', '#E0C58E', '#F6EEDB']);
    expect(k.text).toBe('#211713');
    expect(k.primary).toBe('#78533b'); // #B18A62 is too light for white button text (3.1:1)
    expect(contrast('#ffffff', k.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(k.muted, k.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('a too-light palette fails the blocking checks', () => {
    const k = deriveTokens(['#9a9a9a', '#aaaaaa', '#bbbbbb', '#cccccc', '#dddddd', '#eeeeee']);
    expect(contrastReport(k).blocking.length).toBeGreaterThan(0);
  });

  it('nothing but #rrggbb colours and slug ids pass (no CSS or markup through a theme)', () => {
    const bad = (mut: (t: Theme) => void) => {
      const t = clone(BUILTIN_THEME);
      mut(t);
      return ThemeSchema.safeParse(t).success;
    };
    expect(bad(() => undefined)).toBe(true);
    expect(bad((t) => (t.palettes[0].tokens.primary = 'red;}</style><script>alert(1)</script>'))).toBe(false);
    expect(bad((t) => (t.palettes[0].tokens.primary = '#fff'))).toBe(false);
    expect(bad((t) => (t.palettes[0].tones[2] = 'url(x)'))).toBe(false);
    expect(bad((t) => (t.palettes[1].id = 'x"]{}'))).toBe(false);
    expect(bad((t) => (t.palettes[1].id = 'kil'))).toBe(false); // duplicate
    expect(bad((t) => (t.defaultId = 'yok'))).toBe(false);
    expect(bad((t) => (t.palettes[0].enabled = false))).toBe(false); // default switched off
    expect(bad((t) => ((t.palettes[0] as unknown as Record<string, unknown>).css = 'x'))).toBe(false);
    // Upper-case input is normalised, not refused.
    const up = clone(BUILTIN_THEME);
    up.palettes[0].tokens.primary = '#A9532E';
    expect(ThemeSchema.parse(up).palettes[0].tokens.primary).toBe('#a9532e');
  });

  it('a stored theme that is junk or unreadable falls back to the built-in set', () => {
    expect(parseTheme(undefined)).toEqual({ theme: BUILTIN_THEME, ok: true });
    expect(parseTheme({ defaultId: 'x' }).ok).toBe(false);
    const t = clone(BUILTIN_THEME);
    t.palettes[4].tokens.primary = '#f0f0f0';
    expect(parseTheme(t)).toEqual({ theme: BUILTIN_THEME, ok: false });
  });

  it('a saved set gets built-ins added later, but a built-in it deleted stays deleted', () => {
    const saved = { defaultId: 'kil', palettes: BUILTIN_THEME.palettes.filter((p) => !['ocean-ink', 'graphite', 'erik'].includes(p.id)), seen: BUILTIN_THEME.palettes.map((p) => p.id).filter((id) => !['ocean-ink', 'graphite'].includes(id)) };
    const ids = parseTheme(saved).theme.palettes.map((p) => p.id);
    expect(ids).toContain('ocean-ink'); // new since that save
    expect(ids).toContain('graphite');
    expect(ids).not.toContain('erik'); // deleted on purpose
    // A set saved before `seen` existed gets every built-in it lacks.
    expect(parseTheme({ defaultId: 'kil', palettes: [BUILTIN_THEME.palettes[0]] }).theme.palettes).toHaveLength(36);
  });

  it('clients get enabled palettes only, default first; the audit gets a readable diff', () => {
    const t = clone(BUILTIN_THEME);
    t.defaultId = 'kahve';
    t.palettes.find((p) => p.id === 'orman')!.enabled = false;
    const pub = publicTheme(t);
    expect(pub.defaultId).toBe('kahve');
    expect(pub.palettes[0].id).toBe('kahve');
    expect(pub.palettes.map((p) => p.id)).not.toContain('orman');
    expect(Object.keys(pub.palettes[0]).sort()).toEqual(['id', 'name', 'tokens', 'tones']);
    t.palettes = t.palettes.filter((p) => p.id !== 'petrol');
    expect(themeDiff(BUILTIN_THEME, t)).toEqual(['varsayılan: kil → kahve', 'orman: kapandı', 'silindi: petrol']);
  });
});

describe('theme service', () => {
  function setup() {
    let row: { key: string; value: unknown; updatedAt: Date; updatedBy: string | null } | null = null;
    const setting = {
      findUnique: async () => row,
      upsert: async ({ create, update }: { create: { key: string; value: unknown; updatedBy: string }; update: { value: unknown; updatedBy: string } }) => {
        row = row ? { ...row, ...update, updatedAt: new Date(row.updatedAt.getTime() + 1000) } : { ...create, updatedAt: new Date(1_800_000_000_000) };
      },
    };
    const prisma = {
      setting,
      user: { findUnique: async () => ({ name: 'Yönetici', email: 'a@example.com' }) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ setting, $queryRaw: async () => [] }),
    };
    return new ThemeService(prisma as never);
  }

  it('saves under the loaded version, refuses a stale one and an unreadable enabled palette', async () => {
    const svc = setup();
    await svc.reload();
    expect(svc.public.defaultId).toBe('kil');
    const next = clone(BUILTIN_THEME);
    next.defaultId = 'kahve';
    const out = await svc.save(next, null, 'admin-1');
    expect(out.changes).toEqual(['varsayılan: kil → kahve']);
    expect(svc.public.defaultId).toBe('kahve');
    await expect(svc.save(next, null, 'admin-1')).rejects.toMatchObject({ status: 409 });

    const version = (await svc.forAdmin()).version;
    const unreadable = clone(next);
    unreadable.palettes.push({ id: 'soluk', name: { tr: 'Soluk', en: 'Pale' }, tones: ['#9a9a9a', '#aaaaaa', '#bbbbbb', '#cccccc', '#dddddd', '#eeeeee'], tokens: deriveTokens(['#9a9a9a', '#aaaaaa', '#bbbbbb', '#cccccc', '#dddddd', '#eeeeee']), enabled: true });
    await expect(svc.save(unreadable, version, 'admin-1')).rejects.toMatchObject({ status: 400 });
    unreadable.palettes[unreadable.palettes.length - 1].enabled = false; // kept as a switched-off draft
    await expect(svc.save(unreadable, version, 'admin-1')).resolves.toEqual({ changes: ['eklendi: soluk (kapalı)'] });
    expect(svc.public.palettes.map((p) => p.id)).not.toContain('soluk');
  });
});

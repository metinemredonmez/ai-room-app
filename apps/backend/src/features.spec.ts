import { AuthController } from './auth/auth.controller.js';
import { BlogController } from './blog/blog.controller.js';
import { DEFAULT_FLAGS, FEATURE_KEYS, FeaturesService, FlagsInputSchema, flagsDiff, parseFlags, type Flags } from './features/features.service.js';
import { SupportController } from './support/support.controller.js';

// API.md §7.28: feature flags from the admin. Every flag starts on; a switched-off feature is refused on the server
// (403 `feature_disabled`, 404 for public blog pages) whatever an old client still shows; saving is versioned (BUS-02).

function service(stored: unknown = undefined) {
  let row: { value: unknown; updatedAt: Date; updatedBy: string } | null = stored === undefined ? null : { value: stored, updatedAt: new Date('2026-11-05T08:00:00Z'), updatedBy: 'a0' };
  const tx = {
    $queryRaw: async () => [{ locked: 1 }],
    setting: {
      findUnique: async () => row,
      upsert: async ({ create }: { create: { value: unknown; updatedBy: string } }) => (row = { value: structuredClone(create.value), updatedAt: new Date(Date.now() + 1000), updatedBy: create.updatedBy }),
    },
  };
  const prisma = { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx), user: { findUnique: async () => null } };
  return new FeaturesService(prisma as never);
}

const off = (key: keyof Flags): Flags => ({ ...DEFAULT_FLAGS, [key]: false });

describe('feature flags', () => {
  it('every flag starts on, so nothing changes until someone switches one off', async () => {
    const svc = service();
    await svc.reload();
    expect(Object.values(svc.current).every(Boolean)).toBe(true);
    expect(FEATURE_KEYS).toEqual(['assistant_chat', 'cost_analysis', 'tap_selection', 'support_tickets', 'guest_mode', 'signup', 'blog']);
  });

  it('stored flags apply; a flag added later takes its default; junk falls back to defaults and is reported', () => {
    expect(parseFlags({ blog: false }).flags).toEqual(off('blog'));
    expect(parseFlags({ blog: 'no', signup: false })).toEqual({ flags: off('signup'), ok: false });
    expect(parseFlags(['x'])).toEqual({ flags: DEFAULT_FLAGS, ok: false });
    expect(parseFlags(undefined)).toEqual({ flags: DEFAULT_FLAGS, ok: true });
  });

  it('the panel must send every known flag as a boolean, nothing else', () => {
    expect(FlagsInputSchema.safeParse(DEFAULT_FLAGS).success).toBe(true);
    expect(FlagsInputSchema.safeParse({ ...DEFAULT_FLAGS, admin_mode: true }).success).toBe(false);
    expect(FlagsInputSchema.safeParse({ ...DEFAULT_FLAGS, blog: 'off' }).success).toBe(false);
    const { blog: _b, ...missing } = DEFAULT_FLAGS;
    expect(FlagsInputSchema.safeParse(missing).success).toBe(false);
  });

  it('a switched-off feature is refused with its name; saving is versioned and the change listed', async () => {
    const svc = service();
    await svc.reload();
    const { changes } = await svc.save(off('assistant_chat'), null, 'admin');
    expect(changes).toEqual(['assistant_chat: açık → kapalı']);
    expect(() => svc.assert('assistant_chat')).toThrow(expect.objectContaining({ status: 403, code: 'feature_disabled', message: 'AI sohbet asistanı şu an kapalı.' }));
    expect(() => svc.assert('blog')).not.toThrow();
    await expect(svc.save(DEFAULT_FLAGS, null, 'other')).rejects.toMatchObject({ status: 409, code: 'version_conflict' });
    expect(flagsDiff(DEFAULT_FLAGS, DEFAULT_FLAGS)).toEqual([]);
  });

  it('blog off: list and posts answer 404, the sitemap lists none', async () => {
    const svc = service({ blog: false });
    await svc.reload();
    const blog = { listPublic: async () => ({ items: [1] }), sitemap: async () => ({ items: [1] }), getPublic: async () => ({ slug: 'x' }) };
    const ctrl = new BlogController(blog as never, svc);
    expect(() => ctrl.list('tr')).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => ctrl.get('mutfak-fikirleri', 'tr')).toThrow(expect.objectContaining({ status: 404 }));
    await expect(Promise.resolve(ctrl.sitemap())).resolves.toEqual({ items: [] });
  });

  it('support off: a new ticket is refused before anything is written; reading stays open', async () => {
    const svc = service({ support_tickets: false });
    await svc.reload();
    let created = 0;
    const support = { create: async () => void created++, listMine: async () => ({ items: [] }) };
    const ctrl = new SupportController(support as never, { hit: async () => undefined } as never, svc);
    await expect(ctrl.create({ userId: 'u1' } as never, { category: 'billing', subject: 'Ödeme', body: 'Kredim gelmedi, yardım eder misiniz?' })).rejects.toMatchObject({ status: 403, code: 'feature_disabled' });
    expect(created).toBe(0);
    await expect(ctrl.list({ userId: 'u1' } as never)).resolves.toEqual({ items: [] });
  });

  it('guest mode off: no new guest account; sign-up off: no new e-mail account', async () => {
    const svc = service({ guest_mode: false, signup: false });
    await svc.reload();
    let created = 0;
    const prisma = { user: { findUnique: async () => null, create: async () => void created++ } };
    const ctrl = new AuthController(
      prisma as never, {} as never, {} as never, { hit: async () => undefined } as never, {} as never, {} as never, {} as never,
      { DEVICE_PEPPER: 'p'.repeat(32) } as never, {} as never, svc, {} as never,
    );
    const req = { clientIp: '1.1.1.1', headers: {} } as never;
    await expect(ctrl.guest({ deviceId: 'device-0123456789abcdef' }, req)).rejects.toMatchObject({ status: 403, code: 'feature_disabled' });
    await expect(ctrl.register({ email: 'yeni@example.com', password: 'a-long-password-123' }, req)).rejects.toMatchObject({ status: 403, code: 'feature_disabled' });
    expect(created).toBe(0);
  });
});

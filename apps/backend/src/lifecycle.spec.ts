import { DEFAULT_LIFECYCLE, inactiveWindow, lifecycleDiff, LifecycleSettingsSchema, parseLifecycle, periodKey, signupWindow, WINDOW_DAYS } from './lifecycle/lifecycle.rules.js';

// API.md §7.48: lifecycle e-mails. All steps start off, links stay inside the app, switching a step on reaches only
// people who got there recently, a one-off step is keyed once per person, and the audit never carries the texts.

const DAY = 86_400_000;

describe('lifecycle settings', () => {
  it('start with every step off and valid default texts; a step added later takes its default', () => {
    expect(LifecycleSettingsSchema.safeParse(DEFAULT_LIFECYCLE).success).toBe(true);
    expect(Object.values(DEFAULT_LIFECYCLE).filter((v) => typeof v === 'object' && (v as { enabled: boolean }).enabled)).toHaveLength(0);
    const { onboarding, perRun } = DEFAULT_LIFECYCLE;
    expect(parseLifecycle({ onboarding: { ...onboarding, enabled: true }, perRun })).toMatchObject({ ok: true, settings: { onboarding: { enabled: true }, inactive: { enabled: false } } });
    expect(parseLifecycle({ onboarding: { enabled: 'yes' } }).ok).toBe(false);
  });

  it('refuses outside links, empty or long texts, and days out of range', () => {
    const bad = (mut: (s: typeof DEFAULT_LIFECYCLE) => void) => {
      const s = structuredClone(DEFAULT_LIFECYCLE);
      mut(s);
      return LifecycleSettingsSchema.safeParse(s).success;
    };
    expect(bad((s) => (s.onboarding.link = 'https://evil.example'))).toBe(false);
    expect(bad((s) => (s.onboarding.link = null))).toBe(true);
    expect(bad((s) => (s.firstResult.subject.en = ''))).toBe(false);
    expect(bad((s) => (s.inactive.body.tr = 'x'.repeat(2001)))).toBe(false);
    expect(bad((s) => (s.inactive.cooldownDays = 7))).toBe(false);
    expect(bad((s) => (s.onboarding.afterDays = 0))).toBe(false);
    expect(bad((s) => (s.perRun = 500))).toBe(false);
  });
});

describe('lifecycle windows', () => {
  const now = Date.parse('2026-11-06T10:00:00Z');
  it('a one-off step reaches only people who got there in the last WINDOW_DAYS', () => {
    const w = signupWindow(2, now);
    expect(now - w.until.getTime()).toBe(2 * DAY);
    expect(now - w.from.getTime()).toBe((2 + WINDOW_DAYS) * DAY);
    const i = inactiveWindow(21, now);
    expect(now - i.until.getTime()).toBe(21 * DAY);
    expect(i.from.getTime()).toBeLessThan(i.until.getTime());
  });

  it('one-off steps are keyed once per person; win-back by its day', () => {
    expect(periodKey('onboarding', '2026-11-06')).toBe('once');
    expect(periodKey('firstResult', '2026-11-06')).toBe('once');
    expect(periodKey('inactive', '2026-11-06')).toBe('2026-11-06');
  });

  it('the audit names what changed, never the texts', () => {
    const next = structuredClone(DEFAULT_LIFECYCLE);
    next.onboarding.enabled = true;
    next.onboarding.body.tr = 'Gizli kampanya metni';
    next.perRun = 20;
    const diff = lifecycleDiff(DEFAULT_LIFECYCLE, next);
    expect(diff).toEqual(['onboarding.enabled: false → true', 'onboarding.body: metin değişti', 'perRun: 50 → 20']);
    expect(diff.join(' ')).not.toContain('Gizli');
  });
});

describe('lifecycle unsubscribe', () => {
  it('the broadcast unsubscribe link also withdraws consent for a lifecycle mail (its send id is the delivery id)', async () => {
    const { BroadcastsService } = await import('./broadcasts/broadcasts.service.js');
    const { unsubscribeKey, unsubscribeSignature } = await import('./broadcasts/broadcast.mail.js');
    const sendId = '0b8f3a3c-5a3e-4c1b-9b8e-2f1c3d4e5f60';
    const recorded: Array<[string, string, boolean]> = [];
    const prisma = {
      broadcastDelivery: { findUnique: async () => null },
      lifecycleSend: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === sendId ? { userId: 'u-life' } : null) },
    };
    const consents = { record: async (userId: string, kind: string, _v: string, granted: boolean) => void recorded.push([userId, kind, granted]) };
    const legal = { versionOf: () => ({ version: 'v1' }) };
    const secret = 'j'.repeat(40);
    const svc = new BroadcastsService(prisma as never, {} as never, {} as never, {} as never, {} as never, legal as never, consents as never, { JWT_SECRET: secret } as never);
    await expect(svc.unsubscribe(sendId, unsubscribeSignature(sendId, unsubscribeKey(secret)))).resolves.toEqual({ ok: true });
    expect(recorded).toEqual([['u-life', 'marketing', false]]);
    await expect(svc.unsubscribe(sendId, 'x'.repeat(32))).rejects.toMatchObject({ status: 400 });
  });
});

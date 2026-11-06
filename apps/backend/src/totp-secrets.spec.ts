import { randomBytes, randomUUID } from 'node:crypto';
import { AdminSecurityService } from './admin/admin-security.service.js';
import { TotpSecretBox, TotpSecretsService } from './admin/totp-secrets.service.js';
import { currentStep, newTotpSecret, totpAt } from './auth/crypto.js';
import { loadConfig } from './config.js';

// API.md §7.39 / KEY-04: admin TOTP secrets at rest. Sealed with their own key, bound to the account, readable with the
// previous key during a rotation, plain only while no key is set; anything that cannot be opened fails closed.

const key = () => randomBytes(32).toString('base64');

describe('TOTP secret box', () => {
  it('seals with a key and opens for the same account only', () => {
    const box = new TotpSecretBox(key());
    const secret = newTotpSecret();
    const a = randomUUID();
    const sealed = box.seal(secret, a);
    expect(sealed.startsWith('enc:v1.')).toBe(true);
    expect(sealed).not.toContain(secret);
    expect(box.open(sealed, a)).toBe(secret);
    expect(box.open(sealed, randomUUID())).toBeNull(); // copied onto another account: does not open
    expect(box.seal(secret, a)).not.toBe(sealed); // a fresh IV every time
  });

  it('without a key secrets stay plain; a sealed one cannot be read (fails closed)', () => {
    const plain = new TotpSecretBox();
    const secret = newTotpSecret();
    expect(plain.enabled).toBe(false);
    expect(plain.seal(secret, 'u')).toBe(secret);
    expect(plain.open(secret, 'u')).toBe(secret);
    expect(plain.open(new TotpSecretBox(key()).seal(secret, 'u'), 'u')).toBeNull();
  });

  it('rotation: the previous key still opens; such values and plain ones need re-sealing', () => {
    const oldKey = key();
    const before = new TotpSecretBox(oldKey);
    const after = new TotpSecretBox(key(), oldKey);
    const secret = newTotpSecret();
    const sealedOld = before.seal(secret, 'u');
    expect(after.open(sealedOld, 'u')).toBe(secret);
    expect(after.needsReseal(sealedOld, 'u')).toBe(true);
    expect(after.needsReseal(secret, 'u')).toBe(true);
    expect(after.needsReseal(after.seal(secret, 'u'), 'u')).toBe(false);
    expect(after.needsReseal(new TotpSecretBox(key()).seal(secret, 'u'), 'u')).toBe(false); // unreadable: left alone
  });
});

describe('TOTP secret migration', () => {
  it('seals plain and previous-key secrets once; a second run changes nothing', async () => {
    const oldKey = key();
    const newKey = key();
    const users = [
      { id: randomUUID(), totpSecret: newTotpSecret() as string | null, totpPendingSecret: null as string | null },
      { id: randomUUID(), totpSecret: null, totpPendingSecret: newTotpSecret() },
      { id: randomUUID(), totpSecret: null, totpPendingSecret: null },
    ];
    users.push({ id: randomUUID(), totpSecret: null, totpPendingSecret: null });
    users[2].totpSecret = new TotpSecretBox(oldKey).seal(newTotpSecret(), users[2].id);
    const plain = users.map((u) => ({ s: u.totpSecret, p: u.totpPendingSecret }));
    const prisma = {
      user: {
        findMany: async () => users.map((u) => ({ ...u })),
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, string> }) => {
          const u = users.find((x) => x.id === where.id && Object.entries(where).every(([k, v]) => k === 'id' || (x as Record<string, unknown>)[k] === v));
          if (!u) return { count: 0 };
          Object.assign(u, data);
          return { count: 1 };
        },
      },
    };
    const svc = new TotpSecretsService(prisma as never, { TOTP_ENC_KEY: newKey, TOTP_ENC_KEY_PREVIOUS: oldKey, NODE_ENV: 'test' } as never);
    expect(await svc.migrate()).toEqual({ sealed: 3, unreadable: 0 });
    expect(users.filter((u) => u.totpSecret).every((u) => u.totpSecret!.startsWith('enc:'))).toBe(true);
    expect(svc.open(users[0].totpSecret!, users[0].id)).toBe(plain[0].s);
    expect(svc.open(users[1].totpPendingSecret!, users[1].id)).toBe(plain[1].p);
    expect(await svc.migrate()).toEqual({ sealed: 0, unreadable: 0 });
  });
});

describe('TOTP check with a sealed secret', () => {
  it('accepts the right code once and refuses a wrong one', async () => {
    const box = new TotpSecretBox(key());
    const id = randomUUID();
    const secret = newTotpSecret();
    let lastStep: bigint | null = null;
    const prisma = {
      user: {
        updateMany: async ({ where, data }: { where: { OR: Array<{ totpLastStep: null | { lt: bigint } }> }; data: { totpLastStep: bigint } }) => {
          void where;
          if (lastStep !== null && lastStep >= data.totpLastStep) return { count: 0 };
          lastStep = data.totpLastStep;
          return { count: 1 };
        },
      },
    };
    const security = new AdminSecurityService(prisma as never, {} as never, {} as never, {} as never, box as never);
    const user = { id, totpSecret: box.seal(secret, id), totpLastStep: null };
    const code = totpAt(secret, currentStep());
    expect(await security.claimTotp(user, code)).toBe(true);
    expect(await security.claimTotp(user, code)).toBe(false); // the same step twice
    expect(await security.claimTotp({ ...user, totpSecret: new TotpSecretBox(key()).seal(secret, id) }, code)).toBe(false); // wrong key
  });
});

describe('TOTP key configuration (KEY-01 / KEY-03)', () => {
  const base = { DATABASE_URL: 'postgresql://x@localhost/db', JWT_SECRET: 'a'.repeat(40), IMAGE_URL_SECRET: 'b'.repeat(40), DEVICE_PEPPER: 'c'.repeat(40), AI_INTERNAL_TOKEN: 'd'.repeat(40) };
  it('takes a 32-byte key; refuses a short one and a previous key without a current one', () => {
    expect(loadConfig({ ...base, TOTP_ENC_KEY: key() }).TOTP_ENC_KEY).toBeDefined();
    expect(() => loadConfig({ ...base, TOTP_ENC_KEY: Buffer.from('short').toString('base64') })).toThrow(/TOTP_ENC_KEY/);
    expect(() => loadConfig({ ...base, TOTP_ENC_KEY_PREVIOUS: key() })).toThrow(/TOTP_ENC_KEY_PREVIOUS/);
  });
});

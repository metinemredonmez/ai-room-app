import { createHash, randomBytes } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { decideLink, type LinkInput } from './auth/oauth-link.js';
import { IdTokenVerifier } from './auth/oidc.js';
import { FieldCipher } from './common/field-crypto.js';
import { loadConfig } from './config.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const CLIENT = 'com.airoom.app';
const APPLE_ISS = 'https://appleid.apple.com';

describe('Apple / Google ID tokens (TOK-01 / TOK-02 / TOK-03)', () => {
  let verifier: IdTokenVerifier;
  let sign: (claims: Record<string, unknown>, opts?: { kid?: string; iat?: number; exp?: number; alg?: string; key?: CryptoKey }) => Promise<string>;
  let rogue: CryptoKey;
  const nonce = 'n'.repeat(43);

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    rogue = (await generateKeyPair('RS256')).privateKey;
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    const keys = createLocalJWKSet({ keys: [jwk] });
    verifier = new IdTokenVerifier({ google: [], apple: [CLIENT] }, { apple: keys, google: keys });
    sign = (claims, opts = {}) => {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ iss: APPLE_ISS, aud: CLIENT, sub: '001.abc', nonce: sha(nonce), ...claims })
        .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1' })
        .setIssuedAt(opts.iat ?? now)
        .setExpirationTime(opts.exp ?? now + 600)
        .sign(opts.key ?? pair.privateKey);
    };
  });

  it('accepts a valid token and normalises its claims', async () => {
    const claims = await verifier.verifyIdToken('apple', await sign({ email: ' User@Example.com ', email_verified: 'true', is_private_email: true }), sha(nonce));
    expect(claims).toMatchObject({ sub: '001.abc', audience: CLIENT, email: 'user@example.com', emailVerified: true, isPrivateEmail: true });
  });

  it('rejects a wrong issuer, audience, nonce, key or an expired / too old token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const bad = [
      sign({ iss: 'https://evil.example.com' }),
      sign({ aud: 'com.someone.else' }),
      sign({ nonce: sha('other') }),
      sign({ nonce: undefined }),
      sign({}, { key: rogue }), // signed by a key outside the trusted set
      sign({}, { kid: 'unknown' }),
      sign({}, { iat: now - 3600, exp: now - 1800 }),
      sign({}, { iat: now - 3600, exp: now + 3600 }), // Apple tokens older than 10 minutes
    ];
    for (const token of bad) {
      await expect(verifier.verifyIdToken('apple', await token, sha(nonce))).rejects.toMatchObject({ status: 401, code: 'invalid_token' });
    }
  });

  it('refuses alg=none and HMAC tokens', async () => {
    const p = (await sign({})).split('.')[1];
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url')}.${p}.`;
    await expect(verifier.verifyIdToken('apple', none, sha(nonce))).rejects.toMatchObject({ status: 401 });
    const hs = await new SignJWT(JSON.parse(Buffer.from(p!, 'base64url').toString()))
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .sign(randomBytes(32));
    await expect(verifier.verifyIdToken('apple', hs, sha(nonce))).rejects.toMatchObject({ status: 401 });
  });

  it('is unavailable (503) for a provider with no client id', async () => {
    await expect(verifier.verifyIdToken('google', await sign({}), sha(nonce))).rejects.toMatchObject({ status: 503, code: 'oauth_not_configured' });
  });
});

describe('account linking (pre-account-hijacking)', () => {
  const none: LinkInput = { identityUserId: null, current: null, emailOwner: null, providerEmailVerified: true };

  it('signs in a known provider account; a guest switches to it', () => {
    expect(decideLink({ ...none, identityUserId: 'u1' })).toEqual({ kind: 'login', userId: 'u1' });
    expect(decideLink({ ...none, identityUserId: 'u1', current: { id: 'g1', isGuest: true } })).toEqual({ kind: 'login', userId: 'u1' });
    expect(decideLink({ ...none, identityUserId: 'u1', current: { id: 'u1', isGuest: false } })).toEqual({ kind: 'login', userId: 'u1' });
  });

  it('never links a provider account that belongs to someone else', () => {
    expect(decideLink({ ...none, identityUserId: 'u1', current: { id: 'u2', isGuest: false } })).toMatchObject({ kind: 'reject', code: 'identity_in_use' });
  });

  it('links to an existing e-mail account only when both sides verified the address', () => {
    expect(decideLink({ ...none, emailOwner: { id: 'u1', emailVerified: true } })).toEqual({ kind: 'attach-by-email', userId: 'u1' });
    expect(decideLink({ ...none, emailOwner: { id: 'u1', emailVerified: false } })).toMatchObject({ kind: 'reject', code: 'account_exists' });
    expect(decideLink({ ...none, emailOwner: { id: 'u1', emailVerified: true }, providerEmailVerified: false })).toMatchObject({ kind: 'reject', code: 'account_exists' });
    // A guest can't take over the e-mail account either.
    expect(decideLink({ ...none, current: { id: 'g1', isGuest: true }, emailOwner: { id: 'u1', emailVerified: false } })).toMatchObject({ kind: 'reject' });
  });

  it('attaches to the signed-in account, upgrades a guest, or creates a new one', () => {
    expect(decideLink({ ...none, current: { id: 'u1', isGuest: false } })).toEqual({ kind: 'attach', userId: 'u1', upgradeGuest: false });
    expect(decideLink({ ...none, current: { id: 'u1', isGuest: false }, emailOwner: { id: 'u2', emailVerified: true } })).toEqual({ kind: 'attach', userId: 'u1', upgradeGuest: false });
    expect(decideLink({ ...none, current: { id: 'g1', isGuest: true } })).toEqual({ kind: 'attach', userId: 'g1', upgradeGuest: true });
    expect(decideLink(none)).toEqual({ kind: 'create' });
  });
});

describe('field encryption (KEY-01)', () => {
  const cipher = new FieldCipher(randomBytes(32).toString('base64'));

  it('round-trips and never repeats a ciphertext', () => {
    const a = cipher.encrypt('r.token', 'apple-refresh-token');
    expect(a).not.toContain('r.token');
    expect(a).not.toBe(cipher.encrypt('r.token', 'apple-refresh-token'));
    expect(cipher.decrypt(a, 'apple-refresh-token')).toBe('r.token');
  });

  it('fails on another purpose, another key, a tampered body or a truncated tag', () => {
    const blob = cipher.encrypt('r.token', 'apple-refresh-token');
    const [v, iv, tag, body] = blob.split('.');
    expect(() => cipher.decrypt(blob, 'other')).toThrow();
    expect(() => new FieldCipher(randomBytes(32).toString('base64')).decrypt(blob, 'apple-refresh-token')).toThrow();
    const flipped = Buffer.from(body!, 'base64url');
    flipped[0]! ^= 1;
    expect(() => cipher.decrypt([v, iv, tag, flipped.toString('base64url')].join('.'), 'apple-refresh-token')).toThrow();
    const short = Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => cipher.decrypt([v, iv, short, body].join('.'), 'apple-refresh-token')).toThrow();
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => new FieldCipher(randomBytes(16).toString('base64'))).toThrow(/32/);
  });
});

describe('Sign in with Apple configuration (KEY-01)', () => {
  const base = {
    DATABASE_URL: 'postgresql://x@localhost/db',
    JWT_SECRET: 'a'.repeat(40),
    IMAGE_URL_SECRET: 'b'.repeat(40),
    DEVICE_PEPPER: 'c'.repeat(40),
    AI_INTERNAL_TOKEN: 'd'.repeat(40),
  };
  const apple = { APPLE_TEAM_ID: 'ABCDE12345', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: 'k'.repeat(120) };

  it('needs the whole key trio and an encryption key', () => {
    expect(() => loadConfig({ ...base, APPLE_TEAM_ID: 'ABCDE12345' })).toThrow(/go together/);
    expect(() => loadConfig({ ...base, ...apple })).toThrow(/FIELD_ENC_KEY/);
    expect(() => loadConfig({ ...base, ...apple, FIELD_ENC_KEY: randomBytes(16).toString('base64') })).toThrow(/32 bytes/);
    expect(loadConfig({ ...base, ...apple, FIELD_ENC_KEY: randomBytes(32).toString('base64') }).APPLE_KEY_ID).toBe('KEY1234567');
  });

  it('requires the Apple key in production when Sign in with Apple is on', () => {
    const prod = {
      ...base, NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://api.example.com', WEB_APP_URL: 'https://airoom.example.com',
      ADMIN_APP_URL: 'https://admin.airoom.example.com', MAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtps://u:p@smtp.example.com', PUSH_TRANSPORT: 'expo',
      LEGAL_CONTROLLER_NAME: 'AI Room Teknoloji A.Ş.', LEGAL_CONTROLLER_ADDRESS: 'İstanbul', LEGAL_CONTACT_EMAIL: 'kvkk@airoom.example.com',
    };
    expect(() => loadConfig({ ...prod, APPLE_CLIENT_IDS: CLIENT })).toThrow(/APPLE_PRIVATE_KEY/);
    const key = randomBytes(32).toString('base64');
    expect(loadConfig({ ...prod, APPLE_CLIENT_IDS: CLIENT, ...apple, FIELD_ENC_KEY: key }).isProd).toBe(true);
  });
});

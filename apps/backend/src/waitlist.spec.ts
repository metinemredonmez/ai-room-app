import { unsubscribeKey, unsubscribeSignature } from './broadcasts/broadcast.mail.js';
import { confirmMail, leaveKey, leaveSignature, maskEmail, normalizeEmail, parseWaitlistSettings, SignupSchema, verifyLeaveSignature, webPath } from './waitlist/waitlist.rules.js';

// API.md §7.47: waiting list and newsletter. Consent is required, one row per mailbox, the leave link cannot be forged
// or replayed from another kind of link, and the confirmation token never sits in a URL path or query.

describe('waitlist signup input', () => {
  const base = { email: 'Ayse@Example.com', consent: true };
  it('needs ticked consent and a real address; platforms are ios / android once each; unknown fields refused', () => {
    expect(SignupSchema.parse(base)).toMatchObject({ locale: 'tr', platforms: [], source: 'home' });
    expect(SignupSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(SignupSchema.safeParse({ email: base.email }).success).toBe(false);
    expect(SignupSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(SignupSchema.safeParse({ ...base, platforms: ['ios', 'ios'] }).success).toBe(false);
    expect(SignupSchema.safeParse({ ...base, platforms: ['windows'] }).success).toBe(false);
    expect(SignupSchema.safeParse({ ...base, locale: 'pt' }).success).toBe(false);
    expect(SignupSchema.safeParse({ ...base, role: 'ADMIN' }).success).toBe(false);
    expect(SignupSchema.parse({ ...base, website: 'spam' }).website).toBe('spam');
  });

  it('one row per mailbox however it is typed; the admin sees a masked address', () => {
    expect(normalizeEmail('  Ayse@Example.COM ')).toBe('ayse@example.com');
    expect(maskEmail('ayse@example.com')).toBe('a***@example.com');
    expect(maskEmail('broken')).toBe('***');
  });

  it('settings default to open; junk falls back', () => {
    expect(parseWaitlistSettings(undefined)).toEqual({ settings: { enabled: true }, ok: true });
    expect(parseWaitlistSettings({ enabled: 'yes' }).ok).toBe(false);
  });
});

describe('waitlist links', () => {
  const key = leaveKey('test-secret-test-secret-test-secret');
  it('the leave signature is bound to the entry and cannot be taken from a broadcast unsubscribe link', () => {
    const id = '0b8f3a3c-5a3e-4c1b-9b8e-2f1c3d4e5f60';
    const sig = leaveSignature(id, key);
    expect(verifyLeaveSignature(id, sig, key)).toBe(true);
    expect(verifyLeaveSignature('11111111-2222-4333-8444-555555555555', sig, key)).toBe(false);
    expect(verifyLeaveSignature(id, `${sig.slice(0, -1)}x`, key)).toBe(false);
    expect(verifyLeaveSignature(id, unsubscribeSignature(id, unsubscribeKey('test-secret-test-secret-test-secret')), key)).toBe(false);
  });

  it('links open in the visitor\'s language and the confirmation token travels in the fragment only', () => {
    expect(webPath('https://casalume.app/', 'tr', '/bekleme-listesi/onay')).toBe('https://casalume.app/bekleme-listesi/onay');
    expect(webPath('https://casalume.app', 'de', '/bekleme-listesi/onay')).toBe('https://casalume.app/de/bekleme-listesi/onay');
    const url = 'https://casalume.app/bekleme-listesi/onay#token=abc';
    const tr = confirmMail('ayse@example.com', 'tr', url);
    expect(tr.subject).toContain('Bekleme listesi');
    expect(tr.html).toContain(url);
    expect(new URL(url).search).toBe('');
    expect(confirmMail('x@example.com', 'ja', url).subject).toContain('Confirm');
  });
});

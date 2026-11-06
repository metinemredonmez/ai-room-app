import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertPassword, MIN_ADMIN, passwordProblem } from './auth/password-policy.js';

// API.md §7.38 (PWD / ASVS V6.2): length bounds and a refusal of common or guessable passwords — for sign-up, reset and
// the admin's own change. The bundled list must be the pinned file and every entry in it must be refused.

const listFile = fileURLToPath(new URL('../assets/security/common_passwords.txt', import.meta.url));

describe('password policy', () => {
  it('refuses every one of the 3000 listed passwords, in any case', () => {
    const lines = readFileSync(listFile, 'utf8').split('\n').filter(Boolean);
    expect(new Set(lines).size).toBeGreaterThanOrEqual(3000);
    const accepted = lines.filter((p) => passwordProblem(p, { min: 1 }) !== 'common' && passwordProblem(p.toUpperCase(), { min: 1 }) !== 'common');
    expect(accepted).toEqual([]);
  });

  it('refuses a common word with digits or signs after it, Turkish and brand words', () => {
    for (const p of ['password2026!', 'Galatasaray1905', 'fenerbahce1907', 'Casalume123', 'sifre123456', 'qwertyuiop12', 'İstanbul34!!']) {
      expect([p, passwordProblem(p)]).toEqual([p, 'common']);
    }
  });

  it('refuses short, overlong, monotonous and e-mail-based passwords', () => {
    expect(passwordProblem('Kisa-1')).toBe('too_short');
    expect(passwordProblem('x'.repeat(129) + 'Y')).toBe('too_long');
    expect(passwordProblem('aaaaaaaaaaaa')).toBe('repetitive');
    expect(passwordProblem('abababababab')).toBe('repetitive');
    expect(passwordProblem('ayse.yilmaz-2026', { email: 'ayse.yilmaz@example.com' })).toBe('contains_email');
    expect(passwordProblem('a-good-pass-for-admin', { min: MIN_ADMIN })).toBeNull();
    expect(passwordProblem('kisa-ama-10', { min: MIN_ADMIN })).toBe('too_short');
  });

  it('accepts long, personal passphrases (no character-class rules)', () => {
    for (const p of ['mavi kapı sabah çayı', 'teras-bitkileri-2026', 'kırmızı koltuk ve gri halı']) expect(passwordProblem(p)).toBeNull();
  });

  it('counts characters, not bytes', () => {
    expect(passwordProblem('çşğüöıçşğü')).toBeNull(); // 10 letters, 20 bytes
  });

  it('answers 400 weak_password with a machine-readable reason', () => {
    expect(() => assertPassword('password1234')).toThrow(expect.objectContaining({ status: 400, code: 'weak_password', details: { reason: 'common' } }));
    expect(() => assertPassword('a-good-long-phrase')).not.toThrow();
  });
});

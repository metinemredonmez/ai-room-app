import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AppError } from '../common/errors.js';

// Password policy (API.md §7.38; PWD / ASVS V6.2, NIST 800-63B): a minimum length, a maximum, and a refusal of common
// or guessable passwords. No character-class rules and no silent trimming (ASVS advises against both). The block
// list is the 3000 most common passwords from SecLists (pinned source, MIT, see assets/security/README.md) plus
// Turkish, keyboard and brand words below. The list is required: if it is missing or short, the API does not start.
// Nothing is sent to an outside service. Used for sign-up, password reset and the admin's own password change.

export const MIN_USER = 10;
export const MIN_ADMIN = 12;
export const MAX_LENGTH = 128;
const MIN_LIST = 3000;

const EXTRA = [
  // Turkish, sports clubs, cities
  'sifre', 'parola', 'sifre123', 'sifre1234', 'sifresifre', 'parola123', 'parolaparola', 'sifrem123', 'merhaba1', 'merhaba123', 'galatasaray', 'fenerbahce', 'besiktas',
  'trabzonspor', 'istanbul', 'istanbul34', 'ankara123', 'ankara06', 'izmir35', 'turkiye', 'turkiye123', 'askim123', 'seniseviyorum', 'canimcanim',
  // keyboard and sequences
  'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1q2w3e4r5t', '1qaz2wsx3edc', 'qazwsxedc', 'poiuytrewq', '1234567890', '0987654321', 'abcdefghij',
  'qwerty123456', 'password123456',
  // this service
  'casalume', 'casalume1', 'casalume123', 'casalume2026', 'airoom', 'airoom123', 'tasarim123', 'dekorasyon',
];

function load(): Set<string> {
  const file = fileURLToPath(new URL('../../assets/security/common_passwords.txt', import.meta.url));
  const lines = readFileSync(file, 'utf8').split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean);
  const set = new Set(lines);
  if (set.size < MIN_LIST) throw new Error(`common_passwords.txt has ${set.size} entries; at least ${MIN_LIST} are required`);
  for (const w of EXTRA) set.add(w);
  return set;
}
const COMMON = load();

export type PasswordProblem = 'too_short' | 'too_long' | 'common' | 'contains_email' | 'repetitive';

/** Why a new password is not acceptable, or null. */
export function passwordProblem(password: string, ctx: { email?: string | null; min?: number } = {}): PasswordProblem | null {
  const length = [...password].length;
  if (length < (ctx.min ?? MIN_USER)) return 'too_short';
  if (length > MAX_LENGTH) return 'too_long';
  const lower = password.normalize('NFKC').toLowerCase();
  // "password2026!" or "galatasaray1905" are a common word with digits or signs after it.
  const base = lower.replace(/[\d\W_]+$/u, '');
  const core = lower.replace(/[\W_]+/gu, '');
  if (COMMON.has(lower) || COMMON.has(core) || (base.length >= 4 && COMMON.has(base))) return 'common';
  const local = (ctx.email ?? '').toLowerCase().split('@')[0] ?? '';
  if (local.length >= 4 && lower.includes(local)) return 'contains_email';
  if (new Set(lower).size <= 2) return 'repetitive';
  return null;
}

const MESSAGE: Record<PasswordProblem, (min: number) => string> = {
  too_short: (min) => `Şifre en az ${min} karakter olmalı.`,
  too_long: () => `Şifre en çok ${MAX_LENGTH} karakter olabilir.`,
  common: () => 'Bu şifre çok yaygın; tahmin edilmesi kolay. Daha uzun ve sana özgü bir şifre seç.',
  contains_email: () => 'Şifre e-posta adresini içermemeli.',
  repetitive: () => 'Şifre çok tekdüze; farklı karakterler kullan.',
};

/** 400 `weak_password` with the reason (`details.reason`) for the clients' own translation. */
export function assertPassword(password: string, ctx: { email?: string | null; min?: number } = {}) {
  const problem = passwordProblem(password, ctx);
  if (problem) throw new AppError(400, 'weak_password', MESSAGE[problem](ctx.min ?? MIN_USER), {}, { reason: problem });
}

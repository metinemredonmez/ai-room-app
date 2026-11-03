import { hash, verify } from '@node-rs/argon2';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Passwords: Argon2id with library defaults (m=19 MiB, t=2, p=1 — OWASP baseline).
export const hashPassword = (password: string) => hash(password);

// Verified against a real hash even when the account does not exist, so timing doesn't reveal it.
const DUMMY_HASH = await hash('dummy-password-for-timing-equalisation');
export async function verifyPassword(stored: string | null | undefined, password: string): Promise<boolean> {
  try {
    return await verify(stored ?? DUMMY_HASH, password);
  } catch {
    return false;
  }
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------------------- TOTP
// RFC 6238 (SHA-1, 30 s, 6 digits) — the format every authenticator app supports.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 30_000);

/**
 * Returns the matched time step (±1 window) or null. Callers must reject steps ≤ the last accepted
 * one so a code can't be replayed.
 */
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  for (const s of [step - 1, step, step + 1]) {
    if (safeEqual(totpAt(secret, s), code)) return s;
  }
  return null;
}

export const otpauthUri = (secret: string, account: string) =>
  `otpauth://totp/AI%20Room%20Admin:${encodeURIComponent(account)}?secret=${secret}&issuer=AI%20Room&algorithm=SHA1&digits=6&period=30`;

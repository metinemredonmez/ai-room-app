import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * KEY-01: authenticated encryption for third-party tokens kept at rest (Apple refresh tokens).
 * Format `v1.<iv>.<tag>.<ciphertext>` (base64url); the purpose label is bound as AAD, so a value
 * stored for one purpose can't be decrypted as another.
 */
export class FieldCipher {
  private key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('FIELD_ENC_KEY must be 32 bytes');
  }

  encrypt(plain: string, purpose: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv).setAAD(Buffer.from(purpose));
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), body].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  decrypt(blob: string, purpose: string): string {
    const [v, iv, tag, body] = blob.split('.');
    if (v !== 'v1' || !iv || !tag || body === undefined) throw new Error('unsupported ciphertext');
    // A fixed 16-byte tag: GCM would otherwise accept a truncated (forgeable) one.
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'), { authTagLength: 16 }).setAAD(Buffer.from(purpose));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  }
}

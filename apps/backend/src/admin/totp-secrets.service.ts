import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/infra.js';
import { FieldCipher } from '../common/field-crypto.js';
import { log } from '../common/log.js';
import { CONFIG, type Config } from '../config.js';

// Admin TOTP secrets encrypted at rest (API.md §7.39; KEY-04 / ASVS V6.5.x, YediOda #12). AES-256-GCM with its own key
// (TOTP_ENC_KEY, never shared with another purpose — KEY-01), bound to the user id as AAD so a value copied onto
// another account does not decrypt. Stored as `enc:v1.<iv>.<tag>.<ciphertext>`; a base32 secret never contains ':'.
//
// Rollout: without a key the secrets stay as they are (a warning in production). With a key, plain secrets are sealed
// once at start-up, and so are secrets sealed with TOTP_ENC_KEY_PREVIOUS (rotation, KEY-03). If a sealed secret cannot
// be opened (key lost or wrong), the TOTP check fails closed; recovery is an MFA reset by a SUPER_ADMIN.

const PREFIX = 'enc:';

export class TotpSecretBox {
  private current: FieldCipher | null;
  private previous: FieldCipher | null;

  constructor(currentKey?: string, previousKey?: string) {
    this.current = currentKey ? new FieldCipher(currentKey) : null;
    this.previous = previousKey ? new FieldCipher(previousKey) : null;
  }

  get enabled() {
    return this.current !== null;
  }

  static isSealed(stored: string) {
    return stored.startsWith(PREFIX);
  }

  /** What to store for a new secret: sealed when a key is set. */
  seal(plain: string, userId: string): string {
    return this.current ? PREFIX + this.current.encrypt(plain, `totp:${userId}`) : plain;
  }

  /** The base32 secret, or null when a sealed value cannot be opened (fail closed). */
  open(stored: string, userId: string): string | null {
    if (!TotpSecretBox.isSealed(stored)) return stored;
    const blob = stored.slice(PREFIX.length);
    for (const c of [this.current, this.previous]) {
      if (!c) continue;
      try {
        return c.decrypt(blob, `totp:${userId}`);
      } catch {
        // try the next key
      }
    }
    return null;
  }

  /** A value that should be re-sealed with the current key (plain, or sealed with the previous key). */
  needsReseal(stored: string, userId: string): boolean {
    if (!this.current) return false;
    if (!TotpSecretBox.isSealed(stored)) return true;
    try {
      this.current.decrypt(stored.slice(PREFIX.length), `totp:${userId}`);
      return false;
    } catch {
      return this.open(stored, userId) !== null;
    }
  }
}

@Injectable()
export class TotpSecretsService extends TotpSecretBox implements OnModuleInit {
  constructor(private prisma: PrismaService, @Inject(CONFIG) private cfg: Config) {
    super(cfg.TOTP_ENC_KEY, cfg.TOTP_ENC_KEY_PREVIOUS);
  }

  async onModuleInit() {
    if (!this.enabled) {
      if (this.cfg.NODE_ENV === 'production') log.warn('totp_key_missing', { hint: 'set TOTP_ENC_KEY with deploy/hazal/set-secret.sh --generate' });
      return;
    }
    await this.migrate().catch((e: Error) => log.error('totp_migration_failed', { error: e.name }));
  }

  /** Seals plain secrets (and re-seals previous-key ones) with the current key; each row only if it is unchanged. */
  async migrate(): Promise<{ sealed: number; unreadable: number }> {
    const rows = await this.prisma.user.findMany({
      where: { OR: [{ totpSecret: { not: null } }, { totpPendingSecret: { not: null } }] },
      select: { id: true, totpSecret: true, totpPendingSecret: true },
    });
    let sealed = 0;
    let unreadable = 0;
    for (const r of rows) {
      for (const field of ['totpSecret', 'totpPendingSecret'] as const) {
        const stored = r[field];
        if (!stored || !this.needsReseal(stored, r.id)) {
          if (stored && this.open(stored, r.id) === null) unreadable++;
          continue;
        }
        const plain = this.open(stored, r.id)!;
        const done = await this.prisma.user.updateMany({ where: { id: r.id, [field]: stored }, data: { [field]: this.seal(plain, r.id) } });
        sealed += done.count;
      }
    }
    if (sealed || unreadable) log.info('totp_secrets_sealed', { sealed, unreadable });
    return { sealed, unreadable };
  }
}

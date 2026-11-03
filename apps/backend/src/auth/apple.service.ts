import { Inject, Injectable } from '@nestjs/common';
import { importPKCS8, SignJWT, type CryptoKey } from 'jose';
import { CONFIG, type Config } from '../config.js';
import { FieldCipher } from '../common/field-crypto.js';
import { log } from '../common/log.js';

const APPLE = 'https://appleid.apple.com';
const PURPOSE = 'apple-refresh-token';

/** Thrown for network / 5xx answers so the revoke job retries with backoff. */
export class AppleRetryableError extends Error {}

/**
 * Sign in with Apple server calls: exchange the one-time authorization code for a refresh token
 * (kept encrypted) and revoke it when the account is deleted or Apple is unlinked — App Store
 * guideline 5.1.1(v). The private key is read from the environment only and never logged.
 */
@Injectable()
export class AppleService {
  private key: Promise<CryptoKey> | null = null;
  private cipher: FieldCipher | null;

  constructor(@Inject(CONFIG) private cfg: Config) {
    this.cipher = cfg.FIELD_ENC_KEY ? new FieldCipher(cfg.FIELD_ENC_KEY) : null;
  }

  get enabled() {
    return !!(this.cfg.APPLE_TEAM_ID && this.cfg.APPLE_KEY_ID && this.cfg.APPLE_PRIVATE_KEY && this.cipher);
  }

  /** ES256 client secret, valid 5 minutes, for the client id the user signed in with. */
  private async clientSecret(clientId: string) {
    this.key ??= importPKCS8(this.cfg.APPLE_PRIVATE_KEY!.replace(/\\n/g, '\n'), 'ES256');
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: this.cfg.APPLE_KEY_ID! })
      .setIssuer(this.cfg.APPLE_TEAM_ID!)
      .setSubject(clientId)
      .setAudience(APPLE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(await this.key);
  }

  private async post(path: string, form: Record<string, string>) {
    return fetch(`${APPLE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(10_000),
    });
  }

  /** Returns the encrypted refresh token, or null (sign-in still succeeds; only the later revoke is lost). */
  async exchangeCode(clientId: string, code: string): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      const res = await this.post('/auth/token', {
        client_id: clientId, client_secret: await this.clientSecret(clientId), code, grant_type: 'authorization_code',
      });
      const body = (await res.json().catch(() => null)) as { refresh_token?: string; error?: string } | null;
      if (!res.ok || !body?.refresh_token) {
        log.warn('apple_code_exchange_failed', { status: res.status, error: body?.error ?? 'unknown' });
        return null;
      }
      return this.cipher!.encrypt(body.refresh_token, PURPOSE);
    } catch (e) {
      log.warn('apple_code_exchange_failed', { error: (e as Error).name });
      return null;
    }
  }

  async revoke(clientId: string, tokenEnc: string): Promise<'revoked' | 'already_invalid' | 'disabled'> {
    if (!this.enabled) return 'disabled';
    const token = this.cipher!.decrypt(tokenEnc, PURPOSE);
    let res: Response;
    try {
      res = await this.post('/auth/revoke', {
        client_id: clientId, client_secret: await this.clientSecret(clientId), token, token_type_hint: 'refresh_token',
      });
    } catch (e) {
      throw new AppleRetryableError(`apple_revoke_network_${(e as Error).name}`);
    }
    if (res.ok) return 'revoked';
    if (res.status === 429 || res.status >= 500) throw new AppleRetryableError(`apple_revoke_http_${res.status}`);
    // invalid_grant: the user already revoked it in Settings — the goal is met.
    log.warn('apple_revoke_rejected', { status: res.status });
    return 'already_invalid';
  }
}

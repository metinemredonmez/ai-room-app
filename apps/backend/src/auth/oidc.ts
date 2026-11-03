import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../common/errors.js';
import { safeEqual } from './crypto.js';

export type OAuthProvider = 'google' | 'apple';
export const OAUTH_PROVIDERS = ['google', 'apple'] as const;

// TOK-02: issuers and key sets come from this fixed table, never from the token (kid only selects
// a key inside the trusted set). jose caches the JWKS and refetches on an unknown kid (rate-limited).
const ISSUERS: Record<OAuthProvider, { issuer: string[]; jwks: string; maxAge: string }> = {
  google: { issuer: ['https://accounts.google.com', 'accounts.google.com'], jwks: 'https://www.googleapis.com/oauth2/v3/certs', maxAge: '1h' },
  apple: { issuer: ['https://appleid.apple.com'], jwks: 'https://appleid.apple.com/auth/keys', maxAge: '10m' },
};

export interface IdClaims {
  sub: string;
  audience: string;
  email: string | null;
  emailVerified: boolean;
  isPrivateEmail: boolean;
  name: string | null;
}

const truthy = (v: unknown) => v === true || v === 'true';

/** TOK-01: RS256 only; issuer, audience (our client ids), expiry, age and the login nonce all checked. */
export class IdTokenVerifier {
  private keys: Record<OAuthProvider, JWTVerifyGetKey>;

  constructor(
    private audiences: Record<OAuthProvider, string[]>,
    keys?: Partial<Record<OAuthProvider, JWTVerifyGetKey>>,
  ) {
    this.keys = {
      google: keys?.google ?? createRemoteJWKSet(new URL(ISSUERS.google.jwks), { timeoutDuration: 5_000 }),
      apple: keys?.apple ?? createRemoteJWKSet(new URL(ISSUERS.apple.jwks), { timeoutDuration: 5_000 }),
    };
  }

  configured(provider: OAuthProvider) {
    return this.audiences[provider].length > 0;
  }

  /** Any token signed by the provider for one of our clients: ID tokens and Apple server events alike. */
  async verifyJwt(provider: OAuthProvider, token: string, maxAge?: string): Promise<JWTPayload> {
    if (!this.configured(provider)) throw new AppError(503, 'oauth_not_configured', 'Bu giriş yöntemi şu an kullanılamıyor');
    try {
      const { payload } = await jwtVerify(token, this.keys[provider], {
        issuer: ISSUERS[provider].issuer,
        audience: this.audiences[provider],
        algorithms: ['RS256'],
        clockTolerance: 60,
        ...(maxAge ? { maxTokenAge: maxAge } : {}),
        requiredClaims: ['sub', 'iat', 'exp'],
      });
      return payload;
    } catch (e) {
      // The provider's key endpoint being down is not the user's fault: retryable 503, not 401.
      if (e instanceof errors.JWKSTimeout || e instanceof TypeError) {
        throw new AppError(503, 'oauth_unavailable', 'Giriş sağlayıcısına ulaşılamadı, tekrar deneyin');
      }
      throw new AppError(401, 'invalid_token', 'Kimlik doğrulanamadı');
    }
  }

  /** TOK-03: `expectedNonce` is SHA-256 of the single-use nonce this server issued for the attempt. */
  async verifyIdToken(provider: OAuthProvider, token: string, expectedNonce: string): Promise<IdClaims> {
    const p = await this.verifyJwt(provider, token, ISSUERS[provider].maxAge);
    if (typeof p.nonce !== 'string' || !safeEqual(p.nonce, expectedNonce)) throw new AppError(401, 'invalid_token', 'Kimlik doğrulanamadı');
    const aud = Array.isArray(p.aud) ? p.aud[0] : p.aud;
    return {
      sub: p.sub!,
      audience: aud!,
      email: typeof p.email === 'string' ? p.email.trim().toLowerCase() : null,
      emailVerified: truthy(p.email_verified),
      isPrivateEmail: truthy(p.is_private_email),
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 80) : null,
    };
  }
}

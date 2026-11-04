// LOG-01 / LOG-02: one JSON object per event; secrets, tokens, image bytes and chat text are redacted.

// Same keys as the error reporter (common/monitoring.ts) except the client IP, which security events must carry
// (LOG-01). E-mail addresses inside any text are masked too (LOG-02).
const REDACT =
  /^(authorization|cookie|set-cookie|password|passwordhash|token|accesstoken|refreshtoken|idtoken|identitytoken|secret|totpsecret|otp|backupcode|data|text|messages|prompt|deviceid|sig|email|to|nonce|authorizationcode|x-internal-token|x-admin-panel-key|idempotency-key)$/i;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;

type Fields = Record<string, unknown>;

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Fields = {};
    for (const [k, v] of Object.entries(value as Fields)) out[k] = REDACT.test(k) ? '[redacted]' : scrub(v, depth + 1);
    return out;
  }
  if (typeof value === 'string') {
    const masked = value.replace(EMAIL, '[email]');
    return masked.length > 300 ? `${masked.slice(0, 300)}…` : masked;
  }
  return value;
}

function emit(level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}) {
  if (process.env.NODE_ENV === 'test' && level !== 'error') return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(scrub(fields) as Fields) });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
};

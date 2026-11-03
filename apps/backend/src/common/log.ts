// LOG-01 / LOG-02: one JSON object per event; secrets, tokens, image bytes and chat text are redacted.

const REDACT =
  /^(authorization|cookie|password|passwordhash|token|accesstoken|refreshtoken|secret|totpsecret|otp|data|text|messages|prompt|deviceid|sig)$/i;

type Fields = Record<string, unknown>;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Fields = {};
    for (const [k, v] of Object.entries(value as Fields)) out[k] = REDACT.test(k) ? '[redacted]' : scrub(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…`;
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

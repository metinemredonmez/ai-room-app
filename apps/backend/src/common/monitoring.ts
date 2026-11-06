import * as Sentry from '@sentry/node';
import type { Breadcrumb, ErrorEvent } from '@sentry/node';
import type { Config } from '../config.js';

// LOG-02 / KVKK: error reports leave the country, so they carry no personal data — no user, IP, body,
// cookies, query strings or local variables, and every string is masked before it is sent. The
// request id ties a report to our own logs, which stay with us.

const MASKS: Array<[RegExp, string]> = [
  [/data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+/g, '[data-uri]'],
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g, '[jwt]'],
  [/\b(Bearer|Basic|Key)\s+[\w.~+/=-]{8,}/gi, '$1 [token]'],
  [/Expo(nent)?PushToken\[[^\]]+\]/g, '[push-token]'],
  [/([?&#](?:sig|token|code|key|signature|access_token|refresh_token)=)[^&\s"']+/gi, '$1[redacted]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
  [/[A-Za-z0-9+/_-]{100,}={0,2}/g, '[blob]'],
];

const SECRET_KEY =
  /^(authorization|cookie|set-cookie|password|passwordhash|token|accesstoken|refreshtoken|idtoken|identitytoken|secret|totpsecret|otp|backupcode|data|text|messages|prompt|deviceid|sig|email|ip|clientip|nonce|authorizationcode|x-internal-token|idempotency-key)$/i;

/** Request headers worth seeing in a report; everything else (auth, cookies, IPs) is dropped. */
const HEADER_ALLOW = new Set(['user-agent', 'content-type', 'accept-language', 'x-request-id', 'x-app-version', 'x-app-platform']);

export function maskText(s: string): string {
  let out = s;
  for (const [re, repl] of MASKS) out = out.replace(re, repl);
  return out.length > 1000 ? `${out.slice(0, 1000)}…` : out;
}

export function maskDeep(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth]';
  if (typeof value === 'string') return maskText(value);
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => maskDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : maskDeep(v, depth + 1);
    return out;
  }
  return value;
}

const stripQuery = (url: unknown) => (typeof url === 'string' ? maskText(url.split(/[?#]/)[0]!) : url);

export function scrubBreadcrumb(b: Breadcrumb): Breadcrumb | null {
  // Our own log lines: only the event name travels, never its fields (user ids, design ids …).
  if (b.category === 'console') {
    const raw = typeof b.message === 'string' ? b.message : '';
    let event = 'console';
    try {
      event = String((JSON.parse(raw) as { event?: string }).event ?? 'console');
    } catch { /* not one of our JSON lines */ }
    return { category: 'log', level: b.level, timestamp: b.timestamp, message: maskText(event).slice(0, 80) };
  }
  const data = b.data ?? {};
  return {
    ...b,
    message: typeof b.message === 'string' ? maskText(b.message) : b.message,
    data: { method: data.method, status_code: data.status_code, url: stripQuery(data.url) },
  };
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  if (event.request) {
    const headers = Object.fromEntries(Object.entries(event.request.headers ?? {}).filter(([k]) => HEADER_ALLOW.has(k.toLowerCase())));
    event.request = { method: event.request.method, url: stripQuery(event.request.url) as string | undefined, headers };
  }
  if (event.message) event.message = maskText(event.message);
  if (event.logentry) event.logentry = { message: event.logentry.message && maskText(event.logentry.message) };
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = maskText(ex.value);
    for (const f of ex.stacktrace?.frames ?? []) {
      delete f.vars;
      // Source lines are our own code, masked anyway in case a literal ever slips into it.
      if (f.context_line) f.context_line = maskText(f.context_line);
      f.pre_context = f.pre_context?.map(maskText);
      f.post_context = f.post_context?.map(maskText);
    }
  }
  event.breadcrumbs = event.breadcrumbs?.map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  if (event.extra) event.extra = maskDeep(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = maskDeep(event.contexts) as typeof event.contexts;
  if (event.tags) event.tags = maskDeep(event.tags) as typeof event.tags;
  return event;
}

let enabled = false;

/** Called once, before the app module loads (src/instrument.ts). A missing DSN keeps Sentry off. */
export function initMonitoring(cfg: Pick<Config, 'SENTRY_DSN' | 'SENTRY_ENVIRONMENT' | 'SENTRY_RELEASE' | 'SENTRY_TRACES_SAMPLE_RATE' | 'NODE_ENV'>) {
  if (!cfg.SENTRY_DSN || enabled) return enabled;
  Sentry.init({
    dsn: cfg.SENTRY_DSN,
    environment: cfg.SENTRY_ENVIRONMENT ?? cfg.NODE_ENV,
    release: cfg.SENTRY_RELEASE,
    tracesSampleRate: cfg.SENTRY_TRACES_SAMPLE_RATE || undefined,
    maxBreadcrumbs: 30,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: [...HEADER_ALLOW] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
    },
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (b) => scrubBreadcrumb(b),
  });
  enabled = true;
  return enabled;
}

type ErrorSink = (error: unknown, ctx: { tags?: Record<string, string>; requestId?: string }) => void;
let sink: ErrorSink | null = null;

/** API.md §7.41: our own error alarm registers here (no Sentry needed). */
export function setErrorSink(fn: ErrorSink | null) {
  sink = fn;
}

/** Unexpected failures only (bugs, outages) — never 4xx or user-caused errors. Sentry only with a DSN. */
export function reportError(error: unknown, ctx: { tags?: Record<string, string>; requestId?: string } = {}) {
  try {
    sink?.(error, ctx);
  } catch {
    // the alarm must never break the request that failed
  }
  if (!enabled) return;
  Sentry.captureException(error, { tags: ctx.tags, extra: ctx.requestId ? { requestId: ctx.requestId } : undefined });
}

export async function flushMonitoring(timeoutMs = 2000) {
  if (enabled) await Sentry.flush(timeoutMs);
}

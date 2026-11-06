import { createHash } from 'node:crypto';
import { z } from 'zod';
import { maskText } from '../common/monitoring.js';

// Founder alerts (API.md §7.41; YediOda #71, #90, #92; owner: our own error alarm instead of Sentry). What is sent,
// and to whom, is set in the admin. Every kind is throttled so a storm cannot flood the inbox (RES).

export const ALERT_KINDS = ['error', 'job', 'purchase', 'disk', 'budget', 'test'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const AlertSettingsSchema = z
  .object({
    superAdmins: z.boolean(), // every active SUPER_ADMIN's address
    extraRecipients: z.array(z.string().trim().toLowerCase().email().max(120)).max(5),
    errors: z.object({ enabled: z.boolean(), repeatMinutes: z.number().int().min(15).max(1440) }).strict(),
    jobs: z.object({ enabled: z.boolean() }).strict(),
    purchases: z.object({ enabled: z.boolean() }).strict(),
    disk: z.object({ enabled: z.boolean(), thresholdPct: z.number().int().min(50).max(99) }).strict(),
    budget: z.object({ enabled: z.boolean() }).strict(),
  })
  .strict();
export type AlertSettings = z.infer<typeof AlertSettingsSchema>;

export const DEFAULT_ALERTS: AlertSettings = {
  superAdmins: true,
  extraRecipients: [],
  errors: { enabled: true, repeatMinutes: 60 },
  jobs: { enabled: true },
  purchases: { enabled: true },
  disk: { enabled: true, thresholdPct: 85 },
  budget: { enabled: true },
};

/** At most this many alert mails per hour, whatever happens. */
export const HOURLY_CAP = 20;

export function parseAlerts(value: unknown): { settings: AlertSettings; ok: boolean } {
  if (value === undefined || value === null) return { settings: DEFAULT_ALERTS, ok: true };
  if (typeof value !== 'object' || Array.isArray(value)) return { settings: DEFAULT_ALERTS, ok: false };
  const r = AlertSettingsSchema.safeParse({ ...DEFAULT_ALERTS, ...(value as Record<string, unknown>) });
  return r.success ? { settings: r.data, ok: true } : { settings: DEFAULT_ALERTS, ok: false };
}

/** Message with the variable parts taken out, so "user 123 not found" and "user 456 not found" are one group. */
export function normalizeMessage(message: string): string {
  return maskText(message)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b\d+(\.\d+)?\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** The first stack frame in our own code ("src/designs/designs.service.ts:123" → without line numbers). */
export function appFrame(stack: string | undefined): string {
  const line = (stack ?? '').split('\n').find((l) => /[/\\](src|dist)[/\\]/.test(l) && !/node_modules/.test(l));
  if (!line) return '';
  const m = line.match(/(?:src|dist)[/\\][^\s):]+/);
  return m ? m[0].replace(/\\/g, '/') : '';
}

export type ErrorContext = { tags?: Record<string, string>; requestId?: string };

export function classify(error: unknown, ctx: ErrorContext) {
  const e = error instanceof Error ? error : new Error(String(error));
  const kind: 'http' | 'job' | 'other' = ctx.tags?.queue ? 'job' : ctx.tags?.route || ctx.requestId ? 'http' : 'other';
  const name = (e.name || 'Error').slice(0, 80);
  const message = normalizeMessage(e.message || name);
  const frame = appFrame(e.stack);
  const where = ctx.tags?.queue ? `${ctx.tags.queue}:${ctx.tags.job ?? '?'}` : (ctx.tags?.route ?? '');
  const location = [where, frame].filter(Boolean).join(' · ').slice(0, 200) || '—';
  const fingerprint = createHash('sha256').update([kind, name, message, where, frame].join('|')).digest('hex');
  return { kind, name, message, location, fingerprint };
}

/** Human-readable change list for the audit log. */
export function alertsDiff(prev: AlertSettings, next: AlertSettings): string[] {
  const out: string[] = [];
  for (const k of Object.keys(next) as Array<keyof AlertSettings>) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) out.push(k === 'extraRecipients' ? `alıcılar: ${prev.extraRecipients.length} → ${next.extraRecipients.length}` : `${k}: ${JSON.stringify(prev[k])} → ${JSON.stringify(next[k])}`);
  }
  return out;
}

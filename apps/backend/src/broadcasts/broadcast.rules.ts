import { z } from 'zod';

// Pure rules of the admin "Toplu Gönderim" (fal-app broadcast + kampanya-siniflandirma, reduced to what
// Casalume needs). No I/O here, so every rule is unit-tested on its own.

/** Who receives a broadcast. Only users with at least one registered push device are ever counted. */
export const AudienceSchema = z
  .object({
    plan: z.enum(['FREE', 'PRO']).optional(),
    platform: z.enum(['ios', 'android']).optional(),
    locale: z.enum(['tr', 'en']).optional(),
    accounts: z.enum(['all', 'registered', 'guests']).default('all'),
    /** Not seen for at least N days (win-back). */
    inactiveDays: z.number().int().min(1).max(365).optional(),
    /** Seen within the last N days. */
    activeDays: z.number().int().min(1).max(365).optional(),
    registeredAfter: z.iso.date().optional(),
    registeredBefore: z.iso.date().optional(),
    /** Hand-picked users (support follow-ups, pilots). */
    emails: z.array(z.email().max(254)).min(1).max(500).optional(),
  })
  .strict()
  .refine((a) => !(a.inactiveDays && a.activeDays), 'inactiveDays ile activeDays birlikte kullanılamaz');
export type Audience = z.infer<typeof AudienceSchema>;

/**
 * In-app destinations only (EXT-02: a broadcast can never send users to an arbitrary website). The mobile app
 * maps these paths to its screens; the web uses them as they are.
 */
export const LINK_RE = /^\/(studio|tasarimlarim|sohbet|fiyatlar)(\?[a-z_]{1,20}=[a-z0-9_-]{1,40})?$/;
export const LINKS = [
  { path: '/studio', label: 'Stüdyo' },
  { path: '/tasarimlarim', label: 'Tasarımlarım' },
  { path: '/sohbet', label: 'AI Sohbet' },
  { path: '/fiyatlar', label: 'Fiyatlar (satın alma — yalnız kampanya)' },
] as const;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const ContentSchema = z
  .object({
    title: text(3, 80),
    body: text(5, 300),
    link: z.string().regex(LINK_RE, 'Yalnız uygulama içi bir bağlantı').nullable().optional(),
    kind: z.enum(['SERVICE', 'MARKETING']),
  })
  .strict();
export type Content = z.infer<typeof ContentSchema>;

export const BroadcastInputSchema = ContentSchema.extend({ audience: AudienceSchema }).strict();
export type BroadcastInput = z.infer<typeof BroadcastInputSchema>;

/** Turkish-aware fold: NFKC, invisible characters out, İ/I → i/ı, then diacritics off (ş→s, ı→i …). */
export function fold(textIn: string): string {
  const t = textIn
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
  return t
    .replace(/[ıİ]/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Signals of a commercial electronic message (6563 sayılı Kanun / İYS): such text must be sent as MARKETING,
 * i.e. only to users who gave marketing consent. Patterns match the folded text.
 */
const SIGNALS: Array<{ id: string; re: RegExp }> = [
  { id: 'indirim', re: /\bindirim/ },
  { id: 'kampanya', re: /\bkampanya/ },
  { id: 'firsat', re: /\bfirsat/ },
  { id: 'teklif', re: /\bteklif/ },
  { id: 'kupon', re: /\bkupon|\bpromosyon|\bkod(u|unu)? ile\b/ },
  { id: 'hediye', re: /\bhediye/ },
  { id: 'abonelik', re: /\babone ol|\babonelig|\babonelik|\buyelig|\buyelik/ },
  { id: 'pro', re: /\bpro(ya|ye| uyelik| plan| paket)|\bpro ya gec|\bpro ye gec/ },
  { id: 'deneme', re: /\b(ucretsiz )?deneme sures|\bucretsiz dene/ },
  { id: 'satin_al', re: /\bsatin al|\bkredi (paketi|al|yukle)/ },
  { id: 'fiyat', re: /\bfiyat|\bucretsiz kredi|\b\d+ ?(tl|try)\b|₺/ },
  { id: 'aciliyet', re: /\bson gun|\bkacirma|\bsinirli sure|\bsadece bugun|\bbugune ozel/ },
  { id: 'yuzde', re: /%\s?\d|\d\s?%|\byuzde ?\d/ },
  { id: 'en_commercial', re: /\b(discount|sale|offer|deal|coupon|promo|free trial|subscribe|upgrade|limited time|buy now|% off)\b/ },
];

export function commercialSignals(content: Pick<Content, 'title' | 'body'> & { link?: string | null }): string[] {
  const t = fold(`${content.title} ${content.body}`);
  const found = SIGNALS.filter((s) => s.re.test(t)).map((s) => s.id);
  if (content.link?.startsWith('/fiyatlar')) found.push('satin_alma_ekrani');
  return found;
}

// --- quiet hours (marketing only), Europe/Istanbul wall clock ---

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const ISTANBUL_OFFSET_MIN = 180; // Türkiye has used UTC+3 all year since 2016

function istanbulMinuteOfDay(d: Date) {
  return Math.floor(((d.getTime() / 60_000 + ISTANBUL_OFFSET_MIN) % 1440 + 1440) % 1440);
}

/** True inside [start, end); the window may wrap midnight (21:00–09:00). start === end means "no quiet hours". */
export function inQuietHours(d: Date, start: string, end: string): boolean {
  const s = minutes(start);
  const e = minutes(end);
  if (s === e) return false;
  const m = istanbulMinuteOfDay(d);
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** The first moment at or after `d` that is outside the quiet window (the window's end, Istanbul time). */
export function nextSendableTime(d: Date, start: string, end: string): Date {
  if (!inQuietHours(d, start, end)) return d;
  const m = istanbulMinuteOfDay(d);
  const wait = (minutes(end) - m + 1440) % 1440;
  const at = new Date(d.getTime() + wait * 60_000);
  at.setUTCSeconds(0, 0);
  return at;
}

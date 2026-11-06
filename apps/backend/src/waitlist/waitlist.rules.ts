import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { LOCALES } from '../catalog/catalog.data.js';
import { renderActionMail, type Mail } from '../mail/mailer.service.js';

// Waiting list and newsletter (API.md §7.47; fal-app / maeyja / Yedi Oda #67). Web visitors leave an e-mail to hear
// when the mobile apps launch and when there is news. Commercial e-mail, so: explicit consent with the text version
// (6563 / ETK), double opt-in (only a confirmed address is on the list), a signed leave link, and retention limits.

export const PLATFORMS = ['ios', 'android'] as const;
export const SOURCES = ['home', 'footer'] as const;
export const CONFIRM_TTL_MS = 7 * 86_400_000;
/** A pending address gets another confirmation mail at most every 2 minutes and at most 5 times in all. */
export const RESEND_GAP_MS = 2 * 60_000;
export const MAX_CONFIRM_MAILS = 5;

/** Lower-cased and NFC: one row per mailbox however it is typed. */
export const normalizeEmail = (s: string) => s.normalize('NFC').trim().toLowerCase();

export const SignupSchema = z
  .object({
    email: z.string().trim().max(254).pipe(z.email()),
    locale: z.enum(LOCALES).default('tr'),
    platforms: z
      .array(z.enum(PLATFORMS))
      .max(2)
      .default([])
      .refine((p) => new Set(p).size === p.length, 'duplicate_platform'),
    source: z.enum(SOURCES).default('home'),
    /** The visitor ticked the consent box (ETK); without it nothing is stored. */
    consent: z.literal(true),
    /** Honeypot: hidden on the form, so a value means a bot. */
    website: z.string().max(200).optional(),
  })
  .strict();
export type SignupInput = z.infer<typeof SignupSchema>;

export const WaitlistSettingsSchema = z.object({ enabled: z.boolean() }).strict();
export type WaitlistSettings = z.infer<typeof WaitlistSettingsSchema>;
export const DEFAULT_WAITLIST: WaitlistSettings = { enabled: true };

export function parseWaitlistSettings(value: unknown): { settings: WaitlistSettings; ok: boolean } {
  if (value === undefined || value === null) return { settings: DEFAULT_WAITLIST, ok: true };
  const r = WaitlistSettingsSchema.safeParse(value);
  return r.success ? { settings: r.data, ok: true } : { settings: DEFAULT_WAITLIST, ok: false };
}

/** `ayse@example.com` → `a***@example.com`: enough to recognise an entry, not to write to it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

// ---- leave link: the entry id plus an HMAC of it, so no address travels in the URL and ids cannot be guessed ----

export const leaveKey = (secret: string) => createHmac('sha256', secret).update('casalume:waitlist-leave').digest();
export const leaveSignature = (id: string, key: Buffer) => createHmac('sha256', key).update(`leave:${id}`).digest('base64url').slice(0, 32);
export function verifyLeaveSignature(id: string, signature: string, key: Buffer): boolean {
  const expected = Buffer.from(leaveSignature(id, key));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Web page for a waitlist link, in the visitor's language (Turkish pages have no prefix). */
export function webPath(base: string, locale: string, path: string) {
  return `${base.replace(/\/+$/, '')}${locale === 'tr' ? '' : `/${locale}`}${path}`;
}

/** Confirmation e-mail (Turkish, else English, like the other account mails). The token travels in the fragment. */
export function confirmMail(to: string, locale: string, url: string): Mail {
  const en = locale !== 'tr';
  return renderActionMail({
    to,
    subject: en ? 'Confirm your place on the list — Casalume' : 'Bekleme listesi kaydını onayla — Casalume',
    heading: en ? 'One step left' : 'Bir adım kaldı',
    lines: en
      ? ['Confirm this address and we will e-mail you when the Casalume app arrives on the App Store and Google Play, and when there is news.']
      : ["Bu adresi onayla; Casalume uygulaması App Store ve Google Play'e geldiğinde ve yenilik olduğunda sana e-postayla haber verelim."],
    cta: en ? 'Confirm my address' : 'Adresimi onayla',
    url,
    footer: en
      ? 'The link is valid for 7 days. If you did not ask for this, ignore this e-mail and you will not be added.'
      : 'Bağlantı 7 gün geçerlidir. Bu isteği sen yapmadıysan e-postayı yok say; listeye eklenmezsin.',
  });
}

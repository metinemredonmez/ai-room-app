import { createHmac, timingSafeEqual } from 'node:crypto';
import { escapeHtml, mailButton, mailShell, type Mail } from '../mail/mailer.service.js';

// E-mail side of Toplu Gönderim (maeyja campaign.mail.ts pattern).

/** Test sends use this pseudo delivery id: their unsubscribe link works without touching real data. */
export const TEST_DELIVERY = 'test';

/** Domain-separated key, so an unsubscribe signature can never be replayed as any other token. */
export const unsubscribeKey = (secret: string) => createHmac('sha256', secret).update('casalume:broadcast-unsubscribe').digest();

/**
 * Unsubscribe links carry the delivery id plus an HMAC of it: no e-mail address in the URL (so none in access
 * logs), and nobody can unsubscribe someone else by guessing ids.
 */
export const unsubscribeSignature = (deliveryId: string, key: Buffer) =>
  createHmac('sha256', key).update(`unsubscribe:${deliveryId}`).digest('base64url').slice(0, 32);

export function verifyUnsubscribeSignature(deliveryId: string, signature: string, key: Buffer): boolean {
  const expected = Buffer.from(unsubscribeSignature(deliveryId, key));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const COPY = {
  tr: {
    open: "Casalume'da aç",
    service: 'Bu e-postayı Casalume hesabınla ilgili bilgilendirme olarak aldın.',
    marketing: 'Bu e-postayı Casalume kampanya iletilerine izin verdiğin için aldın.',
    unsubscribe: 'Abonelikten çık',
  },
  en: {
    open: 'Open in Casalume',
    service: 'You are receiving this as information about your Casalume account.',
    marketing: 'You are receiving this because you agreed to receive offers from Casalume.',
    unsubscribe: 'Unsubscribe',
  },
} as const;

export interface BroadcastMailInput {
  to: string;
  locale: string;
  kind: 'SERVICE' | 'MARKETING';
  subject: string;
  body: string;
  /** Absolute web URL for the button (WEB_APP_URL + in-app path), or null for no button. */
  ctaUrl: string | null;
  /** Web page that confirms the unsubscribe (footer link). Marketing only. */
  unsubscribeUrl: string | null;
  /** API endpoint for RFC 8058 one-click unsubscribe (List-Unsubscribe header). Marketing only. */
  oneClickUrl: string | null;
  /** Commercial e-mail must name its sender (6563 sayılı Kanun / ETK yönetmeliği). */
  sender: { name: string; address: string; email: string };
}

/** Admin text is plain text: escaped, paragraphs on blank lines, single newlines kept (WEB-01). */
export function renderBroadcastMail(o: BroadcastMailInput): Mail {
  const copy = COPY[o.locale === 'en' ? 'en' : 'tr'];
  const paragraphs = o.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const bodyHtml =
    paragraphs.map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('') +
    (o.ctaUrl ? mailButton(o.ctaUrl, copy.open) : '');
  const senderLine = [o.sender.name, o.sender.address, o.sender.email].filter(Boolean).join(' · ');
  const marketing = o.kind === 'MARKETING' && o.unsubscribeUrl;
  const footerHtml = marketing
    ? `${escapeHtml(copy.marketing)} <a href="${escapeHtml(o.unsubscribeUrl!)}" style="color:#6E655E">${escapeHtml(copy.unsubscribe)}</a><br>${escapeHtml(senderLine)}`
    : `${escapeHtml(copy.service)}<br>${escapeHtml(senderLine)}`;
  const text = [
    o.subject, '', ...paragraphs, ...(o.ctaUrl ? ['', `${copy.open}: ${o.ctaUrl}`] : []), '',
    marketing ? `${copy.marketing} ${copy.unsubscribe}: ${o.unsubscribeUrl}` : copy.service, senderLine,
  ].join('\n');
  return {
    to: o.to,
    subject: o.subject,
    html: mailShell({ heading: o.subject, bodyHtml, footerHtml }),
    text,
    ...(marketing && o.oneClickUrl
      ? { headers: { 'List-Unsubscribe': `<${o.oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }
      : {}),
  };
}

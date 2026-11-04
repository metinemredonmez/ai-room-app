import {
  TEST_DELIVERY, renderBroadcastMail, unsubscribeKey, unsubscribeSignature, verifyUnsubscribeSignature,
} from './broadcasts/broadcast.mail.js';
import {
  AudienceSchema, BroadcastInputSchema, ContentSchema, commercialSignals, fold, inQuietHours, nextSendableTime,
} from './broadcasts/broadcast.rules.js';
import { renderActionMail } from './mail/mailer.service.js';

// API.md §7.16: Toplu Gönderim rules. INP-01 (bounded input), EXT-02 (in-app links only), 6563/İYS (commercial text).

describe('broadcast audience and content (INP-01)', () => {
  it('accepts known filters only', () => {
    expect(AudienceSchema.parse({})).toEqual({ accounts: 'all' });
    expect(AudienceSchema.safeParse({ plan: 'PRO', platform: 'ios', inactiveDays: 14 }).success).toBe(true);
    expect(AudienceSchema.safeParse({ plan: 'GOLD' }).success).toBe(false);
    expect(AudienceSchema.safeParse({ role: 'ADMIN' }).success).toBe(false);
    expect(AudienceSchema.safeParse({ inactiveDays: 7, activeDays: 7 }).success).toBe(false);
    expect(AudienceSchema.safeParse({ emails: Array.from({ length: 501 }, (_, i) => `u${i}@example.com`) }).success).toBe(false);
  });

  it('links stay inside the app (EXT-02)', () => {
    const ok = (link: string) => ContentSchema.safeParse({ title: 'Yeni stiller', body: 'Göz at', link, kind: 'SERVICE' }).success;
    expect(ok('/studio')).toBe(true);
    expect(ok('/studio?tool=paint')).toBe(true);
    expect(ok('/tasarimlarim')).toBe(true);
    for (const bad of ['https://evil.example', '//evil.example', '/admin', '/studio?url=https://x', 'javascript:alert(1)', '/studio/../admin']) {
      expect(ok(bad)).toBe(false);
    }
  });

  it('needs title, body, kind and audience', () => {
    expect(BroadcastInputSchema.safeParse({ title: 'Merhaba', body: 'Yeni stiller geldi', kind: 'SERVICE', audience: {} }).success).toBe(true);
    expect(BroadcastInputSchema.safeParse({ title: 'Hi', body: 'Yeni stiller geldi', kind: 'SERVICE', audience: {} }).success).toBe(false);
    expect(BroadcastInputSchema.safeParse({ title: 'Merhaba', body: 'Yeni stiller geldi', kind: 'PROMO', audience: {} }).success).toBe(false);
  });
});

describe('commercial message signals (6563 / İYS)', () => {
  it('lets plain service text through', () => {
    expect(commercialSignals({ title: 'Yeni stiller geldi', body: 'Kapadokya ve Ege stillerini stüdyoda dene.' })).toEqual([]);
    expect(commercialSignals({ title: 'Bakım tamamlandı', body: 'Tasarımların yeniden oluşturulabilir.' })).toEqual([]);
    expect(commercialSignals({ title: 'Profesyonel ipucu', body: 'Projelerini düzenli tut.' })).toEqual([]);
  });

  it('flags offers, prices, urgency and purchase screens', () => {
    const s = commercialSignals({ title: "PRO'ya geç", body: '%50 indirim, sadece bugün!' });
    expect(s).toEqual(expect.arrayContaining(['pro', 'indirim', 'yuzde', 'aciliyet']));
    expect(commercialSignals({ title: 'BUGÜNE ÖZEL FIRSAT', body: 'Kaçırma' })).toEqual(expect.arrayContaining(['firsat', 'aciliyet']));
    expect(commercialSignals({ title: 'Kredi paketi', body: '99 TL' })).toEqual(expect.arrayContaining(['satin_al', 'fiyat']));
    expect(commercialSignals({ title: 'Upgrade now', body: 'Limited time offer' })).toContain('en_commercial');
    expect(commercialSignals({ title: 'Yeni', body: 'Göz at', link: '/fiyatlar' })).toContain('satin_alma_ekrani');
  });

  it('is not fooled by invisible characters or Turkish casing', () => {
    expect(fold('İNDİRİM')).toBe('indirim');
    expect(fold('KAÇIRMA')).toBe('kacirma');
    expect(commercialSignals({ title: 'in​dirim', body: 'yeni' })).toContain('indirim');
  });
});

describe('marketing quiet hours (Europe/Istanbul)', () => {
  const at = (iso: string) => new Date(iso);

  it('wraps midnight', () => {
    expect(inQuietHours(at('2026-11-04T19:30:00Z'), '21:00', '09:00')).toBe(true); // 22:30 Istanbul
    expect(inQuietHours(at('2026-11-04T05:59:00Z'), '21:00', '09:00')).toBe(true); // 08:59
    expect(inQuietHours(at('2026-11-04T06:00:00Z'), '21:00', '09:00')).toBe(false); // 09:00
    expect(inQuietHours(at('2026-11-04T09:00:00Z'), '21:00', '09:00')).toBe(false); // 12:00
    expect(inQuietHours(at('2026-11-04T09:00:00Z'), '00:00', '00:00')).toBe(false); // no window
  });

  it('moves a send to the end of the window', () => {
    expect(nextSendableTime(at('2026-11-04T19:30:00Z'), '21:00', '09:00').toISOString()).toBe('2026-11-05T06:00:00.000Z');
    expect(nextSendableTime(at('2026-11-05T02:10:00Z'), '21:00', '09:00').toISOString()).toBe('2026-11-05T06:00:00.000Z');
    const noon = at('2026-11-04T09:00:00Z');
    expect(nextSendableTime(noon, '21:00', '09:00')).toBe(noon);
  });
});

describe('broadcast e-mail (maeyja campaign pattern)', () => {
  const sender = { name: 'Casalume', address: 'Maltepe, İstanbul', email: 'kvkk@casalume.app' };
  const base = { to: 'a@example.com', locale: 'tr', subject: 'Yeni stiller', body: 'Merhaba\n\n<script>alert(1)</script>\nikinci satır', sender };

  it('defaults to push and allows longer e-mail bodies', () => {
    expect(ContentSchema.parse({ title: 'Merhaba', body: 'Yeni stiller geldi', kind: 'SERVICE' }).channel).toBe('PUSH');
    expect(ContentSchema.safeParse({ title: 'Merhaba', body: 'x'.repeat(1500), kind: 'SERVICE', channel: 'EMAIL' }).success).toBe(true);
    expect(ContentSchema.safeParse({ title: 'Merhaba', body: 'x'.repeat(2001), kind: 'SERVICE', channel: 'EMAIL' }).success).toBe(false);
  });

  it('escapes the admin text and keeps paragraphs (WEB-01)', () => {
    const m = renderBroadcastMail({ ...base, kind: 'SERVICE', ctaUrl: 'https://casalume.app/studio', unsubscribeUrl: null, oneClickUrl: null });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;<br>ikinci satır');
    expect(m.html).toContain('href="https://casalume.app/studio"');
    expect(m.html).toContain('Casa<span style="color:#A9532E">lume</span>');
    expect(m.headers).toBeUndefined();
    expect(m.text).toContain('Maltepe, İstanbul');
  });

  it('marketing mail carries the sender, an unsubscribe link and RFC 8058 headers', () => {
    const m = renderBroadcastMail({
      ...base, kind: 'MARKETING', ctaUrl: null,
      unsubscribeUrl: 'https://casalume.app/abonelikten-cik?r=x&t=y', oneClickUrl: 'https://api.casalume.app/v1/unsubscribe/one-click?r=x&t=y',
    });
    expect(m.html).toContain('Abonelikten çık');
    expect(m.html).toContain('href="https://casalume.app/abonelikten-cik?r=x&amp;t=y"');
    expect(m.headers).toEqual({
      'List-Unsubscribe': '<https://api.casalume.app/v1/unsubscribe/one-click?r=x&t=y>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('unsubscribe links cannot be forged or replayed for another delivery', () => {
    const key = unsubscribeKey('a-long-jwt-secret-for-tests-only-0123456789');
    const sig = unsubscribeSignature('d1', key);
    expect(verifyUnsubscribeSignature('d1', sig, key)).toBe(true);
    expect(verifyUnsubscribeSignature('d2', sig, key)).toBe(false);
    expect(verifyUnsubscribeSignature('d1', `${sig.slice(0, -1)}A`, key)).toBe(sig.endsWith('A'));
    expect(verifyUnsubscribeSignature('d1', '', key)).toBe(false);
    expect(verifyUnsubscribeSignature(TEST_DELIVERY, unsubscribeSignature(TEST_DELIVERY, unsubscribeKey('other-secret')), key)).toBe(false);
  });

  it('account e-mails use the Casalume brand, not the old name', () => {
    const m = renderActionMail({ to: 'a@example.com', subject: 's', heading: 'h', lines: ['l'], cta: 'c', url: 'https://casalume.app', footer: 'f' });
    expect(m.html).toContain('Casa<span style="color:#A9532E">lume</span>');
    expect(m.html).not.toContain('AI <span');
  });
});

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOCALES } from './catalog/catalog.data.js';
import { AnnouncementSchema, compact, contentDiff, DEFAULT_CONTENT, LINK_RE, loadDefaults, LocaleTextsSchema, parseContent, publicContent, SiteContentSchema, type SiteContent } from './site/site-content.rules.js';

// API.md §7.46: home page and FAQ from the admin. Plain text only, our own links only, the announcement inside its
// window, and the admin's starting texts are exactly the web's own translations.

const withContent = (mut: (c: SiteContent) => void) => {
  const c = structuredClone(DEFAULT_CONTENT);
  mut(c);
  return c;
};

describe('site content rules', () => {
  it('the defaults asset is the web landing texts, and every built-in translation fits the limits', async () => {
    const script = pathToFileURL(join(process.cwd(), '../../scripts/landing-defaults.mjs')).href;
    const { landingDefaults } = (await import(script)) as { landingDefaults: () => unknown };
    expect(loadDefaults()).toEqual(landingDefaults());
    const defaults = loadDefaults();
    for (const l of LOCALES) {
      const r = LocaleTextsSchema.safeParse(defaults[l]);
      expect(r.success ? '' : `${l}: ${JSON.stringify(r.error.issues[0])}`).toBe('');
    }
  });

  it('texts are trimmed plain text; control and bidi characters, empty and over-long texts are refused', () => {
    expect(LocaleTextsSchema.parse({ heroTitle: '  Yeni oda  ' }).heroTitle).toBe('Yeni oda');
    expect(LocaleTextsSchema.safeParse({ heroTitle: 'a‮b' }).success).toBe(false);
    expect(LocaleTextsSchema.safeParse({ heroTitle: 'a\u0000b' }).success).toBe(false);
    expect(LocaleTextsSchema.safeParse({ heroTitle: 'iki\nsatır' }).success).toBe(false);
    expect(LocaleTextsSchema.safeParse({ heroTitle: '   ' }).success).toBe(false);
    expect(LocaleTextsSchema.safeParse({ ctaPrimary: 'x'.repeat(31) }).success).toBe(false);
    expect(LocaleTextsSchema.safeParse({ unknownField: 'x' }).success).toBe(false);
    // An answer may have paragraphs; three or more line breaks collapse to one empty line.
    expect(LocaleTextsSchema.parse({ faq: [{ q: 'Soru?', a: 'Bir.\r\n\r\n\r\nİki.' }] }).faq?.[0].a).toBe('Bir.\n\nİki.');
    expect(LocaleTextsSchema.safeParse({ faq: [{ q: 'Aynı?', a: 'x' }, { q: 'aynı?', a: 'y' }] }).success).toBe(false);
    expect(LocaleTextsSchema.safeParse({ faq: Array.from({ length: 21 }, (_, i) => ({ q: `S${i}?`, a: 'C' })) }).success).toBe(false);
    expect(LocaleTextsSchema.safeParse({ trust: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false);
  });

  it('the announcement links only to our own pages and needs a text and a sane window', () => {
    for (const ok of ['/studio', '/fiyatlar', '/sohbet', '/blog', '/blog/salon-fikirleri']) expect(LINK_RE.test(ok)).toBe(true);
    for (const bad of ['https://evil.example', '//evil.example', '/admin', '/blog/../x', 'javascript:alert(1)', '/studio?x=1', '/blog/A']) expect(LINK_RE.test(bad)).toBe(false);
    const a = DEFAULT_CONTENT.announcement;
    expect(AnnouncementSchema.safeParse({ ...a, enabled: true }).success).toBe(false);
    expect(AnnouncementSchema.safeParse({ ...a, enabled: true, text: { tr: 'Yeni stiller geldi' } }).success).toBe(true);
    expect(AnnouncementSchema.safeParse({ ...a, text: { tr: 'x' }, startsAt: '2026-11-10T00:00:00+03:00', endsAt: '2026-11-09T00:00:00+03:00' }).success).toBe(false);
    expect(AnnouncementSchema.safeParse({ ...a, text: { xx: 'x' } }).success).toBe(false);
  });

  it('a visitor sees the announcement only inside its window, in their language or else English', () => {
    const c = withContent((c) => {
      c.announcement = { enabled: true, tone: 'promo', link: '/fiyatlar', text: { tr: 'Kampanya', en: 'Sale' }, startsAt: '2026-11-10T00:00:00+03:00', endsAt: '2026-11-12T00:00:00+03:00' };
      c.texts.tr = { faqTitle: 'SSS' };
    });
    expect(publicContent(c, 'tr', new Date('2026-11-09T12:00:00Z')).announcement).toBeNull();
    expect(publicContent(c, 'tr', new Date('2026-11-11T12:00:00Z')).announcement).toEqual({ text: 'Kampanya', tone: 'promo', link: '/fiyatlar' });
    expect(publicContent(c, 'de', new Date('2026-11-11T12:00:00Z')).announcement?.text).toBe('Sale');
    expect(publicContent(c, 'tr', new Date('2026-11-12T00:00:00+03:00')).announcement).toBeNull();
    expect(publicContent(c, 'de', new Date('2026-11-11T12:00:00Z')).texts).toEqual({});
    expect(publicContent(c, 'tr').texts).toEqual({ faqTitle: 'SSS' });
    const noEn = withContent((c) => (c.announcement = { ...c.announcement, enabled: true, text: { tr: 'Yalnız Türkçe' } }));
    expect(publicContent(noEn, 'de').announcement).toBeNull();
  });

  it('stored junk falls back to the defaults; empty languages are dropped; the audit diff names parts, never texts', () => {
    expect(parseContent(undefined)).toEqual({ content: DEFAULT_CONTENT, ok: true });
    expect(parseContent({ sections: 'x' }).ok).toBe(false);
    const stored = withContent((c) => (c.texts = { tr: {}, en: { faqTitle: 'FAQ' } }));
    expect(Object.keys(compact(stored).texts)).toEqual(['en']);
    expect(SiteContentSchema.safeParse(stored).success).toBe(true);
    const next = withContent((c) => {
      c.sections.pricing = false;
      c.texts.tr = { heroTitle: 'Gizli kampanya metni', faq: [{ q: 'S?', a: 'C' }] };
    });
    const diff = contentDiff(DEFAULT_CONTENT, next);
    expect(diff).toEqual(['bölüm pricing: açık → kapalı', 'tr: faq, heroTitle']);
    expect(diff.join(' ')).not.toContain('Gizli');
  });
});

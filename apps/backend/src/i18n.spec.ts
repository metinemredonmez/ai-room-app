import { localeOf } from './app.controller.js';
import { LOCALES, TOOLS, contentLocale, isLocale } from './catalog/catalog.data.js';
import { localize } from './catalog/catalog.i18n.js';
import { renderBroadcastMail } from './broadcasts/broadcast.mail.js';

// API.md §7.17: eleven web and app languages. Texts written in code or the admin exist in Turkish and English;
// every other language reads its translation file, else English.

const req = (acceptLanguage?: string, locale?: string) =>
  ({ query: locale ? { locale } : {}, headers: acceptLanguage ? { 'accept-language': acceptLanguage } : {} }) as never;

describe('locale negotiation', () => {
  it('takes ?locale= first', () => {
    expect(localeOf(req('en', 'ja'))).toBe('ja');
  });

  it('honours q-values and skips unsupported languages', () => {
    expect(localeOf(req('pt-BR, ja;q=0.5, en;q=0.7'))).toBe('en');
    expect(localeOf(req('de-DE,de;q=0.9,en;q=0.8'))).toBe('de');
    expect(localeOf(req('zh-CN'))).toBe('zh');
  });

  it('ignores q=0 and unknown values, then falls back', () => {
    expect(localeOf(req('fr;q=0, pt'))).toBe('tr');
    expect(localeOf(req(undefined, 'xx'), 'ko')).toBe('ko');
    expect(localeOf(req(undefined, 'xx'), 'xx')).toBe('tr');
  });

  it('knows the eleven languages', () => {
    expect(LOCALES).toHaveLength(11);
    expect(isLocale('nl')).toBe(true);
    expect(isLocale('pt')).toBe(false);
    expect(contentLocale('tr')).toBe('tr');
    expect(contentLocale('de')).toBe('en');
    expect(contentLocale(null)).toBe('en');
  });
});

describe('catalog localisation', () => {
  it('returns Turkish and English from the code', () => {
    expect(localize('tr', 'tools.paint.name', TOOLS.paint.name)).toBe(TOOLS.paint.name.tr);
    expect(localize('en', 'tools.paint.name', TOOLS.paint.name)).toBe(TOOLS.paint.name.en);
  });

  it('never returns an empty name for the other languages', () => {
    for (const locale of LOCALES) {
      const name = localize(locale, 'tools.paint.name', TOOLS.paint.name);
      expect(name.trim().length).toBeGreaterThan(0);
      if (locale !== 'tr') expect(name).not.toBe(TOOLS.paint.name.tr);
    }
  });

  it('falls back to English for a key with no translation', () => {
    expect(localize('de', 'tools.not-a-tool.name', { tr: 'Yok', en: 'Missing' })).toBe('Missing');
  });
});

describe('mail copy', () => {
  const mail = (locale: string) =>
    renderBroadcastMail({
      to: 'a@example.com', locale, kind: 'SERVICE', subject: 'S', body: 'Body', ctaUrl: null,
      unsubscribeUrl: null, oneClickUrl: null, sender: { name: 'Casalume', address: '', email: '' },
    });

  it('sends Turkish to Turkish users and English to everyone else', () => {
    expect(mail('tr').text).toContain('Casalume hesabınla');
    expect(mail('de').text).toContain('your Casalume account');
    expect(mail('ja').text).toContain('your Casalume account');
  });
});

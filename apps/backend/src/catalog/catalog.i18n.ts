import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LOCALES, type Locale } from './catalog.data.js';

// Catalog names in the languages beyond Turkish and English (tool, room, floor, colour, plan and style names), filled
// by scripts/i18n_fill.py from assets/i18n/catalog/tr.json. src/catalog and dist/catalog both resolve to assets/.
const DIR = fileURLToPath(new URL('../../assets/i18n/catalog/', import.meta.url));

function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) flatten(v, `${prefix}${k}.`, out);
  } else if (typeof obj === 'string') {
    out[prefix.slice(0, -1)] = obj;
  }
  return out;
}

function load(locale: Locale): Record<string, string> {
  try {
    return flatten(JSON.parse(readFileSync(`${DIR}${locale}.json`, 'utf8')));
  } catch {
    return {}; // not translated yet: English is used
  }
}

const TABLE = new Map(LOCALES.filter((l) => l !== 'tr' && l !== 'en').map((l) => [l, load(l)]));

/** Turkish and English come from the code or the admin; other languages from the translation file, else English. */
export function localize(locale: Locale, key: string, text: { tr: string; en: string }): string {
  if (locale === 'tr' || locale === 'en') return text[locale];
  return TABLE.get(locale)?.[key] || text.en;
}

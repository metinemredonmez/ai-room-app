// Writes assets/i18n/catalog/{tr,en}.json from the code catalog — the source scripts/i18n_fill.py translates from.
// Run after changing catalog names: npm run i18n:catalog, then the fill script for the other languages.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CYCLE_NAMES, DEFAULT_CYCLES } from '../src/billing/plans.rules.js';
import { COLORS, FLOORS, ROOMS, STYLE_SEED, TOOLS, TOOL_IDS } from '../src/catalog/catalog.data.js';

const DIR = fileURLToPath(new URL('../assets/i18n/catalog/', import.meta.url));
for (const l of ['tr', 'en'] as const) {
  const data = {
    tools: Object.fromEntries(TOOL_IDS.map((id) => [id, { name: TOOLS[id].name[l], description: TOOLS[id].description[l] }])),
    rooms: Object.fromEntries(Object.entries(ROOMS).map(([id, r]) => [id, { name: r.name[l] }])),
    floors: Object.fromEntries(Object.entries(FLOORS).map(([id, f]) => [id, { name: f.name[l] }])),
    colors: Object.fromEntries(COLORS.map((c) => [c.id, { name: c.name[l] }])),
    // Period names and the default badges (a badge the admin rewrites shows in English in the other languages).
    plans: Object.fromEntries(
      DEFAULT_CYCLES.map((cy) => [`pro_${cy.cycle}`, { name: CYCLE_NAMES[cy.cycle][l], ...(cy.badgeTr ? { badge: l === 'tr' ? cy.badgeTr : cy.badgeEn } : {}) }]),
    ),
    styles: Object.fromEntries(STYLE_SEED.map((s) => [s.id, { name: l === 'tr' ? s.nameTr : s.nameEn, description: l === 'tr' ? s.descriptionTr : s.descriptionEn }])),
  };
  writeFileSync(`${DIR}${l}.json`, `${JSON.stringify(data, null, 2)}\n`);
}
console.log('assets/i18n/catalog/{tr,en}.json written');

#!/usr/bin/env node
// Writes apps/backend/assets/site/landing-defaults.json from the web's own landing texts (API.md §7.46), so the admin
// can show what the site says today and start an edit from it. Run after changing a `landing` text in
// apps/web/src/messages; the backend's site-content test fails while the two differ.
//   node scripts/landing-defaults.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["tr", "en", "de", "es", "fr", "it", "ru", "nl", "ja", "ko", "zh"];
const TEXT = ["badge", "heroTitle", "heroText", "ctaPrimary", "ctaSecondary", "galleryTitle", "galleryText", "toolsTitle", "toolsText", "moreTools", "featuresTitle", "featuresText", "proBadge", "proTitle", "proText", "howTitle", "stylesTitle", "stylesText", "pricingTitle", "pricingText", "faqTitle", "finalTitle", "finalCta"];
const LISTS = ["trust", "proPoints"];

export function landingDefaults() {
  const out = {};
  for (const l of LOCALES) {
    const L = JSON.parse(readFileSync(join(root, "apps/web/src/messages", `${l}.json`), "utf8")).landing;
    const d = {};
    for (const k of [...TEXT, ...LISTS]) d[k] = L[k];
    d.faq = L.faq.map(({ q, a }) => ({ q, a }));
    out[l] = d;
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = join(root, "apps/backend/assets/site/landing-defaults.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(landingDefaults(), null, 1) + "\n");
  console.log(`wrote ${file}`);
}

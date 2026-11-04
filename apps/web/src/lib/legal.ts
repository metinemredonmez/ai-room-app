import type { LegalKind } from "./content";

/** Web addresses of the legal texts (Turkish slugs, the same in every language) and the API kind behind each. */
export const LEGAL_PAGES = { kvkk: "privacy", kosullar: "terms", "yapay-zeka": "ai_processing", pazarlama: "marketing" } as const satisfies Record<string, LegalKind>;
export type LegalSlug = keyof typeof LEGAL_PAGES;
export const LEGAL_SLUGS = Object.keys(LEGAL_PAGES) as LegalSlug[];
export const isLegalSlug = (s: string): s is LegalSlug => s in LEGAL_PAGES;

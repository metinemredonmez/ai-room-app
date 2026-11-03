// KVKK legal texts (#9). The texts and their versions live in the LegalDocument table; these are the
// fixed kinds, the version format and the version the bundled defaults (assets/legal) are seeded with.
export const LEGAL_KINDS = ['terms', 'privacy', 'ai_processing', 'marketing'] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];
export const LEGAL_LOCALES = ['tr', 'en'] as const;
export type LegalLocale = (typeof LEGAL_LOCALES)[number];

/** `YYYY-MM-DD` with an optional single-digit revision (`2026-11-01.2`), so plain string order is version order. */
export const LEGAL_VERSION_RE = /^\d{4}-\d{2}-\d{2}(\.[1-9])?$/;
export const INITIAL_LEGAL_VERSION = '2026-11-01';

/** Every legal text can be accepted or declined; the consent log keeps the latest decision per kind. */
export type ConsentKind = LegalKind;
export const CONSENT_KINDS = LEGAL_KINDS;

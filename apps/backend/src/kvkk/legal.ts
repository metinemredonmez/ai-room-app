// Current versions of the legal texts the user agrees to (KVKK). Bump a version to require re-consent.
export const LEGAL_VERSIONS = {
  terms: '2026-11-01',
  privacy: '2026-11-01',
  ai_processing: '2026-11-01',
  marketing: '2026-11-01',
} as const;

export type ConsentKind = keyof typeof LEGAL_VERSIONS;
export const CONSENT_KINDS = Object.keys(LEGAL_VERSIONS) as ConsentKind[];

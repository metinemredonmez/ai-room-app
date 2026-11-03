/** Store versions as `major.minor.patch` (what Expo's `version` produces). Kept dependency-free for settings. */
export const SEMVER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! < pb[i]! ? -1 : 1;
  return 0;
}

/** A malformed version from a mobile client counts as the oldest one, so the gate fails closed. */
export const clientVersion = (raw: unknown) => (typeof raw === 'string' && SEMVER_RE.test(raw) ? raw : '0.0.0');

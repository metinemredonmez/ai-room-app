import { isIP } from 'node:net';
import type { AppRequest } from '../common/http.js';

// Where a sign-in came from, in words a person recognises (API.md §7.37): "Casalume iOS 1.4.0", "Chrome · macOS".
// Only a shortened IP is kept — /24 for IPv4, /48 for IPv6 — enough to recognise a city or network, not a household
// (KVKK data minimisation).

export type ClientInfo = { device: string; ipPrefix: string };

export function ipPrefix(ip: string | undefined | null): string {
  if (!ip) return '?';
  const v = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v) === 4) return `${v.split('.').slice(0, 3).join('.')}.0/24`;
  if (isIP(v) === 6) {
    const [head] = v.split('::');
    const groups = (v.includes('::') ? head.split(':').filter(Boolean) : v.split(':')).slice(0, 3);
    while (groups.length < 3) groups.push('0');
    return `${groups.join(':')}::/48`;
  }
  return '?';
}

const header = (req: AppRequest, name: string) => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v ?? '').slice(0, 400);
};

export function deviceLabel(userAgent: string, appPlatform = '', appVersion = ''): string {
  const platform = appPlatform.toLowerCase();
  const version = /^\d{1,3}(\.\d{1,3}){0,2}$/.test(appVersion) ? ` ${appVersion}` : '';
  if (platform === 'ios') return `Casalume iOS${version}`;
  if (platform === 'android') return `Casalume Android${version}`;
  const ua = userAgent;
  if (!ua) return 'Bilinmeyen cihaz';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
    : /Casalume|okhttp|CFNetwork|Expo/i.test(ua) ? 'Casalume'
    : null;
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  const label = [browser, os].filter(Boolean).join(' · ');
  return (label || 'Bilinmeyen cihaz').slice(0, 80);
}

export function clientInfo(req: AppRequest): ClientInfo {
  return { device: deviceLabel(header(req, 'user-agent'), header(req, 'x-app-platform'), header(req, 'x-app-version')), ipPrefix: ipPrefix(req.clientIp) };
}

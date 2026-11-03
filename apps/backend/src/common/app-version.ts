import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SettingsService } from '../settings/settings.service.js';
import { AppError } from './errors.js';
import type { AppRequest } from './http.js';
import { clientVersion, compareVersions } from './semver.js';

export const APP_PLATFORMS = ['ios', 'android'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

export function platformOf(raw: unknown): AppPlatform | null {
  const p = typeof raw === 'string' ? raw.toLowerCase() : '';
  return (APP_PLATFORMS as readonly string[]).includes(p) ? (p as AppPlatform) : null;
}

const SKIP = 'skipVersionGate';
/** Routes an outdated app must still reach: health and the version check itself. */
export const SkipVersionGate = () => SetMetadata(SKIP, true);

/**
 * Force update: a mobile build older than the minimum set in admin settings gets 426 `update_required`
 * with the store link. Only requests that declare a mobile platform (X-App-Platform) are gated; web,
 * the admin panel and webhooks never send it. Builds released before this header can't be gated.
 */
@Injectable()
export class VersionGate implements CanActivate {
  constructor(private settings: SettingsService, private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const platform = platformOf(req.headers['x-app-platform']);
    if (!platform) return true;
    const rule = this.settings.current.appVersions[platform];
    if (compareVersions(clientVersion(req.headers['x-app-version']), rule.min) >= 0) return true;
    const en = (req.headers['accept-language'] ?? '').toString().toLowerCase().startsWith('en');
    throw new AppError(
      426,
      'update_required',
      en ? 'A new version of AI Room is required. Please update the app.' : 'AI Room’un yeni sürümü gerekiyor. Lütfen uygulamayı güncelle.',
      {},
      { minVersion: rule.min, storeUrl: rule.storeUrl || null },
    );
  }
}

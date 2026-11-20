import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { log } from './log.js';

/**
 * On-demand purge of the web app's tagged caches (Next "use cache", API.md §7.18): a blog article
 * goes live, is taken down, or an approved SEO text replaces the live one, and the web would keep
 * serving the cached copy for a few more minutes. One POST and the change is immediate.
 * Fire-and-forget: a failure only logs — the cache's own TTL bounds the delay, and publishing
 * must never fail because the web app is busy.
 */
@Injectable()
export class WebCacheInvalidator {
  constructor(@Inject(CONFIG) private cfg: Config) {}

  purge(...tags: string[]) {
    const secret = this.cfg.WEB_REVALIDATE_SECRET;
    if (!secret || !tags.length) return;
    const url = `${this.cfg.WEB_APP_URL}/api/revalidate`;
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(5000),
    })
      .then(async (res) => {
        if (!res.ok) log.warn('web_cache_purge_failed', { url, status: res.status, tags });
      })
      .catch((e: unknown) => log.warn('web_cache_purge_unreachable', { url, error: (e as Error).name, tags }));
  }
}

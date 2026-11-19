import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebCacheInvalidator } from './web-cache.js';
import type { Config } from '../config.js';

const cfg = (secret?: string) =>
  ({ WEB_APP_URL: 'https://web.test', WEB_REVALIDATE_SECRET: secret }) as Config;

describe('WebCacheInvalidator (API.md §7.18)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does nothing when the secret is unset (web keeps its few-minute cache)', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    new WebCacheInvalidator(cfg()).purge('blog');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the tags to the web revalidate endpoint with the shared secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    new WebCacheInvalidator(cfg('s'.repeat(40))).purge('blog', 'seo');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://web.test/api/revalidate');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-revalidate-secret']).toBe('s'.repeat(40));
    expect(JSON.parse(init.body as string)).toEqual({ tags: ['blog', 'seo'] });
  });

  it('swallows web failures (publishing never breaks because the web is busy)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    new WebCacheInvalidator(cfg('s'.repeat(40))).purge('blog');
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

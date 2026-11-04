"use client";

import { useCallback, useEffect, useState } from "react";
import type { Page } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

const BADGES_EVENT = "airoom:badges";

/** Tells the sidebar that its counters (open reports, KVKK deadlines) may have changed. */
export function notifyBadges() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BADGES_EVENT));
}

/** Subscribes to {@link notifyBadges}; returns the unsubscribe function. */
export function onBadgesChanged(cb: () => void): () => void {
  window.addEventListener(BADGES_EVENT, cb);
  return () => window.removeEventListener(BADGES_EVENT, cb);
}

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

let redirecting = false;

/** Calls the admin BFF (`/api/admin/...`), which attaches the httpOnly session to the backend call. */
export async function api<T>(
  path: string,
  opts: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; query?: Query; signal?: AbortSignal } = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(withQuery(`/api/admin${path}`, opts.query), {
      method,
      headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new ApiError(0, "network", "Ağ hatası: sunucuya ulaşılamadı.");
  }

  if (res.status === 401) {
    if (!redirecting && typeof window !== "undefined") {
      redirecting = true;
      // Outside React (no router here): a full navigation also discards any in-memory admin data.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?expired=1&next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiError(401, "unauthorized", "Oturumun süresi doldu.");
  }
  if (res.status === 204) return undefined as T;

  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    const fallback =
      res.status === 403
        ? "Bu işlem için yetkin yok."
        : res.status === 404
          ? "Kayıt bulunamadı."
          : res.status === 429
            ? "Çok fazla istek. Lütfen biraz bekle."
            : "Beklenmeyen bir hata oluştu.";
    throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? fallback);
  }
  return data as T;
}

/** Small fetch-state hook: data, error, loading, and a reload that keeps the previous data visible. */
export function useApi<T>(path: string | null, query?: Query) {
  const url = path ? withQuery(path, query) : null;
  const [tick, setTick] = useState(0);
  const fetchKey = url ? `${url}#${tick}` : null;
  const [state, setState] = useState<{ key: string | null; data: T | null; error: ApiError | null }>({
    key: null,
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!url || !fetchKey) return;
    const ctrl = new AbortController();
    api<T>(url, { signal: ctrl.signal })
      .then((data) => setState({ key: fetchKey, data, error: null }))
      .catch((e: unknown) => {
        if ((e as Error)?.name === "AbortError") return;
        const error = e instanceof ApiError ? e : new ApiError(0, "error", "Beklenmeyen bir hata oluştu.");
        setState((s) => ({ key: fetchKey, data: s.data, error }));
      });
    return () => ctrl.abort();
  }, [url, fetchKey]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((updater: (prev: T | null) => T | null) => {
    setState((s) => ({ ...s, data: updater(s.data) }));
  }, []);
  return { data: state.data, error: state.error, loading: Boolean(fetchKey) && state.key !== fetchKey, reload, setData };
}

/** Cursor-paginated list with "load more". Resets whenever the path or filters change. */
export function usePaged<T>(path: string, query: Query) {
  const url = withQuery(path, { ...query, limit: 20 });
  const [tick, setTick] = useState(0);
  const fetchKey = `${url}#${tick}`;
  const [state, setState] = useState<{
    key: string | null;
    url: string | null;
    items: T[];
    nextCursor: string | null;
    error: ApiError | null;
  }>({ key: null, url: null, items: [], nextCursor: null, error: null });
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    api<Page<T>>(url, { signal: ctrl.signal })
      .then((page) => setState({ key: fetchKey, url, items: page.items, nextCursor: page.nextCursor, error: null }))
      .catch((e: unknown) => {
        if ((e as Error)?.name === "AbortError") return;
        const error = e instanceof ApiError ? e : new ApiError(0, "error", "Beklenmeyen bir hata oluştu.");
        // A filter change must not keep showing rows from the previous filter.
        setState((s) => ({ key: fetchKey, url, items: s.url === url ? s.items : [], nextCursor: null, error }));
      });
    return () => ctrl.abort();
  }, [url, fetchKey]);

  const loadMore = useCallback(async () => {
    if (!state.nextCursor || !state.url) return;
    const [base, qs] = state.url.split("?");
    const params = new URLSearchParams(qs);
    params.set("cursor", state.nextCursor);
    setLoadingMore(true);
    try {
      const page = await api<Page<T>>(`${base}?${params.toString()}`);
      setState((s) => ({ ...s, items: [...s.items, ...page.items], nextCursor: page.nextCursor, error: null }));
    } catch (e) {
      const error = e instanceof ApiError ? e : new ApiError(0, "error", "Beklenmeyen bir hata oluştu.");
      setState((s) => ({ ...s, error }));
    } finally {
      setLoadingMore(false);
    }
  }, [state.nextCursor, state.url]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setItems = useCallback((updater: (prev: T[]) => T[]) => {
    setState((s) => ({ ...s, items: updater(s.items) }));
  }, []);
  return {
    items: state.items,
    setItems,
    nextCursor: state.nextCursor,
    loading: state.key !== fetchKey,
    loadingMore,
    error: state.error,
    loadMore,
    reload,
  };
}

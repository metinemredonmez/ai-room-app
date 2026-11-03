import { KEYS, secureStore } from '@/lib/storage';

// Contract: docs/API.md (backend /v1). Field names are camelCase.

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/v1').replace(/\/+$/, '');

export type Locale = 'tr' | 'en';
export type ToolId =
  | 'redesign'
  | 'furnish'
  | 'declutter'
  | 'replace'
  | 'paint'
  | 'flooring'
  | 'exterior'
  | 'garden'
  | 'reference'
  | 'custom';

export type User = {
  id: string;
  email: string | null;
  name: string | null;
  role: 'USER' | 'ADMIN';
  isGuest: boolean;
  plan: 'FREE' | 'PRO';
  planExpiresAt: string | null;
  credits: number;
  dailyFreeRemaining: number;
  locale: Locale;
  createdAt: string;
};

export type AuthResponse = { accessToken: string; refreshToken: string; expiresIn: number; user: User };
export type ImageRef = { id: string; url: string; width: number; height: number };

export type Design = {
  id: string;
  title: string;
  tool: ToolId;
  styleId: string | null;
  roomId: string | null;
  params: Record<string, unknown>;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  error: string | null;
  input: ImageRef;
  results: ImageRef[];
  favorite: boolean;
  featured: boolean;
  createdAt: string;
};

export type Analysis = {
  id: string;
  designId: string;
  imageId: string;
  summary: string;
  palette: string[];
  items: {
    name: string;
    category: string;
    material: string;
    color: string;
    quantity: number;
    priceMinTRY: number;
    priceMaxTRY: number;
    links: { store: string; url: string }[];
  }[];
  renovation: { task: string; unit: string; quantity: number; costMinTRY: number; costMaxTRY: number }[];
  totals: {
    furnitureMinTRY: number;
    furnitureMaxTRY: number;
    renovationMinTRY: number;
    renovationMaxTRY: number;
    grandMinTRY: number;
    grandMaxTRY: number;
  };
  disclaimer: string;
  createdAt: string;
};

export type ToolNeeds = {
  style: boolean;
  room: boolean;
  floor: boolean;
  color: boolean;
  target: boolean;
  replacement: boolean;
  instructions: boolean;
  reference: boolean;
  removeAll: boolean;
};

export type CatalogTool = {
  id: ToolId;
  name: string;
  description: string;
  icon: string;
  category: 'interior' | 'exterior' | 'edit';
  isPro: boolean;
  isNew: boolean;
  needs: ToolNeeds;
};
export type CatalogStyle = { id: string; name: string; description: string; palette: string[]; isPro: boolean };
export type Plan = { id: string; name: string; period: 'week' | 'month' | 'year'; priceTRY: number; badge: string | null };

export type Catalog = {
  tools: CatalogTool[];
  styles: CatalogStyle[];
  rooms: { id: string; name: string; icon: string }[];
  floors: { id: string; name: string }[];
  colors: { id: string; name: string; hex: string }[];
  plans: Plan[];
};

export type CreateDesign = {
  tool: ToolId;
  inputImageId: string;
  variants?: 1 | 2 | 3 | 4;
  styleId?: string;
  roomId?: string;
  floorId?: string;
  colorHex?: string;
  colorName?: string;
  target?: string;
  replacement?: string;
  instructions?: string;
  removeAll?: boolean;
  referenceImageId?: string;
};

export type Suggestion = { label: string; tool: ToolId; styleId?: string; roomId?: string; instructions?: string };
export type ChatMessage = { role: 'user' | 'assistant'; text: string; imageId?: string };
export type InspirationItem = { id: string; title: string; styleId: string; roomId: string; imageUrl: string; palette: string[] };
export type Page<T> = { items: T[]; nextCursor: string | null };
export type SampleId = 'living_room' | 'empty_room' | 'bedroom' | 'exterior' | 'garden';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------
// Token handling: single-flight refresh on 401, rotation persisted to secure storage.

let accessToken: string | null = null;
let refreshToken: string | null = null;
let locale: Locale = 'tr';
let refreshing: Promise<boolean> | null = null;
let onAuthLost: (() => Promise<void>) | null = null;

export const tokens = {
  async load() {
    accessToken = await secureStore.get(KEYS.accessToken);
    refreshToken = await secureStore.get(KEYS.refreshToken);
    return Boolean(refreshToken || accessToken);
  },
  async save(auth: Pick<AuthResponse, 'accessToken' | 'refreshToken'>) {
    accessToken = auth.accessToken;
    refreshToken = auth.refreshToken;
    await secureStore.set(KEYS.accessToken, auth.accessToken);
    await secureStore.set(KEYS.refreshToken, auth.refreshToken);
  },
  async clear() {
    accessToken = null;
    refreshToken = null;
    await secureStore.remove(KEYS.accessToken);
    await secureStore.remove(KEYS.refreshToken);
  },
  get refresh() {
    return refreshToken;
  },
};

export function setApiLocale(next: Locale) {
  locale = next;
}

/** Called when refresh fails (revoked / expired family). The session falls back to guest login. */
export function setAuthLostHandler(handler: () => Promise<void>) {
  onAuthLost = handler;
}

async function refreshOnce(): Promise<boolean> {
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept-language': locale },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        await tokens.clear();
        return false;
      }
      await tokens.save((await res.json()) as AuthResponse);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    }
  })();
  return refreshing;
}

type RequestOptions = { method?: string; body?: unknown; auth?: boolean; timeoutMs?: number };

export async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const { method = 'GET', body, auth = true, timeoutMs = 30_000 } = opts;
  const headers: Record<string, string> = { accept: 'application/json', 'accept-language': locale };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && accessToken) headers.authorization = `Bearer ${accessToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new ApiError(0, aborted ? 'timeout' : 'network', aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 && auth && !retried) {
    if (await refreshOnce()) return request<T>(path, opts, true);
    if (onAuthLost) {
      await onAuthLost();
      if (accessToken) return request<T>(path, opts, true);
    }
  }

  if (!res.ok) {
    let code = 'internal';
    let message = res.statusText;
    try {
      const payload = (await res.json()) as { error?: { code?: string; message?: string } };
      code = payload.error?.code ?? code;
      message = payload.error?.message ?? message;
    } catch {
      // non-JSON error body
    }
    const retryAfter = Number(res.headers.get('retry-after')) || undefined;
    throw new ApiError(res.status, code, message, retryAfter);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------------------------
// Endpoints

export const api = {
  guest: (deviceId: string) => request<AuthResponse>('/auth/guest', { method: 'POST', body: { deviceId }, auth: false }),
  register: (body: { email: string; password: string; name?: string }) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body }),
  login: (body: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body, auth: false }),
  logout: (token: string) => request<void>('/auth/logout', { method: 'POST', body: { refreshToken: token }, auth: false }),

  me: () => request<User>('/me'),
  updateMe: (body: { name?: string; locale?: Locale }) => request<User>('/me', { method: 'PATCH', body }),
  deleteMe: () => request<void>('/me', { method: 'DELETE' }),

  catalog: () => request<Catalog>('/catalog'),
  inspiration: () => request<{ items: InspirationItem[] }>('/inspiration'),

  upload: (data: string, mimeType: string) =>
    request<{ image: ImageRef }>('/uploads', { method: 'POST', body: { data, mimeType }, timeoutMs: 90_000 }),
  uploadSample: (sample: SampleId) => request<{ image: ImageRef }>('/uploads/sample', { method: 'POST', body: { sample } }),

  createDesign: (body: CreateDesign) => request<Design>('/designs', { method: 'POST', body, timeoutMs: 150_000 }),
  designs: (params: { cursor?: string | null; favorite?: boolean; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.cursor) q.set('cursor', params.cursor);
    if (params.favorite) q.set('favorite', 'true');
    q.set('limit', String(params.limit ?? 20));
    return request<Page<Design>>(`/designs?${q.toString()}`);
  },
  design: (id: string) => request<Design>(`/designs/${encodeURIComponent(id)}`),
  setFavorite: (id: string, favorite: boolean) =>
    request<Design>(`/designs/${encodeURIComponent(id)}`, { method: 'PATCH', body: { favorite } }),
  deleteDesign: (id: string) => request<void>(`/designs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  analyze: (id: string, imageId?: string) =>
    request<Analysis>(`/designs/${encodeURIComponent(id)}/analysis`, {
      method: 'POST',
      body: imageId ? { imageId } : {},
      timeoutMs: 120_000,
    }),

  chat: (messages: ChatMessage[]) =>
    request<{ reply: string; suggestions: Suggestion[] }>('/chat', {
      method: 'POST',
      body: { messages: messages.slice(-20) },
      timeoutMs: 120_000,
    }),

  devUpgrade: () => request<User>('/billing/dev-upgrade', { method: 'POST', body: {} }),
  health: () => request<{ status: string }>('/health', { auth: false, timeoutMs: 5_000 }),
};

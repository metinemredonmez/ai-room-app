"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api, authApi } from "@/lib/api";
import { LOCALE_COOKIE, localePath, splitLocale, type Dict, type Locale } from "@/lib/i18n";
import type { Catalog, FeatureKey, MyOrg, User } from "@/lib/types";

// ---- locale: comes from the URL (server layout); the cookie remembers it and lets the BFF send Accept-Language ----

function rememberLocale(locale: Locale) {
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax${secure}`;
}

const noopSubscribe = () => () => {};

/** True only after hydration — for UI that depends on browser-only state. */
export function useIsClient() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

// ---- app context ----

type AppState = {
  locale: Locale;
  /** Opens the current page in another language (and remembers the choice). */
  setLocale: (l: Locale) => void;
  /** In-app path in the current language: href("/studio") → "/en/studio". */
  href: (path: string) => string;
  t: Dict;
  user: User | null;
  userReady: boolean;
  refreshUser: () => Promise<User | null>;
  ensureSession: () => Promise<User | null>;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
  catalog: Catalog | null;
  catalogError: ApiError | null;
  reloadCatalog: () => void;
  /** API.md §7.23: the firms I belong to (registered accounts only) and the workspace I'm working in. */
  orgs: MyOrg[];
  /** The selected firm, or null for the personal workspace. */
  activeOrg: MyOrg | null;
  setWorkspace: (orgId: string | null) => void;
  refreshOrgs: () => Promise<void>;
};

const WORKSPACE_KEY = "casalume.workspace";
function readWorkspace(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}
function writeWorkspace(orgId: string | null) {
  try {
    if (orgId) localStorage.setItem(WORKSPACE_KEY, orgId);
    else localStorage.removeItem(WORKSPACE_KEY);
  } catch {
    /* storage off: the choice lasts for this page only */
  }
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children, locale, messages }: { children: React.ReactNode; locale: Locale; messages: Dict }) {
  const t = messages;
  const router = useRouter();

  useEffect(() => {
    rememberLocale(locale);
  }, [locale]);

  const href = useCallback((path: string) => localePath(locale, path), [locale]);
  const setLocale = useCallback(
    (next: Locale) => {
      rememberLocale(next);
      // Read at click time: usePathname() here would make every page wait for the URL (no prerendering).
      router.push(localePath(next, splitLocale(window.location.pathname).path) + window.location.search);
    },
    [router],
  );

  const [user, setUser] = useState<User | null>(null);
  const [userReady, setUserReady] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<ApiError | null>(null);
  const [catalogNonce, setCatalogNonce] = useState(0);
  const [orgs, setOrgs] = useState<MyOrg[]>([]);
  const [workspace, setWorkspaceState] = useState<string | null>(null);

  const refreshOrgs = useCallback(async () => {
    try {
      setOrgs(await api.get<MyOrg[]>("/me/orgs"));
    } catch {
      setOrgs([]);
    }
  }, []);
  const setWorkspace = useCallback((orgId: string | null) => {
    setWorkspaceState(orgId);
    writeWorkspace(orgId);
  }, []);

  // Firms are loaded for registered accounts; the remembered workspace is kept only while it is still one of them.
  const registeredId = user && !user.isGuest ? user.id : null;
  useEffect(() => {
    if (!registeredId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrgs([]);
      return;
    }
    void refreshOrgs();
  }, [registeredId, refreshOrgs]);
  useEffect(() => {
    const saved = readWorkspace();
    const valid = saved && orgs.some((o) => o.id === saved && o.status === "ACTIVE") ? saved : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorkspaceState(valid);
  }, [orgs]);
  const activeOrg = useMemo(() => orgs.find((o) => o.id === workspace) ?? null, [orgs, workspace]);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.get<User>("/me");
      setUser(me);
      return me;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setUser(null);
      return null;
    } finally {
      setUserReady(true);
    }
  }, []);

  const ensureSession = useCallback(async () => {
    if (user) return user;
    const me = await refreshUser();
    if (me) return me;
    const { user: guest } = await authApi.guest();
    setUser(guest);
    return guest;
  }, [user, refreshUser]);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setUser(null);
    writeWorkspace(null);
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .get<User>("/me")
      .then((me) => {
        if (alive) setUser(me);
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        if (alive) setUserReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .get<Catalog>(`/catalog?locale=${locale}`)
      .then((c) => {
        if (!alive) return;
        setCatalog(c);
        setCatalogError(null);
      })
      .catch((e: unknown) => {
        if (alive) setCatalogError(e instanceof ApiError ? e : new ApiError(0, "network", "network"));
      });
    return () => {
      alive = false;
    };
  }, [locale, catalogNonce]);

  const value = useMemo<AppState>(
    () => ({
      locale,
      setLocale,
      href,
      t,
      user,
      userReady,
      refreshUser,
      ensureSession,
      setUser,
      logout,
      catalog,
      catalogError,
      reloadCatalog: () => setCatalogNonce((n) => n + 1),
      orgs,
      activeOrg,
      setWorkspace,
      refreshOrgs,
    }),
    [locale, setLocale, href, t, user, userReady, refreshUser, ensureSession, logout, catalog, catalogError, orgs, activeOrg, setWorkspace, refreshOrgs],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

const noSubscribe = () => () => {};

/**
 * Feature flags (API.md §7.28). While a component hydrates it renders what the server rendered (everything on), so a
 * catalog that arrived first can never cause a hydration mismatch; afterwards a flag the catalog does not confirm is
 * off, and an unreadable catalog means off.
 */
export function useFeature(): (key: FeatureKey) => boolean {
  const { catalog, catalogError } = useApp();
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  return (key) => (!hydrated ? true : catalog ? catalog.features?.[key] === true : !catalogError);
}

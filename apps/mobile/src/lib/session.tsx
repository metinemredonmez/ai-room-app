import * as Crypto from 'expo-crypto';
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  api,
  ApiError,
  setApiLocale,
  setAuthLostHandler,
  tokens,
  type AuthResponse,
  type Catalog,
  type Locale,
  type User,
} from '@/lib/api';
import { translate, type MessageKey } from '@/lib/i18n';
import { disablePush, syncPush } from '@/lib/push';
import { KEYS, prefs } from '@/lib/storage';

type Status = 'booting' | 'ready' | 'offline';

type SessionValue = {
  status: Status;
  user: User | null;
  catalog: Catalog | null;
  locale: Locale;
  onboardingDone: boolean;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  errorMessage: (e: unknown) => string;
  setLocale: (locale: Locale) => Promise<void>;
  setUser: (user: User) => void;
  refreshUser: () => Promise<void>;
  signIn: (auth: AuthResponse) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  retryBoot: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

async function getDeviceId(): Promise<string> {
  const existing = await prefs.get(KEYS.deviceId);
  if (existing && /^[A-Za-z0-9-]{16,64}$/.test(existing)) return existing;
  const id = Crypto.randomUUID();
  await prefs.set(KEYS.deviceId, id);
  return id;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('booting');
  const [user, setUser] = useState<User | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [locale, setLocaleState] = useState<Locale>('tr');
  const [onboardingDone, setOnboardingDone] = useState(true);
  const [bootKey, setBootKey] = useState(0);

  const loginAsGuest = useCallback(async () => {
    const auth = await api.guest(await getDeviceId());
    await tokens.save(auth);
    setUser(auth.user);
  }, []);

  useEffect(() => {
    setAuthLostHandler(async () => {
      try {
        await loginAsGuest();
      } catch {
        // stays signed out; the next request surfaces the error
      }
    });
  }, [loginAsGuest]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('booting');
      const storedLocale = (await prefs.get(KEYS.locale)) as Locale | null;
      const nextLocale: Locale = storedLocale === 'en' ? 'en' : 'tr';
      setLocaleState(nextLocale);
      setApiLocale(nextLocale);
      setOnboardingDone((await prefs.get(KEYS.onboardingDone)) === '1');
      try {
        const hasSession = await tokens.load();
        if (hasSession) {
          try {
            const me = await api.me();
            if (!cancelled) setUser(me);
          } catch (e) {
            if (e instanceof ApiError && e.status === 0) throw e;
            await loginAsGuest();
          }
        } else {
          await loginAsGuest();
        }
        const cat = await api.catalog();
        if (!cancelled) {
          setCatalog(cat);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) setStatus('offline');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootKey, loginAsGuest]);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );

  const errorMessage = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError) {
        const key = `error.${e.code}` as MessageKey;
        const known = translate(locale, key, { s: e.retryAfter ?? 30 });
        if (known !== key) return known;
        return e.message || translate(locale, 'error.internal');
      }
      return translate(locale, 'error.internal');
    },
    [locale],
  );

  const setLocale = useCallback(async (next: Locale) => {
    setLocaleState(next);
    setApiLocale(next);
    await prefs.set(KEYS.locale, next);
    try {
      setUser(await api.updateMe({ locale: next }));
      setCatalog(await api.catalog());
    } catch {
      // offline: the UI language still switches locally
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      // keep the last known user
    }
  }, []);

  const signIn = useCallback(async (auth: AuthResponse) => {
    await tokens.save(auth);
    setUser(auth.user);
  }, []);

  // Every account change (boot, sign-in, guest fallback) re-binds this device's push token to it.
  useEffect(() => {
    if (user?.id) void syncPush();
  }, [user?.id]);

  const signOut = useCallback(async () => {
    await disablePush();
    const refresh = tokens.refresh;
    if (refresh) await api.logout(refresh).catch(() => undefined);
    await tokens.clear();
    await loginAsGuest();
  }, [loginAsGuest]);

  const deleteAccount = useCallback(async () => {
    await api.deleteMe();
    await prefs.remove(KEYS.pushToken); // the server rows went with the account
    await tokens.clear();
    await loginAsGuest();
  }, [loginAsGuest]);

  const completeOnboarding = useCallback(async () => {
    await prefs.set(KEYS.onboardingDone, '1');
    setOnboardingDone(true);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      catalog,
      locale,
      onboardingDone,
      t,
      errorMessage,
      setLocale,
      setUser,
      refreshUser,
      signIn,
      signOut,
      deleteAccount,
      completeOnboarding,
      retryBoot: () => setBootKey((k) => k + 1),
    }),
    [status, user, catalog, locale, onboardingDone, t, errorMessage, setLocale, refreshUser, signIn, signOut, deleteAccount, completeOnboarding],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionValue {
  const ctx = use(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

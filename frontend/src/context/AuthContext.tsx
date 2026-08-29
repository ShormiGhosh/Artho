import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, setUnauthorizedHandler, tokenStore } from '../lib/api';
import type { Me } from '../types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    full_name: string;
    phone: string;
    role?: 'USER' | 'INSTITUTION';
    nid?: string;
  }) => Promise<{ dev_code?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // No short-circuit on a missing access token: a valid httpOnly refresh
      // cookie alone (e.g. after the 15-minute access token expired, or a
      // brand-new tab) is enough — the api.ts interceptor silently refreshes
      // on the first 401 and retries this call.
      const { data } = await api.get('/wallet');
      setMe(data.data as Me);
    } catch {
      setMe(null);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    tokenStore.clear();
    setMe(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenStore.clear();
      setMe(null);
    });
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post('/auth/login', { email, password });
      tokenStore.set(data.data.token);
      await refresh();
    },
    [refresh]
  );

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      full_name: string;
      phone: string;
      role?: 'USER' | 'INSTITUTION';
      nid?: string;
    }) => {
      const { data } = await api.post('/auth/register', input);
      tokenStore.set(data.data.token);
      await refresh();
      // Dev-mode convenience only (no SMTP configured) — see backend
      // exposeDevVerificationCode(). Never present in production.
      return { dev_code: data.data.verification?.dev_code as string | undefined };
    },
    [refresh]
  );

  const value = useMemo(
    () => ({ me, loading, login, register, logout, refresh }),
    [me, loading, login, register, logout, refresh]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

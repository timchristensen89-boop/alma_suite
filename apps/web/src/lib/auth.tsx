import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser } from '@alma/shared';
import { ApiError, api, clearApiAuthToken, consumeSuiteHandoffToken, installSuiteHandoff, setApiAuthToken } from './api';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const handoffUser = await consumeSuiteHandoffToken();
      if (handoffUser) {
        setUser(handoffUser);
        return;
      }
      const data = await api<{ user: AuthUser | null }>('/api/auth/me');
      setUser(data.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      } else {
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => installSuiteHandoff(), []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const data = await api<{ user: AuthUser; token?: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setApiAuthToken(data.token);
      setUser(data.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      clearApiAuthToken();
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, error, login, logout, refresh }),
    [user, loading, error, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

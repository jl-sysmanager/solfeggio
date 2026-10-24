import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  get,
  post,
  refreshAccessToken,
  setAccessToken,
  setImpersonationLostHandler,
  setRefreshDisabled,
  setSessionExpiredHandler,
} from '../api/client';
import type { Membership, Session } from '../api/types';
import type { ImpersonationInfo } from '../api/types-admin-insights';

interface LoginResult {
  accessToken: string;
  user: Session['user'];
  memberships: Membership[];
}
interface TokenSession {
  accessToken: string;
  session: Session;
}

interface AuthContextValue {
  session: Session | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login(email: string, password: string, mfaCode?: string): Promise<LoginResult>;
  logout(): Promise<void>;
  switchTenant(tenantId: string): Promise<Session>;
  applyTokenSession(result: TokenSession): void;
  /** Sesión «ver como» activa (sólo lectura), o null. */
  impersonation: ImpersonationInfo | null;
  startImpersonation(accessToken: string): Promise<void>;
  endImpersonation(): Promise<void>;
  reload(): Promise<void>;
  can(permission: string | string[]): boolean;
  hasFeature(feature: string): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, initialSession }: { children: ReactNode; initialSession?: Session | null }) {
  const [session, setSession] = useState<Session | null>(initialSession ?? null);
  const [status, setStatus] = useState<AuthContextValue['status']>(
    initialSession !== undefined ? (initialSession ? 'authenticated' : 'anonymous') : 'loading',
  );
  const queryClient = useQueryClient();
  // Sesión del administrador guardada mientras dura «ver como», para restaurarla al salir.
  const adminSession = useRef<Session | null>(null);
  const impersonation = (session as (Session & { impersonation?: ImpersonationInfo }) | null)?.impersonation ?? null;

  const reload = useCallback(async () => {
    try {
      const me = await get<Session>('/auth/me');
      setSession(me);
      setStatus('authenticated');
    } catch {
      setSession(null);
      setStatus('anonymous');
    }
  }, []);

  // Restaurar sesión desde la cookie de refresh al cargar la app.
  useEffect(() => {
    if (initialSession !== undefined) return;
    let cancelled = false;
    (async () => {
      const token = await refreshAccessToken();
      if (cancelled) return;
      if (token) await reload();
      else setStatus('anonymous');
    })();
    return () => {
      cancelled = true;
    };
  }, [initialSession, reload]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAccessToken(null);
      setSession(null);
      setStatus('anonymous');
      queryClient.clear();
    });
    return () => setSessionExpiredHandler(null);
  }, [queryClient]);

  const login = useCallback(
    async (email: string, password: string, mfaCode?: string) => {
      const res = await api<LoginResult>('/auth/login', {
        method: 'POST',
        body: { email, password, ...(mfaCode ? { mfaCode } : {}) },
        noRefresh: true,
      });
      setAccessToken(res.accessToken);
      await reload();
      return res;
    },
    [reload],
  );

  const applyTokenSession = useCallback(
    (result: TokenSession) => {
      setAccessToken(result.accessToken);
      setSession(result.session);
      setStatus('authenticated');
      queryClient.clear();
    },
    [queryClient],
  );

  const switchTenant = useCallback(
    async (tenantId: string) => {
      const res = await post<TokenSession>('/auth/switch-tenant', { tenantId });
      applyTokenSession(res);
      return res.session;
    },
    [applyTokenSession],
  );

  const endImpersonation = useCallback(async () => {
    if (!adminSession.current) return;
    const saved = adminSession.current;
    adminSession.current = null;
    try {
      await api('/impersonation/end', { method: 'POST', body: {}, noRefresh: true });
    } catch {
      /* ya caducada o terminada: se restaura igualmente */
    }
    setRefreshDisabled(false);
    setAccessToken(null);
    queryClient.clear();
    const token = await refreshAccessToken();
    if (token) {
      setSession(saved);
      setStatus('authenticated');
    } else {
      setSession(null);
      setStatus('anonymous');
    }
  }, [queryClient]);

  const startImpersonation = useCallback(
    async (accessToken: string) => {
      if (!adminSession.current) adminSession.current = session;
      setRefreshDisabled(true);
      setAccessToken(accessToken);
      try {
        const me = await get<Session>('/auth/me');
        queryClient.clear();
        setSession(me);
        setStatus('authenticated');
      } catch (e) {
        adminSession.current = null;
        setRefreshDisabled(false);
        await refreshAccessToken();
        throw e;
      }
    },
    [queryClient, session],
  );

  // Un 401 durante «ver como» (sesión terminada o caducada) devuelve al administrador a su cuenta.
  useEffect(() => {
    setImpersonationLostHandler(() => void endImpersonation());
    return () => setImpersonationLostHandler(null);
  }, [endImpersonation]);

  const logout = useCallback(async () => {
    try {
      if (adminSession.current) {
        adminSession.current = null;
        await api('/impersonation/end', { method: 'POST', body: {}, noRefresh: true }).catch(() => undefined);
        setRefreshDisabled(false);
      }
      await api('/auth/logout', { method: 'POST', body: {}, noRefresh: true });
    } finally {
      try {
        for (const key of Object.keys(sessionStorage)) {
          if (key.startsWith('sf-setup:')) sessionStorage.removeItem(key);
        }
      } catch {
        /* almacenamiento no disponible */
      }
      setAccessToken(null);
      setSession(null);
      setStatus('anonymous');
      queryClient.clear();
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      status,
      login,
      logout,
      switchTenant,
      applyTokenSession,
      impersonation,
      startImpersonation,
      endImpersonation,
      reload,
      can: (perm) => {
        if (!session) return false;
        const perms = Array.isArray(perm) ? perm : [perm];
        return perms.some((p) => session.permissions.includes(p));
      },
      hasFeature: (feature) => !!session?.plan?.features.includes(feature),
    }),
    [session, status, login, logout, switchTenant, applyTokenSession, impersonation, startImpersonation, endImpersonation, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}

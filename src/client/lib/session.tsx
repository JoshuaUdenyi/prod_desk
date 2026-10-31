/**
 * Session state for the whole app.
 *
 * The cookie is HttpOnly and the Worker owns it, so the client never stores a
 * token — it asks `/auth/me` once on boot and keeps the answer in memory.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionUser } from '@shared/types';
import { api, ApiError, type LoginInput, type SetupInput } from './api';

interface SessionValue {
  user: SessionUser | null;
  loading: boolean;
  needsSetup: boolean;
  login: (input: LoginInput) => Promise<void>;
  setup: (input: SetupInput) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const status = await api.auth.status();
        if (cancelled) return;

        if (status.needsSetup) {
          setNeedsSetup(true);
          return;
        }

        try {
          const { user: me } = await api.auth.me();
          if (!cancelled) setUser(me);
        } catch (error) {
          // A 401 here just means "not signed in yet", which is not an error.
          if (!(error instanceof ApiError) || error.status !== 401) throw error;
        }
      } catch {
        // Offline or the Worker is down: render the signed-out shell rather than
        // trapping the user on a blank screen.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const { user: signedIn } = await api.auth.login(input);
    setUser(signedIn);
  }, []);

  const setup = useCallback(async (input: SetupInput) => {
    const { user: owner } = await api.auth.setup(input);
    setNeedsSetup(false);
    setUser(owner);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ user, loading, needsSetup, login, setup, logout }),
    [user, loading, needsSetup, login, setup, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}

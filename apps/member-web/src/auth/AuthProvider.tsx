import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApiClient } from '@ipoint/api-client';
import type { AuthContextValue, User } from './AuthContext';

export const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  apiClient: ApiClient;
  /** If true, the provider will attempt to restore the session on mount. */
  autoRestore?: boolean;
}

export function AuthProvider({
  children,
  apiClient,
  autoRestore = true,
}: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(autoRestore);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const restoreAttemptedRef = useRef(false);

  // Attempt to restore session by calling the refresh endpoint on page load
  useEffect(() => {
    if (!autoRestore || restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;

    let cancelled = false;
    const restore = async () => {
      try {
        const restored = await apiClient.attemptSessionRestore();
        if (cancelled) return;
        if (restored) {
          // Fetch user profile after successful refresh
          await loadUser();
        }
      } catch {
        // Ignore — still in loading state cleared below
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [autoRestore, apiClient]);

  // Listen for session-expired events from the API client
  useEffect(() => {
    const handleExpired = () => {
      setUser(null);
      setError(null);
      setIsLoading(false);
    };

    window.addEventListener('ipoint:session-expired', handleExpired);
    return () => {
      window.removeEventListener('ipoint:session-expired', handleExpired);
    };
  }, []);

  const loadUser = useCallback(async () => {
    try {
      const response = await apiClient.get<User>('/members/me');
      setUser(response.data);
      setError(null);
    } catch {
      setUser(null);
      throw new Error('Failed to load user profile');
    }
  }, [apiClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      setIsLoading(true);
      try {
        await apiClient.login(email, password);
        await loadUser();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Login failed';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [apiClient, loadUser],
  );

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout', undefined, { skipAuth: true });
    } catch {
      // Even if the server call fails, clear local state
    }
    apiClient.clearSession();
    setUser(null);
    setError(null);
    void navigate('/login');
  }, [apiClient, navigate]);

  const refresh = useCallback(async () => {
    try {
      const restored = await apiClient.attemptSessionRestore();
      if (restored) {
        await loadUser();
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, [apiClient, loadUser]);

  const clearError = useCallback(() => setError(null), []);

  // Wire up onSessionExpired to clear local state
  useEffect(() => {
    apiClient.onSessionExpired = () => {
      setUser(null);
      setError(null);
      navigate('/login');
    };
    return () => {
      apiClient.onSessionExpired = null;
    };
  }, [apiClient, navigate]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      error,
      login,
      logout,
      refresh,
      clearError,
    }),
    [user, isLoading, error, login, logout, refresh, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

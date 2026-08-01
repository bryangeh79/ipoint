import {
  ApiError,
  type AdminBootstrapDto,
  type AdminLoginChallengeDto,
  type AdminMarketListDto,
  type CurrentAdminSessionDto,
} from '@ipoint/api-client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { adminApi } from './admin-api.js';

const marketHintKey = 'ipoint.admin.market-hint';

export interface PendingMfaChallenge {
  id: string;
  expiresAt: string;
  returnTo?: string;
}

interface AdminSessionContextValue {
  status: 'anonymous' | 'loading' | 'authenticated';
  bootstrap?: AdminBootstrapDto;
  markets?: AdminMarketListDto;
  currentSession?: CurrentAdminSessionDto;
  pendingChallenge?: PendingMfaChallenge;
  terminalCode?: string;
  beginLogin: (
    email: string,
    password: string,
    returnTo?: string,
  ) => Promise<AdminLoginChallengeDto>;
  completeMfa: (code: string) => Promise<AdminBootstrapDto>;
  recoverMfa: (recoveryCode: string) => Promise<AdminBootstrapDto>;
  selectMarket: (marketId: string) => Promise<void>;
  refresh: () => Promise<void>;
  clear: (terminalCode?: string) => void;
}

const AdminSessionContext = createContext<AdminSessionContextValue | null>(
  null,
);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminSessionContextValue['status']>(
    adminApi.isAuthenticated ? 'loading' : 'anonymous',
  );
  const [bootstrap, setBootstrap] = useState<AdminBootstrapDto>();
  const [markets, setMarkets] = useState<AdminMarketListDto>();
  const [currentSession, setCurrentSession] =
    useState<CurrentAdminSessionDto>();
  const [pendingChallenge, setPendingChallenge] =
    useState<PendingMfaChallenge>();
  const [terminalCode, setTerminalCode] = useState<string>();

  const resetState = useCallback((code?: string) => {
    setStatus('anonymous');
    setBootstrap(undefined);
    setMarkets(undefined);
    setCurrentSession(undefined);
    setPendingChallenge(undefined);
    setTerminalCode(code);
  }, []);

  const clear = useCallback(
    (code?: string) => {
      adminApi.clearSession();
      resetState(code);
    },
    [resetState],
  );

  const loadServerContext =
    useCallback(async (): Promise<AdminBootstrapDto> => {
      setStatus('loading');
      const [nextBootstrap, nextMarkets, nextSession] = await Promise.all([
        adminApi.bootstrap(),
        adminApi.markets(),
        adminApi.currentSession(),
      ]);
      const hint = readMarketHint();
      const hintIsAuthorized = hint
        ? nextMarkets.items.some((market) => market.id === hint)
        : false;

      if (hint && !hintIsAuthorized) clearMarketHint();

      if (!nextMarkets.currentMarketId && hint && hintIsAuthorized) {
        await adminApi.selectCurrentMarket({
          market_id: hint,
          expected_context_version: nextMarkets.contextVersion,
        });
        const [revalidatedBootstrap, revalidatedMarkets] = await Promise.all([
          adminApi.bootstrap(),
          adminApi.markets(),
        ]);
        persistCurrentMarket(revalidatedMarkets.currentMarketId);
        setBootstrap(revalidatedBootstrap);
        setMarkets(revalidatedMarkets);
        setCurrentSession(nextSession);
        setStatus('authenticated');
        setTerminalCode(undefined);
        return revalidatedBootstrap;
      }

      persistCurrentMarket(nextMarkets.currentMarketId);
      setBootstrap(nextBootstrap);
      setMarkets(nextMarkets);
      setCurrentSession(nextSession);
      setStatus('authenticated');
      setTerminalCode(undefined);
      return nextBootstrap;
    }, []);

  useEffect(() => {
    adminApi.onSessionExpired = () => resetState('SESSION_REVOKED');
    if (adminApi.isAuthenticated)
      void loadServerContext().catch(handleLoadError);
    return () => {
      adminApi.onSessionExpired = null;
    };

    function handleLoadError(error: unknown) {
      clear(error instanceof ApiError ? error.body.code : undefined);
    }
  }, [clear, loadServerContext, resetState]);

  const value = useMemo<AdminSessionContextValue>(
    () => ({
      status,
      bootstrap,
      markets,
      currentSession,
      pendingChallenge,
      terminalCode,
      async beginLogin(email, password, returnTo) {
        setTerminalCode(undefined);
        const challenge = await adminApi.beginLogin({ email, password });
        setPendingChallenge({
          id: challenge.mfa_challenge_id,
          expiresAt: challenge.expires_at,
          ...(returnTo ? { returnTo } : {}),
        });
        return challenge;
      },
      async completeMfa(code) {
        if (!pendingChallenge) throw new Error('MFA challenge is unavailable.');
        await adminApi.completeMfaChallenge({
          challenge_id: pendingChallenge.id,
          code,
        });
        setPendingChallenge(undefined);
        return loadServerContext();
      },
      async recoverMfa(recoveryCode) {
        if (!pendingChallenge) throw new Error('MFA challenge is unavailable.');
        await adminApi.recoverWithMfa({
          challenge_id: pendingChallenge.id,
          recovery_code: recoveryCode,
        });
        setPendingChallenge(undefined);
        return loadServerContext();
      },
      async selectMarket(marketId) {
        if (!markets) throw new Error('Market context is unavailable.');
        try {
          await adminApi.selectCurrentMarket({
            market_id: marketId,
            expected_context_version: markets.contextVersion,
          });
          window.localStorage.setItem(marketHintKey, marketId);
          await loadServerContext();
        } catch (error) {
          if (
            error instanceof ApiError &&
            ['MARKET_ACCESS_DENIED', 'MARKET_CONTEXT_MISMATCH'].includes(
              error.body.code ?? '',
            )
          ) {
            clearMarketHint();
          }
          throw error;
        }
      },
      async refresh() {
        await loadServerContext();
      },
      clear,
    }),
    [
      bootstrap,
      clear,
      currentSession,
      loadServerContext,
      markets,
      pendingChallenge,
      status,
      terminalCode,
    ],
  );

  return (
    <AdminSessionContext.Provider value={value}>
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession(): AdminSessionContextValue {
  const value = useContext(AdminSessionContext);
  if (!value) throw new Error('AdminSessionProvider is required.');
  return value;
}

function readMarketHint(): string | undefined {
  const value = window.localStorage.getItem(marketHintKey)?.trim();
  return value || undefined;
}

function clearMarketHint(): void {
  window.localStorage.removeItem(marketHintKey);
}

function persistCurrentMarket(marketId: string | null): void {
  if (marketId) window.localStorage.setItem(marketHintKey, marketId);
  else clearMarketHint();
}

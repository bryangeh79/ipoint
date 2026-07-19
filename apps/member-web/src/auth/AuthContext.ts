/**
 * Auth context types — exported separately for type-only imports.
 */

export interface User {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  countryCode?: string;
  kycStatus?: 'not_started' | 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface AuthActions {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

export type AuthContextValue = AuthState & AuthActions;

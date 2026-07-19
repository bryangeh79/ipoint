import { useContext } from 'react';
import { AuthContext } from './AuthProvider.tsx';
import type { AuthContextValue } from './AuthContext.ts';

/**
 * Hook to access auth state and actions.
 * Must be used within an AuthProvider.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

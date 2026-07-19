import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth.ts';
import { Spinner } from '@ipoint/ui';
import { validateReturnUrl } from '../utils/url.ts';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** If true, redirects authenticated users away (for login/register pages) */
  requireGuest?: boolean;
}

/**
 * Route guard that checks authentication state.
 * - If loading, shows a spinner.
 * - If unauthenticated and requires auth, redirects to /login with returnUrl.
 * - If authenticated and requireGuest is true, redirects to home.
 */
export function ProtectedRoute({
  children,
  requireGuest = false,
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100dvh',
        }}
      >
        <Spinner size="lg" label="Loading" />
      </div>
    );
  }

  // Guest-only pages (login, register) — redirect to home if already logged in
  if (requireGuest && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  // Protected pages — redirect to login if not authenticated
  if (!requireGuest && !isAuthenticated) {
    const rawReturnUrl = location.pathname + location.search;
    const validatedReturnUrl = validateReturnUrl(rawReturnUrl);
    const redirectTo = validatedReturnUrl
      ? `/login?returnUrl=${encodeURIComponent(validatedReturnUrl)}`
      : '/login';
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}

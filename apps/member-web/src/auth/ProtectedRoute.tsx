import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { Spinner } from '@ipoint/ui';
import { validateReturnUrl } from '../utils/url';

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
  const navigate = useNavigate();

  // Guest-only pages — redirect to home via effect to avoid concurrent render
  useEffect(() => {
    if (!isLoading && requireGuest && isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isLoading, requireGuest, isAuthenticated, navigate]);

  // Protected pages — redirect to login via effect
  useEffect(() => {
    if (!isLoading && !requireGuest && !isAuthenticated) {
      const rawReturnUrl = location.pathname + location.search;
      const validatedReturnUrl = validateReturnUrl(rawReturnUrl);
      const redirectTo = validatedReturnUrl
        ? `/login?returnUrl=${encodeURIComponent(validatedReturnUrl)}`
        : '/login';
      navigate(redirectTo, { replace: true });
    }
  }, [isLoading, requireGuest, isAuthenticated, location, navigate]);

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

  // While redirecting (via effect), render nothing to avoid content flash
  if (
    (requireGuest && isAuthenticated) ||
    (!requireGuest && !isAuthenticated)
  ) {
    return null;
  }

  return <>{children}</>;
}

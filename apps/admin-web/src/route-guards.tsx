import { Button } from '@ipoint/ui';
import type { ReactNode } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAdminSession } from './admin-session.js';
import type { AdminRoute } from './route-manifest.js';
import { MarketSelector } from './auth-screens.js';
import { ShellState } from './shell-states.js';

const publicRouteIds = new Set([
  'login',
  'mfa-enroll',
  'mfa-challenge',
  'mfa-recovery',
]);

export function ProtectedAdminRoute({
  route,
  children,
}: {
  route: AdminRoute;
  children: ReactNode;
}) {
  const session = useAdminSession();
  const location = useLocation();
  const parameters = useParams();

  if (publicRouteIds.has(route.id)) return children;
  if (session.status === 'loading') return <ShellState kind="loading" />;
  if (session.status === 'anonymous') {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        replace
        to={`/admin/login?returnTo=${encodeURIComponent(returnTo)}`}
      />
    );
  }
  if (!session.bootstrap || !session.currentSession) {
    return (
      <ShellState
        kind="retry"
        action={
          <Button onClick={() => void session.refresh()}>
            Retry bootstrap
          </Button>
        }
      />
    );
  }
  if (session.bootstrap.actor.status === 'SUSPENDED') {
    return <ShellState kind="suspended" />;
  }
  if (session.currentSession.mfa_recovery_used && route.id !== 'settings') {
    return (
      <ShellState
        kind="disabled"
        title="MFA re-enrollment required"
        description="This recovery session cannot open operational routes until a new factor is enrolled."
        action={
          <Button onClick={() => window.location.assign('/admin/mfa/enroll')}>
            Enroll MFA
          </Button>
        }
      />
    );
  }
  if (
    route.permission &&
    !hasEffectivePermission(
      session.bootstrap.effectivePermissions,
      route.permission,
    )
  ) {
    return (
      <ShellState
        kind="permission-denied"
        description={`The server did not grant ${route.permission}. Navigation visibility is not authorization.`}
      />
    );
  }
  if (route.market !== 'none') {
    if (!session.bootstrap.currentMarket) {
      return (
        <ShellState
          kind="disabled"
          title="Select an authorized market"
          description="This route requires a server-bound Current Admin Market."
          action={<MarketSelector />}
        />
      );
    }
    if (parameters.marketId !== session.bootstrap.currentMarket.id) {
      return (
        <ShellState
          kind="conflict"
          title="Selected market changed"
          description="The URL market does not match the server-bound Current Admin Market. No automatic switch was made."
          action={<MarketSelector />}
        />
      );
    }
  }
  if (route.capabilityGate) {
    return (
      <ShellState
        kind="blocked-prerequisite"
        description={`${route.capabilityGate.capability} is unavailable. No command control or fallback endpoint is rendered.`}
        blockedPrerequisite={route.capabilityGate.blockedPrerequisite}
      />
    );
  }
  return children;
}

export function hasEffectivePermission(
  effectivePermissions: ReadonlyArray<string>,
  requiredPermission: string,
): boolean {
  return effectivePermissions.includes(requiredPermission);
}

export function isPublicAdminRoute(route: AdminRoute): boolean {
  return publicRouteIds.has(route.id);
}

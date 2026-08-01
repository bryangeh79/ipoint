import { AppShell, Badge, EmptyState, PageHeader, TopBar } from '@ipoint/ui';
import {
  Link,
  Navigate,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  matchPath,
  useLocation,
  useRouteError,
  type RouteObject,
} from 'react-router-dom';
import { AdminSessionProvider, useAdminSession } from './admin-session.js';
import {
  LoginScreen,
  MarketSelector,
  MfaChallengeScreen,
  MfaEnrollmentScreen,
  MfaRecoveryScreen,
  SessionsScreen,
} from './auth-screens.js';
import {
  ProtectedAdminRoute,
  hasEffectivePermission,
  isPublicAdminRoute,
} from './route-guards.js';
import {
  adminRouteManifest,
  navigationGroups,
  routePath,
  type AdminRoute,
} from './route-manifest.js';
import { ApiErrorState, ShellState } from './shell-states.js';

const routeObjects: RouteObject[] = [
  { path: '/', element: <Navigate replace to="/admin/login" /> },
  {
    element: <AdminShell />,
    children: adminRouteManifest.map((definition) => ({
      id: definition.id,
      path: definition.path,
      element: <RoutePlaceholder route={definition} />,
      loader: () => ({ routeId: definition.id, loader: definition.loader }),
      errorElement: <RouteErrorBoundary />,
    })),
  },
  { path: '*', element: <NotFound /> },
];

export function createAdminRouter() {
  return createBrowserRouter(routeObjects);
}

export function AdminApp() {
  return (
    <AdminSessionProvider>
      <RouterProvider router={createAdminRouter()} />
    </AdminSessionProvider>
  );
}

function AdminShell() {
  const location = useLocation();
  const session = useAdminSession();
  const publicRoute =
    location.pathname.startsWith('/admin/login') ||
    location.pathname.startsWith('/admin/mfa/');

  return (
    <AppShell
      className={`admin-app${publicRoute ? ' admin-app--public' : ''}`}
      topBar={
        <TopBar
          brand={<Wordmark />}
          actions={
            publicRoute ? (
              <Badge tone="warning">Protected</Badge>
            ) : (
              <div className="admin-topbar-context">
                <MarketSelector compact />
                <Badge
                  tone={
                    session.status === 'authenticated' ? 'success' : 'warning'
                  }
                >
                  {session.bootstrap?.actor.displayName ?? 'Authenticating'}
                </Badge>
              </div>
            )
          }
        />
      }
      sideNavigation={publicRoute ? undefined : <AdminNavigation />}
    >
      <Outlet />
    </AppShell>
  );
}

function RoutePlaceholder({ route }: { route: AdminRoute }) {
  return (
    <ProtectedAdminRoute route={route}>
      <RouteContent route={route} />
    </ProtectedAdminRoute>
  );
}

function RouteContent({ route }: { route: AdminRoute }) {
  const session = useAdminSession();
  if (route.id === 'login') {
    if (session.status === 'authenticated') {
      const target = session.bootstrap?.currentMarket?.id
        ? routePath('dashboard', {
            marketId: session.bootstrap.currentMarket.id,
          })
        : '/admin/settings';
      return <Navigate replace to={target} />;
    }
    return <LoginScreen />;
  }
  if (route.id === 'mfa-enroll') return <MfaEnrollmentScreen />;
  if (route.id === 'mfa-challenge') return <MfaChallengeScreen />;
  if (route.id === 'mfa-recovery') return <MfaRecoveryScreen />;
  if (route.id === 'sessions') return <SessionsScreen />;
  return (
    <section aria-labelledby="admin-route-title">
      <PageHeader
        eyebrow={route.navigationGroup}
        title={<span id="admin-route-title">{route.title}</span>}
        description="This routed shell is ready for server-authorized Admin context. Domain controls are intentionally not implemented here."
      />
      <ShellState
        kind="disabled"
        title="Admin shell ready"
        description={`The ${route.title} domain adapter is outside P7-S3A. Unavailable is shown instead of fabricated data or a fake control.`}
      />
    </section>
  );
}

function RouteErrorBoundary() {
  return <ApiErrorState error={useRouteError()} />;
}

function AdminNavigation() {
  const session = useAdminSession();
  const location = useLocation();
  const marketId = session.bootstrap?.currentMarket?.id;
  const visible = visibleNavigationRoutes(
    session.bootstrap?.effectivePermissions ?? [],
  );
  return (
    <nav className="admin-navigation" aria-label="Admin navigation">
      {navigationGroups.map((group) => {
        const routes = visible.filter(
          (route) => route.navigationGroup === group,
        );
        if (routes.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`admin-nav-${slug(group)}`}>
            <h2 id={`admin-nav-${slug(group)}`}>{group}</h2>
            <ul>
              {routes.map((route) => {
                const href = navigationHref(route, marketId);
                const active = href
                  ? Boolean(
                      matchPath(
                        { path: route.path, end: false },
                        location.pathname,
                      ),
                    )
                  : false;
                return (
                  <li key={route.id}>
                    {href ? (
                      <Link
                        to={href}
                        aria-current={active ? 'page' : undefined}
                      >
                        {route.title}
                        {route.capabilityGate ? <span>Blocked</span> : null}
                      </Link>
                    ) : (
                      <span aria-disabled="true">{route.title}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}

export function visibleNavigationRoutes(
  effectivePermissions: ReadonlyArray<string>,
): AdminRoute[] {
  return adminRouteManifest.filter(
    (route) =>
      route.navigation &&
      !isPublicAdminRoute(route) &&
      (!route.permission ||
        hasEffectivePermission(effectivePermissions, route.permission)),
  );
}

function navigationHref(
  route: AdminRoute,
  marketId?: string,
): string | undefined {
  if (route.market === 'none') return route.path;
  if (!marketId) return undefined;
  return routePath(route.id, { marketId });
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(' ', '-');
}

function NotFound() {
  return (
    <main className="admin-not-found" id="main-content">
      <EmptyState
        title="Admin route not found"
        description="The requested path is not part of the approved Admin route manifest."
      />
    </main>
  );
}

function Wordmark() {
  return (
    <span className="admin-wordmark">
      <span aria-hidden="true">i</span>
      <strong>Point</strong>
      <small>Admin</small>
    </span>
  );
}

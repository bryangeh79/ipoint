import {
  Alert,
  AppShell,
  Badge,
  Drawer,
  EmptyState,
  PageHeader,
  TopBar,
} from '@ipoint/ui';
import { useEffect, useState } from 'react';
import {
  Link,
  Navigate,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  createMemoryRouter,
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
import { useAdminWriteEnvironment } from './pwa-policy.js';
import { DashboardPage } from './dashboard-page.js';
import { MerchantsPage } from './merchants-page.js';
import { MerchantDetailPage } from './merchant-detail-page.js';
import { MemberListPage } from './member-list-page.js';
import { MemberDetailPage } from './member-detail-page.js';
import { MemberKycQueuePage } from './kyc-member-queue-page.js';
import { PackageConfigPage } from './package-config-page.js';
import { CommissionConfigPage } from './commission-config-page.js';
import { MarketConfigPage } from './market-config-page.js';
import { RedemptionConfigPage } from './redemption-config-page.js';
import { RewardConfigPage } from './reward-config-page.js';
import { MemberKycDetailPage } from './kyc-member-detail-page.js';
import { MerchantKycQueuePage } from './kyc-merchant-queue-page.js';
import { MerchantKycDetailPage } from './kyc-merchant-detail-page.js';

const routeObjects: RouteObject[] = [
  { path: '/', element: <Navigate replace to="/admin/login" /> },
  {
    element: <AdminShell />,
    children: adminRouteManifest.map((definition) => ({
      id: definition.id,
      path: definition.path,
      element: <RoutePlaceholder route={definition} />,
      loader: () => ({ routeId: definition.id, loader: definition.loader }),
      hydrateFallbackElement: <ShellState kind="loading" />,
      errorElement: <RouteErrorBoundary />,
    })),
  },
  { path: '*', element: <NotFound /> },
];

export function createAdminRouter() {
  return createBrowserRouter(routeObjects);
}

export function createAdminMemoryRouter(initialEntries: string[]) {
  return createMemoryRouter(routeObjects, { initialEntries });
}

export function AdminApp({
  router,
}: {
  router?: ReturnType<typeof createAdminRouter>;
}) {
  const [resolvedRouter] = useState(() => router ?? createAdminRouter());
  return (
    <AdminSessionProvider>
      <RouterProvider router={resolvedRouter} />
    </AdminSessionProvider>
  );
}

function AdminShell() {
  const location = useLocation();
  const session = useAdminSession();
  const environment = useAdminWriteEnvironment();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const publicRoute =
    location.pathname.startsWith('/admin/login') ||
    location.pathname.startsWith('/admin/mfa/');

  useEffect(() => {
    setDrawerOpen(false);
    document.title = `${currentRouteTitle(location.pathname)} | iPoint Admin`;
    const frame = requestAnimationFrame(() => {
      document.getElementById('main-content')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);

  return (
    <AppShell
      className={`admin-app${publicRoute ? ' admin-app--public' : ''}`}
      topBar={
        <TopBar
          brand={<Wordmark />}
          onMenuClick={publicRoute ? undefined : () => setDrawerOpen(true)}
          navigationLabel="Open Admin navigation"
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
      {!environment.online && !publicRoute ? (
        <Alert tone="warning" title="Offline — read-only shell" role="status">
          Current server data is unavailable and stale. No Admin write is queued
          or replayed.
        </Alert>
      ) : null}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Admin navigation"
        description="Only routes allowed by effective server permissions are shown."
        placement="left"
      >
        <AdminNavigation mobile onNavigate={() => setDrawerOpen(false)} />
      </Drawer>
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
  if (route.id === 'dashboard') return <DashboardPage />;
  // P7-S5B merchant operations (append-only at the end of the route switch).
  if (route.id === 'merchants') return <MerchantsPage />;
  if (route.id === 'merchant-detail') return <MerchantDetailPage />;
  /* P7-S5A Member Operations (append-only route cases). */
  if (route.id === 'members') return <MemberListPage />;
  if (route.id === 'member-detail') return <MemberDetailPage />;
  /* P7-S5C KYC review + privacy (append-only at the end of the route switch). */
  if (route.id === 'member-kyc') return <MemberKycQueuePage />;
  if (route.id === 'member-kyc-detail') return <MemberKycDetailPage />;
  if (route.id === 'merchant-kyc') return <MerchantKycQueuePage />;
  if (route.id === 'merchant-kyc-detail') return <MerchantKycDetailPage />;
  /* P7-S6A package configuration (append-only route case). */
  if (route.id === 'packages') return <PackageConfigPage />;
  /* P7-S6B reward configuration (append-only route case). */
  if (route.id === 'reward-rates') return <RewardConfigPage />;
  /* P7-S6C redemption rate configuration (append-only route case). */
  if (route.id === 'redemption-rates') return <RedemptionConfigPage />;
  /* P7-S6D commission rate configuration (append-only route case). */
  if (route.id === 'commissions') return <CommissionConfigPage />;
  /* P7-S6E market configuration (append-only route case). */
  if (route.id === 'market') return <MarketConfigPage />;
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

function AdminNavigation({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const session = useAdminSession();
  const location = useLocation();
  const marketId = session.bootstrap?.currentMarket?.id;
  const visible = visibleNavigationRoutes(
    session.bootstrap?.effectivePermissions ?? [],
  );
  return (
    <nav
      className={`admin-navigation${mobile ? ' admin-navigation--drawer' : ''}`}
      aria-label={mobile ? 'Mobile Admin navigation' : 'Admin navigation'}
    >
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
                        onClick={onNavigate}
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

function currentRouteTitle(pathname: string): string {
  return (
    adminRouteManifest.find((route) =>
      matchPath({ path: route.path, end: true }, pathname),
    )?.title ?? 'Route not found'
  );
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

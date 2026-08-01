import { AppShell, Badge, EmptyState, PageHeader, TopBar } from '@ipoint/ui';
import {
  Navigate,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useLocation,
  useNavigate,
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
import { adminRouteManifest, type AdminRoute } from './route-manifest.js';

const routeObjects: RouteObject[] = [
  {
    path: '/',
    element: <Navigate replace to="/admin/login" />,
  },
  {
    element: <AdminShell />,
    children: adminRouteManifest.map((definition) => ({
      id: definition.id,
      path: definition.path,
      element: <RoutePlaceholder route={definition} />,
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
  const navigate = useNavigate();
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
      sideNavigation={
        publicRoute ? undefined : (
          <nav className="admin-route-index" aria-label="Admin navigation">
            <button type="button" onClick={() => navigate('/admin/login')}>
              Admin route manifest
            </button>
          </nav>
        )
      }
    >
      <Outlet />
    </AppShell>
  );
}

function RoutePlaceholder({ route }: { route: AdminRoute }) {
  if (route.id === 'login') return <LoginScreen />;
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
      <MarketSelector />
      <EmptyState
        title="Shell route ready"
        description={`Route ID: ${route.id}. Required state will be resolved by its ${route.loader} loader.`}
      />
    </section>
  );
}

function RouteErrorBoundary() {
  return (
    <EmptyState
      title="Unable to open this Admin route"
      description="Use the navigation to retry. No domain operation was performed."
    />
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

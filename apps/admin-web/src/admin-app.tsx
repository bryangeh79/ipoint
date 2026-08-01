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
  return <RouterProvider router={createAdminRouter()} />;
}

function AdminShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const publicRoute =
    location.pathname.startsWith('/admin/login') ||
    location.pathname.startsWith('/admin/mfa/');

  return (
    <AppShell
      className={`admin-app${publicRoute ? ' admin-app--public' : ''}`}
      topBar={
        <TopBar
          brand={<Wordmark />}
          actions={<Badge tone="warning">Foundation</Badge>}
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
  return (
    <section aria-labelledby="admin-route-title">
      <PageHeader
        eyebrow={route.navigationGroup}
        title={<span id="admin-route-title">{route.title}</span>}
        description="This routed shell is ready for server-authorized Admin context. Domain controls are intentionally not implemented here."
      />
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

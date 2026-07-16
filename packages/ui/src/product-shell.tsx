import { useState, type ReactNode } from 'react';
import { Circle, LayoutDashboard } from 'lucide-react';
import { Badge, Card, StatCard } from './components.js';
import {
  AppShell,
  BottomNavigation,
  PageHeader,
  SideNavigation,
  TopBar,
  type NavigationItem,
} from './navigation.js';
import { Drawer } from './overlays.js';

export interface ProductShellProps {
  appName: string;
  audience?: string;
  navigation?: ReadonlyArray<Omit<NavigationItem, 'icon'>>;
  children?: ReactNode;
}

const defaultNavigation = [
  { id: 'overview', label: 'Overview', href: '#' },
  { id: 'activity', label: 'Activity', href: '#' },
  { id: 'settings', label: 'Settings', href: '#' },
] as const;

export function ProductShell({
  appName,
  audience = 'Workspace',
  navigation = defaultNavigation,
  children,
}: ProductShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items = navigation.map((item, index) => ({
    ...item,
    icon: index === 0 ? <LayoutDashboard size={20} /> : <Circle size={18} />,
  }));
  const navigationView = <SideNavigation items={items} activeId="overview" />;

  return (
    <AppShell
      topBar={
        <TopBar
          brand={
            <span className="ip-wordmark">
              <span aria-hidden="true">i</span>Point <small>{audience}</small>
            </span>
          }
          onMenuClick={() => setDrawerOpen(true)}
          actions={<Badge tone="success">Foundation ready</Badge>}
        />
      }
      sideNavigation={navigationView}
      bottomNavigation={<BottomNavigation items={items} activeId="overview" />}
    >
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={`${appName} navigation`}
        placement="left"
      >
        <SideNavigation
          items={items}
          activeId="overview"
          onNavigate={() => setDrawerOpen(false)}
          label="Mobile navigation"
        />
      </Drawer>
      <PageHeader
        eyebrow="Phase 0 foundation"
        title={appName}
        description="A responsive application shell ready for approved product flows."
      />
      {children ?? (
        <section
          className="ip-dashboard-placeholder"
          aria-label="Dashboard placeholder"
        >
          <StatCard
            label="Environment"
            value="Ready"
            helper="Shared design system active"
          />
          <StatCard
            label="Interface"
            value="Responsive"
            helper="Mobile and desktop shell"
          />
          <Card className="ip-dashboard-placeholder__canvas">
            <span
              className="ip-dashboard-placeholder__mark"
              aria-hidden="true"
            />
            <h2>Dashboard content will appear here</h2>
            <p>
              Business modules remain intentionally outside this foundation
              phase.
            </p>
          </Card>
        </section>
      )}
    </AppShell>
  );
}

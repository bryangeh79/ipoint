import { useCallback, useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AppShell,
  TopBar,
  SideNavigation,
  BottomNavigation,
  Drawer,
} from '@ipoint/ui';
import { House, Store, Wallet, User, LogOut } from 'lucide-react';
import { useAuth } from '../auth/useAuth';

interface MemberLayoutProps {
  children: ReactNode;
}

const NAV_ITEMS = [
  { id: 'home', label: 'Home', href: '/', icon: <House size={20} /> },
  {
    id: 'merchants',
    label: 'Merchants',
    href: '/merchants',
    icon: <Store size={20} />,
  },
  {
    id: 'wallet',
    label: 'Wallet',
    href: '/#wallet',
    icon: <Wallet size={20} />,
  },
  {
    id: 'profile',
    label: 'Profile',
    href: '/profile',
    icon: <User size={20} />,
  },
] as const;

//  is intentionally unused - shows 'Coming Soon' in bottom nav = NAV_ITEMS[2]; // Wallet - shows "Coming Soon"

export function MemberLayout({ children }: MemberLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeSegment = location.pathname.split('/')[1] ?? 'home';
  const activeId =
    activeSegment === '' || activeSegment === 'home'
      ? 'home'
      : (NAV_ITEMS.find((item) => item.href === `/${activeSegment}`)?.id ??
        'home');

  const handleNavigate = useCallback(
    (item: (typeof NAV_ITEMS)[number]) => {
      if (item.id === 'wallet') {
        // Phase 3 not authorized — show "Coming Soon" placeholder
        return;
      }
      if (item.href) {
        void navigate(item.href);
        setDrawerOpen(false);
      }
    },
    [navigate],
  );

  const topBarActions = (
    <>
      {user ? (
        <button
          type="button"
          className="ip-button ip-button--ghost ip-button--sm"
          onClick={() => void logout()}
          aria-label={t('auth.logout')}
        >
          <LogOut size={18} aria-hidden="true" />
          <span className="ip-sr-only">{t('auth.logout')}</span>
        </button>
      ) : null}
    </>
  );

  const sideNav = (
    <SideNavigation
      items={NAV_ITEMS.map((item) => ({
        ...item,
        disabled: item.id === 'wallet',
      }))}
      activeId={activeId}
      onNavigate={(navItem) => {
        const found = NAV_ITEMS.find((n) => n.id === navItem.id);
        if (found) handleNavigate(found);
      }}
      label="Primary navigation"
    />
  );

  return (
    <AppShell
      topBar={
        <TopBar
          brand={
            <span className="ip-wordmark">
              <span aria-hidden="true">i</span>Point{' '}
              <small>{t('app.name')}</small>
            </span>
          }
          onMenuClick={() => setDrawerOpen(true)}
          actions={topBarActions}
        />
      }
      sideNavigation={sideNav}
      bottomNavigation={
        <BottomNavigation
          items={NAV_ITEMS.map((item) => ({
            ...item,
            disabled: item.id === 'wallet',
          }))}
          activeId={activeId}
          onNavigate={(navItem) => {
            const found = NAV_ITEMS.find((n) => n.id === navItem.id);
            if (found) handleNavigate(found);
          }}
          label="Primary navigation"
        />
      }
    >
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={`${t('app.name')} navigation`}
        placement="left"
      >
        <SideNavigation
          items={NAV_ITEMS.map((item) => ({
            ...item,
            disabled: item.id === 'wallet',
          }))}
          activeId={activeId}
          onNavigate={(navItem) => {
            const found = NAV_ITEMS.find((n) => n.id === navItem.id);
            if (found) handleNavigate(found);
            setDrawerOpen(false);
          }}
          label="Mobile navigation"
        />
      </Drawer>
      {children}
    </AppShell>
  );
}

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
import {
  House,
  Store,
  Wallet,
  Gift,
  Users,
  ShoppingBag,
  User,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../auth/useAuth';

interface MemberLayoutProps {
  children: ReactNode;
}

const NAV_ITEMS = [
  { id: 'home', href: '/', icon: <House size={20} /> },
  { id: 'merchants', href: '/merchants', icon: <Store size={20} /> },
  { id: 'wallet', href: '/wallet', icon: <Wallet size={20} /> },
  { id: 'reward', href: '/reward', icon: <Gift size={20} /> },
  { id: 'team', href: '/team', icon: <Users size={20} /> },
  { id: 'redemption', href: '/redemption', icon: <ShoppingBag size={20} /> },
  { id: 'profile', href: '/profile', icon: <User size={20} /> },
] as const;

export function MemberLayout({ children }: MemberLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const navItems = NAV_ITEMS.map((item) => ({
    ...item,
    label: t(`nav.${item.id}`),
  }));

  const activeSegment = location.pathname.split('/')[1] ?? 'home';
  const activeId =
    activeSegment === '' || activeSegment === 'home'
      ? 'home'
      : (navItems.find((item) => item.href === `/${activeSegment}`)?.id ??
        'home');

  const handleNavigate = useCallback(
    (item: (typeof navItems)[number]) => {
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
      items={navItems}
      activeId={activeId}
      onNavigate={(navItem) => {
        const found = navItems.find((n) => n.id === navItem.id);
        if (found) handleNavigate(found);
      }}
      label={t('nav.primary')}
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
          items={navItems}
          activeId={activeId}
          onNavigate={(navItem) => {
            const found = navItems.find((n) => n.id === navItem.id);
            if (found) handleNavigate(found);
          }}
          label={t('nav.bottom')}
        />
      }
    >
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={`${t('app.name')} ${t('nav.drawerTitle')}`}
        placement="left"
      >
        <SideNavigation
          items={navItems}
          activeId={activeId}
          onNavigate={(navItem) => {
            const found = navItems.find((n) => n.id === navItem.id);
            if (found) handleNavigate(found);
            setDrawerOpen(false);
          }}
          label={t('nav.mobile')}
        />
      </Drawer>
      {children}
    </AppShell>
  );
}

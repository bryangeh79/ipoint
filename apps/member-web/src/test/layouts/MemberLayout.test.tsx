// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MemberLayout } from '../../layouts/MemberLayout';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'app.name': 'iPoint Member',
        'nav.home': 'Home',
        'nav.merchants': 'Merchants',
        'nav.wallet': 'Wallet',
        'nav.reward': 'Rewards',
        'nav.team': 'My Team',
        'nav.redemption': 'Redemption',
        'nav.profile': 'Profile',
        'nav.primary': 'Primary navigation',
        'nav.bottom': 'Bottom navigation',
        'nav.mobile': 'Mobile navigation',
        'nav.drawerTitle': 'navigation',
        'auth.logout': 'Log Out',
      };
      return translations[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

// Mock useAuth (MemberLayout only needs user + logout)
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'member@example.com' },
    isAuthenticated: true,
    isLoading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    clearError: vi.fn(),
  }),
}));

function renderLayout(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/"
          element={
            <MemberLayout>
              <div>Home page</div>
            </MemberLayout>
          }
        />
        <Route
          path="/wallet"
          element={
            <MemberLayout>
              <div>Wallet page</div>
            </MemberLayout>
          }
        />
        <Route
          path="/reward"
          element={
            <MemberLayout>
              <div>Rewards page</div>
            </MemberLayout>
          }
        />
        <Route
          path="/team"
          element={
            <MemberLayout>
              <div>Team page</div>
            </MemberLayout>
          }
        />
        <Route
          path="/redemption"
          element={
            <MemberLayout>
              <div>Redemption page</div>
            </MemberLayout>
          }
        />
        <Route
          path="/merchants"
          element={
            <MemberLayout>
              <div>Merchants page</div>
            </MemberLayout>
          }
        />
        <Route
          path="/profile"
          element={
            <MemberLayout>
              <div>Profile page</div>
            </MemberLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function sideNav() {
  return screen.getByRole('navigation', { name: 'Primary navigation' });
}

describe('MemberLayout', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders all seven primary nav items including the newly activated ones', () => {
    renderLayout();
    const nav = sideNav();
    expect(nav).toBeInTheDocument();
    expect(within(nav).getByText('Home')).toBeInTheDocument();
    expect(within(nav).getByText('Merchants')).toBeInTheDocument();
    expect(within(nav).getByText('Wallet')).toBeInTheDocument();
    expect(within(nav).getByText('Rewards')).toBeInTheDocument();
    expect(within(nav).getByText('My Team')).toBeInTheDocument();
    expect(within(nav).getByText('Redemption')).toBeInTheDocument();
    expect(within(nav).getByText('Profile')).toBeInTheDocument();
  });

  it('navigates to the wallet page when the Wallet nav item is clicked', async () => {
    renderLayout();
    await user.click(within(sideNav()).getByText('Wallet'));
    expect(await screen.findByText('Wallet page')).toBeInTheDocument();
  });

  it('navigates to the reward page when the Rewards nav item is clicked', async () => {
    renderLayout();
    await user.click(within(sideNav()).getByText('Rewards'));
    expect(await screen.findByText('Rewards page')).toBeInTheDocument();
  });

  it('navigates to the team page when My Team is clicked', async () => {
    renderLayout();
    await user.click(within(sideNav()).getByText('My Team'));
    expect(await screen.findByText('Team page')).toBeInTheDocument();
  });

  it('navigates to the redemption page when Redemption is clicked', async () => {
    renderLayout();
    await user.click(within(sideNav()).getByText('Redemption'));
    expect(await screen.findByText('Redemption page')).toBeInTheDocument();
  });

  it('marks the active nav item for the current route', async () => {
    renderLayout('/wallet');
    await screen.findByText('Wallet page');
    const walletLink = within(sideNav()).getByText('Wallet').closest('a');
    expect(walletLink).toHaveAttribute('aria-current', 'page');
    const homeLink = within(sideNav()).getByText('Home').closest('a');
    expect(homeLink).not.toHaveAttribute('aria-current');
  });
});

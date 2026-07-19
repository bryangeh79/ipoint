// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider.tsx';
import { HomePage } from '../../pages/HomePage.tsx';
import { ApiClient, ApiError } from '@ipoint/api-client';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'home.title': 'Welcome to iPoint',
        'home.subtitle': 'Earn rewards on your everyday spending',
        'home.welcomeMessage': 'Welcome, {name}',
        'home.myQr': 'My QR',
        'home.myQrDescription': 'Show your QR code to pay',
        'home.merchantDiscovery': 'Merchant Discovery',
        'home.merchantDiscoveryDescription': 'Find merchants near you',
        'home.kycStatus': 'KYC Status',
        'home.kycStatusDescription':
          'Complete verification to unlock full features',
        'home.kycVerifyNow': 'Verify Now',
        'home.kycApprovedLabel': 'Verified',
        'home.wallet': 'Wallet',
        'home.walletComingSoon': 'Wallet features coming soon',
        'home.accountCountryLabel': 'Account Country',
        'home.currentMarketLabel': 'Current Market',
        'home.switchMarket': 'Switch',
        'home.quickActions': 'Quick Actions',
        'profile.notProvided': 'Not provided',
        'profile.kycPending': 'Pending',
        'profile.kycRejected': 'Rejected',
        'profile.kycNotStarted': 'Not Started',
        'profile.kycApproved': 'Approved',
        'merchants.title': 'Merchant Discovery',
        'common.loading': 'Loading...',
        'common.error': 'Something went wrong',
        'common.retry': 'Retry',
        'common.comingSoonDescription':
          'This feature is not available yet. Stay tuned!',
      };
      if (options) {
        const resolved = translations[key] ?? key;
        return resolved.replace(/\{(\w+)\}/g, (_, k) =>
          String(options[k] ?? ''),
        );
      }
      return translations[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

function createTestClient() {
  const client = new ApiClient('http://localhost:3000/api/v1');
  vi.spyOn(client, 'attemptSessionRestore').mockResolvedValue(false);
  return client;
}

function renderHomePage(client: ApiClient) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider apiClient={client} autoRestore={false}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/qr" element={<div>QR page</div>} />
          <Route
            path="/merchants"
            element={<div>Merchant discovery page</div>}
          />
          <Route path="/kyc" element={<div>KYC page</div>} />
          <Route path="/market" element={<div>Market switch page</div>} />
          <Route path="/profile" element={<div>Profile page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('HomePage', () => {
  let client: ApiClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = createTestClient();
    user = userEvent.setup({ advanceTimers: () => vi.advanceTimersByTime(1) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('welcome message and market display', () => {
    it('shows welcome message with member name', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              name: 'Jane',
              email: 'jane@example.com',
              countryCode: 'MY',
              marketCode: 'SG',
              kycStatus: 'approved',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderHomePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Welcome, Jane')).toBeInTheDocument();
      });
    });

    it('shows Account Country and Current Market distinction', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              name: 'Jane',
              email: 'jane@example.com',
              countryCode: 'MY',
              marketCode: 'SG',
              kycStatus: 'approved',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderHomePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText(/Account Country/)).toBeInTheDocument();
        expect(screen.getByText(/Current Market/)).toBeInTheDocument();
      });

      expect(screen.getByText('MY')).toBeInTheDocument();
      expect(screen.getByText('SG')).toBeInTheDocument();
    });
  });

  describe('KYC status card', () => {
    it('shows approved badge when KYC is approved', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              name: 'Jane',
              email: 'jane@example.com',
              countryCode: 'MY',
              marketCode: 'SG',
              kycStatus: 'approved',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderHomePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Verified')).toBeInTheDocument();
      });
    });

    it('shows "Verify Now" when KYC not started', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              name: 'Jane',
              email: 'jane@example.com',
              countryCode: 'MY',
              marketCode: 'SG',
              kycStatus: 'not_started',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderHomePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Verify Now')).toBeInTheDocument();
      });
    });

    it('shows "Pending" when KYC is pending', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              name: 'Jane',
              email: 'jane@example.com',
              countryCode: 'MY',
              marketCode: 'SG',
              kycStatus: 'pending',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderHomePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Pending')).toBeInTheDocument();
      });
    });
  });

  describe('wallet coming soon', () => {
    it('shows wallet coming soon placeholder', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              name: 'Jane',
              email: 'jane@example.com',
              countryCode: 'MY',
              marketCode: 'SG',
              kycStatus: 'approved',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderHomePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Wallet')).toBeInTheDocument();
      });
      expect(
        screen.getByText('Wallet features coming soon'),
      ).toBeInTheDocument();
    });
  });

  describe('quick action cards', () => {
    it('navigates to QR page on My QR click', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              name: 'Jane',
              email: 'jane@example.com',
              countryCode: 'MY',
              marketCode: 'SG',
              kycStatus: 'approved',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderHomePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('My QR')).toBeInTheDocument();
      });

      await user.click(screen.getByText('My QR'));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('QR page')).toBeInTheDocument();
      });
    });

    it('navigates to KYC page on KYC Status click', async () => {
      vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
        if (path === '/profile') {
          return {
            data: {
              id: 'u1',
              name: 'Jane',
              email: 'jane@example.com',
              countryCode: 'MY',
              marketCode: 'SG',
              kycStatus: 'not_started',
              createdAt: '2024-01-01T00:00:00Z',
            },
            requestId: 'req-1',
          };
        }
        throw new ApiError(404, { message: 'Not found' });
      });

      renderHomePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('KYC Status')).toBeInTheDocument();
      });

      await user.click(screen.getByText('KYC Status'));
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('KYC page')).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows retry on network error', async () => {
      vi.spyOn(client, 'get').mockRejectedValue(
        new ApiError(0, { message: 'Network failure' }),
      );

      renderHomePage(client);
      await vi.runAllTimersAsync();

      await waitFor(() => {
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      });
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });
});

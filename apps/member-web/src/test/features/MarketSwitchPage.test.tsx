// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider';
import { MarketSwitchPage } from '../../pages/MarketSwitchPage';
import { ApiClient, ApiError } from '@ipoint/api-client';
import { apiClient as globalApiClient } from '../../api/client';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'market.switchTitle': 'Switch Market',
        'market.currentMarket': 'Current Market',
        'market.switchTo': 'Switch to {market}',
        'market.switchConfirmTitle': 'Market Switched',
        'market.switchConfirmMessage': 'Market switched to {market}',
        'market.unavailable': 'Unavailable',
        'market.comingSoon': 'Coming Soon',
        'market.accountCountryLabel': 'Account Country',
        'market.marketLabel': 'Current Market',
        'market.switchFailed': 'Failed to switch market. Please try again.',
        'market.selectMarket': 'Select a Market',
        'market.availableMarkets': 'Available Markets',
        'market.refreshNote':
          'Merchant-related pages will be refreshed on your next visit.',
        'profile.kycApproved': 'Approved',
        'profile.kycPending': 'Pending',
        'profile.kycRejected': 'Rejected',
        'profile.kycNotStarted': 'Not Started',
        'common.loading': 'Loading...',
        'common.error': 'Something went wrong',
        'common.retry': 'Retry',
        'common.comingSoonDescription':
          'This feature is not available yet. Stay tuned!',
      };
      if (options) {
        return (
          translations[key]?.replace(/\{(\w+)\}/g, (_, k) =>
            String(options[k] ?? ''),
          ) ?? key
        );
      }
      return translations[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

// Mock the global apiClient that MarketSwitchPage uses directly
vi.mock('../../api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    login: vi.fn(),
    setTokens: vi.fn(),
    clearSession: vi.fn(),
    attemptSessionRestore: vi.fn().mockResolvedValue(false),
    isAuthenticated: false,
    onSessionExpired: null,
  },
}));

function createTestClient() {
  const client = new ApiClient('http://localhost:3000/api/v1');
  vi.spyOn(client, 'attemptSessionRestore').mockResolvedValue(false);
  return client;
}

function renderMarketSwitchPage(client: ApiClient) {
  return render(
    <MemoryRouter initialEntries={['/market']}>
      <AuthProvider apiClient={client} autoRestore={false}>
        <Routes>
          <Route path="/market" element={<MarketSwitchPage />} />
          <Route path="/" element={<div>Home page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('MarketSwitchPage', () => {
  let client: ApiClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    client = createTestClient();
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('market list display', () => {
    it('shows markets and current market', async () => {
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (path: string) => {
          if (path === '/markets') {
            return {
              data: [
                {
                  id: 'm1',
                  code: 'MY',
                  name: 'Malaysia',
                  currency: 'MYR',
                  isActive: true,
                },
                {
                  id: 'm2',
                  code: 'SG',
                  name: 'Singapore',
                  currency: 'SGD',
                  isActive: true,
                },
                {
                  id: 'm3',
                  code: 'VN',
                  name: 'Vietnam',
                  currency: 'VND',
                  isActive: false,
                },
              ],
              requestId: 'req-1',
            };
          }
          if (path === '/profile') {
            return {
              data: {
                id: 'u1',
                email: 'test@example.com',
                countryCode: 'MY',
                marketCode: 'MY',
                createdAt: '2024-01-01T00:00:00Z',
              },
              requestId: 'req-2',
            };
          }
          throw new ApiError(404, { message: 'Not found' });
        },
      );

      renderMarketSwitchPage(client);

      await waitFor(() => {
        expect(screen.getByText('Malaysia')).toBeInTheDocument();
      });

      // Account country distinction
      expect(screen.getByText(/Account Country/)).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Current Market' }),
      ).toBeInTheDocument();
    });

    it('shows coming soon badge for inactive markets', async () => {
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (path: string) => {
          if (path === '/markets') {
            return {
              data: [
                {
                  id: 'm1',
                  code: 'MY',
                  name: 'Malaysia',
                  currency: 'MYR',
                  isActive: true,
                },
                {
                  id: 'm2',
                  code: 'VN',
                  name: 'Vietnam',
                  currency: 'VND',
                  isActive: false,
                },
              ],
              requestId: 'req-1',
            };
          }
          if (path === '/profile') {
            return {
              data: {
                id: 'u1',
                email: 'test@example.com',
                countryCode: 'MY',
                marketCode: 'MY',
                createdAt: '2024-01-01T00:00:00Z',
              },
              requestId: 'req-2',
            };
          }
          throw new ApiError(404, { message: 'Not found' });
        },
      );

      renderMarketSwitchPage(client);

      await waitFor(() => {
        expect(screen.getByText('Coming Soon')).toBeInTheDocument();
      });
    });
  });

  describe('switch action', () => {
    it('switches market on button click', async () => {
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (path: string) => {
          if (path === '/markets') {
            return {
              data: [
                {
                  id: 'm1',
                  code: 'MY',
                  name: 'Malaysia',
                  currency: 'MYR',
                  isActive: true,
                },
                {
                  id: 'm2',
                  code: 'SG',
                  name: 'Singapore',
                  currency: 'SGD',
                  isActive: true,
                },
              ],
              requestId: 'req-1',
            };
          }
          if (path === '/profile') {
            return {
              data: {
                id: 'u1',
                email: 'test@example.com',
                countryCode: 'MY',
                marketCode: 'MY',
                createdAt: '2024-01-01T00:00:00Z',
              },
              requestId: 'req-2',
            };
          }
          throw new ApiError(404, { message: 'Not found' });
        },
      );

      (globalApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { success: true },
        requestId: 'req-3',
      });

      renderMarketSwitchPage(client);

      await waitFor(() => {
        expect(screen.getByText('Switch to Singapore')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Switch to Singapore'));

      await waitFor(() => {
        expect(globalApiClient.post).toHaveBeenCalledWith('/markets/switch', {
          marketCode: 'SG',
        });
      });
    });
  });

  describe('error handling', () => {
    it('shows error when market switch fails', async () => {
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (path: string) => {
          if (path === '/markets') {
            return {
              data: [
                {
                  id: 'm1',
                  code: 'MY',
                  name: 'Malaysia',
                  currency: 'MYR',
                  isActive: true,
                },
                {
                  id: 'm2',
                  code: 'SG',
                  name: 'Singapore',
                  currency: 'SGD',
                  isActive: true,
                },
              ],
              requestId: 'req-1',
            };
          }
          if (path === '/profile') {
            return {
              data: {
                id: 'u1',
                email: 'test@example.com',
                countryCode: 'MY',
                marketCode: 'MY',
                createdAt: '2024-01-01T00:00:00Z',
              },
              requestId: 'req-2',
            };
          }
          throw new ApiError(404, { message: 'Not found' });
        },
      );

      (globalApiClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ApiError(500, { message: 'Internal server error' }),
      );

      renderMarketSwitchPage(client);

      await waitFor(() => {
        expect(screen.getByText('Switch to Singapore')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Switch to Singapore'));

      await waitFor(() => {
        expect(
          screen.getByText('Failed to switch market. Please try again.'),
        ).toBeInTheDocument();
      });
    });

    it('shows retry on network error', async () => {
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ApiError(0, { message: 'Network failure' }),
      );

      renderMarketSwitchPage(client);

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('Something went wrong');
      });
    });
  });
});

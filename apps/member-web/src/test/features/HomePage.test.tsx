// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider';
import { HomePage } from '../../pages/HomePage';
import { ApiClient, ApiError } from '@ipoint/api-client';
import {
  apiClient as globalApiClient,
  memberAdsContentApi as globalContentApi,
} from '../../api/client';

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
        'home.marketHighlights': 'Market highlights',
        'home.contentUnavailable': 'Market highlights are unavailable',
        'home.sponsored': 'Sponsored',
        'home.promoted': 'Promoted',
        'home.learnMore': 'Learn more',
        'home.noHighlights': 'No market highlights yet',
        'home.noHighlightsDescription': 'New offers will appear here.',
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

// Mock the global apiClient that HomePage uses directly
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
  memberAdsContentApi: {
    home: vi.fn().mockResolvedValue({
      market_id: 'market-a',
      as_of: '2026-08-08T00:00:00.000Z',
      ads: [],
      articles: [],
    }),
  },
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
    client = createTestClient();
    user = userEvent.setup();
    (globalContentApi.home as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue({
        market_id: 'market-a',
        as_of: '2026-08-08T00:00:00.000Z',
        ads: [],
        articles: [],
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('welcome message and market display', () => {
    it('renders sponsor and promoted labels from the active market content surface', async () => {
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          id: 'u1',
          name: 'Jane',
          email: 'jane@example.com',
          countryCode: 'MY',
          marketCode: 'MY',
          kycStatus: 'approved',
          createdAt: '2024-01-01T00:00:00Z',
        },
      });
      (globalContentApi.home as ReturnType<typeof vi.fn>).mockResolvedValue({
        market_id: 'market-a',
        as_of: '2026-08-08T00:00:00.000Z',
        ads: [
          {
            public_id: 'ad-1',
            placement_code: 'HOME_HERO',
            title: 'Dining week',
            summary: 'Local offers',
            creative_media_url: 'https://cdn.example.test/ad.webp',
            creative_alt_text: 'Dining',
            target_url: null,
            is_sponsored: true,
            sponsor_label: 'Sponsored',
          },
        ],
        articles: [
          {
            public_id: 'article-1',
            slug: 'market-news',
            title: 'Market news',
            excerpt: 'Local update',
            body: 'Body',
            cover_media_url: null,
            cover_alt_text: null,
            is_promoted: true,
            sponsor_label: 'Promoted',
            published_at: '2026-08-08T00:00:00.000Z',
          },
        ],
      });
      renderHomePage(client);
      expect(await screen.findByText('Sponsored')).toBeInTheDocument();
      expect(screen.getByText('Promoted')).toBeInTheDocument();
      expect(screen.getByText('Dining week')).toBeInTheDocument();
      expect(screen.getByText('Market news')).toBeInTheDocument();
    });

    it('shows welcome message with member name', async () => {
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (path: string) => {
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
        },
      );

      renderHomePage(client);

      await waitFor(() => {
        expect(screen.getByText('Welcome, Jane')).toBeInTheDocument();
      });
    });

    it('shows Account Country and Current Market distinction', async () => {
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (path: string) => {
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
        },
      );

      renderHomePage(client);

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
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (path: string) => {
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
        },
      );

      renderHomePage(client);

      await waitFor(() => {
        expect(screen.getByText('Verified')).toBeInTheDocument();
      });
    });

    it('shows "Verify Now" when KYC not started', async () => {
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (path: string) => {
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
        },
      );

      renderHomePage(client);

      await waitFor(() => {
        expect(screen.getByText('Verify Now')).toBeInTheDocument();
      });
    });

    it('shows "Pending" when KYC is pending', async () => {
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (path: string) => {
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
        },
      );

      renderHomePage(client);

      await waitFor(() => {
        expect(screen.getByText('Pending')).toBeInTheDocument();
      });
    });
  });

  describe('wallet coming soon', () => {
    it('shows wallet coming soon placeholder', async () => {
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (path: string) => {
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
        },
      );

      renderHomePage(client);

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
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (path: string) => {
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
        },
      );

      renderHomePage(client);

      await waitFor(() => {
        expect(screen.getByText('My QR')).toBeInTheDocument();
      });

      await user.click(screen.getByText('My QR'));

      await waitFor(() => {
        expect(screen.getByText('QR page')).toBeInTheDocument();
      });
    });

    it('navigates to KYC page on KYC Status click', async () => {
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockImplementation(
        async (path: string) => {
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
        },
      );

      renderHomePage(client);

      await waitFor(() => {
        expect(screen.getByText('KYC Status')).toBeInTheDocument();
      });

      await user.click(screen.getByText('KYC Status'));

      await waitFor(() => {
        expect(screen.getByText('KYC page')).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows retry on network error', async () => {
      (globalApiClient.get as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ApiError(0, { message: 'Network failure' }),
      );

      renderHomePage(client);

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('Something went wrong');
      });
    });
  });
});

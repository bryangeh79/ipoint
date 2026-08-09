// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ApiError } from '@ipoint/api-client';
import { WalletPage } from '../../pages/WalletPage';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'wallet.title': 'Wallet',
        'wallet.subtitle': 'Your iPoint wallet balance and activity',
        'wallet.marketLabel': 'Market',
        'wallet.currencyUnknown': '-',
        'wallet.availableBalance': 'Available',
        'wallet.pendingBalance': 'Pending',
        'wallet.reversedBalance': 'Reversed',
        'wallet.ledgerTitle': 'Ledger history',
        'wallet.entryGeneric': 'Wallet entry',
        'wallet.entryTypes.PENDING': 'Pending',
        'wallet.entryTypes.AVAILABLE': 'Available',
        'wallet.entryTypes.REVERSED': 'Reversed',
        'wallet.entryTypes.COMPENSATION': 'Compensation',
        'wallet.entryTypes.ADJUSTMENT': 'Adjustment',
        'wallet.balanceAfter': 'After',
        'wallet.showing': 'Showing {from}-{to} of {total}',
        'wallet.pageOf': 'Page {page} of {total}',
        'wallet.previous': 'Previous',
        'wallet.next': 'Next',
        'wallet.noWallet': 'No wallet yet',
        'wallet.noWalletDescription':
          'Your iPoint wallet will appear here once available.',
        'wallet.noEntries': 'No records',
        'wallet.noEntriesDescription': 'Your wallet activity will appear here.',
        'wallet.loadError': 'Failed to load wallet',
        'wallet.rewardSummary': 'Reward activity',
        'wallet.rewardSummaryDescription':
          'View your iPoint reward plans and earnings',
        'wallet.viewRewards': 'View rewards',
        'wallet.marketNote': 'Balances are shown per market.',
        'errors.marketAccess': 'Market access required',
        'errors.marketAccessDescription': 'Select a market to view this page.',
        'errors.selectMarket': 'Select market',
        'common.loading': 'Loading...',
        'common.error': 'Something went wrong',
        'common.retry': 'Retry',
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

// Mock the api client module used by WalletPage
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
  memberAdsContentApi: { home: vi.fn() },
  memberWalletApi: {
    listWallets: vi.fn(),
    getWallet: vi.fn(),
    walletEntries: vi.fn(),
  },
  memberRewardApi: { plans: vi.fn() },
  memberTeamApi: {
    referralTree: vi.fn(),
    agentStatus: vi.fn(),
    commissionSummary: vi.fn(),
    commissionLedger: vi.fn(),
  },
  memberRedemptionApi: {
    catalog: vi.fn(),
    itemDetail: vi.fn(),
    quote: vi.fn(),
    confirmOrder: vi.fn(),
  },
}));

import {
  apiClient as mockedApiClient,
  memberWalletApi as mockedWalletApi,
} from '../../api/client';

const MOCK_MARKETS = [
  {
    id: 'market-my',
    code: 'MY',
    name: 'Malaysia',
    currency: 'MYR',
    isActive: true,
  },
];

const MOCK_WALLETS = [
  {
    id: 'wallet-1',
    memberId: 'member-1',
    marketId: 'market-my',
    pendingBalance: '12.5000000000',
    availableBalance: '187.0000000000',
    reversedBalance: '0.0000000000',
    version: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

const MOCK_ENTRIES = {
  entries: [
    {
      id: 'entry-1',
      walletAccountId: 'wallet-1',
      memberId: 'member-1',
      marketId: 'market-my',
      entrySequence: 2,
      entryType: 'AVAILABLE',
      amount: '10.0000000000',
      balanceBefore: '177.0000000000',
      balanceAfter: '187.0000000000',
      idempotencyKey: 'idem-1',
      referenceType: 'REWARD',
      referenceId: 'ref-1',
      description: 'Reward accrual',
      reason: null,
      actorId: null,
      marketTimezone: null,
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

function renderWalletPage() {
  return render(
    <MemoryRouter initialEntries={['/wallet']}>
      <Routes>
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/market" element={<div>Market switch page</div>} />
        <Route path="/reward" element={<div>Rewards page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WalletPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockedApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: MOCK_MARKETS,
    });
    (mockedWalletApi.listWallets as ReturnType<typeof vi.fn>).mockResolvedValue(
      MOCK_WALLETS,
    );
    (
      mockedWalletApi.walletEntries as ReturnType<typeof vi.fn>
    ).mockResolvedValue(MOCK_ENTRIES);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders balance with exact decimal string and trimmed display', async () => {
    renderWalletPage();
    expect(
      await screen.findByTestId('wallet-balance-card'),
    ).toBeInTheDocument();
    // '187.0000000000' renders losslessly as '187', pending '12.5', reversed '0'
    expect(screen.getByText('MYR 187')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('Malaysia (MY)')).toBeInTheDocument();
  });

  it('renders ledger entries with exact amounts and balance-after', async () => {
    renderWalletPage();
    const rows = await screen.findAllByTestId('wallet-ledger-entry');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Available');
    expect(rows[0]!.textContent).toContain('Reward accrual');
    expect(rows[0]!.textContent).toContain('10');
    expect(rows[0]!.textContent).toContain('187');
  });

  it('shows empty state when ledger has no entries', async () => {
    (
      mockedWalletApi.walletEntries as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ entries: [], total: 0, limit: 20, offset: 0 });
    renderWalletPage();
    expect(await screen.findByText('No records')).toBeInTheDocument();
    expect(
      screen.getByText('Your wallet activity will appear here.'),
    ).toBeInTheDocument();
  });

  it('shows empty state when there are no wallets', async () => {
    (mockedWalletApi.listWallets as ReturnType<typeof vi.fn>).mockResolvedValue(
      [],
    );
    renderWalletPage();
    expect(await screen.findByText('No wallet yet')).toBeInTheDocument();
  });

  it('shows market gate on 403 market error', async () => {
    (mockedWalletApi.listWallets as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(403, { code: 'MARKET_ACCESS_DENIED', message: 'No market' }),
    );
    renderWalletPage();
    expect(
      await screen.findByText('Market access required'),
    ).toBeInTheDocument();
    expect(screen.getByText('Select market')).toBeInTheDocument();
  });

  it('shows retry on generic error', async () => {
    (mockedWalletApi.listWallets as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(0, { message: 'Network failure' }),
    );
    renderWalletPage();
    expect(
      await screen.findByText('Failed to load wallet'),
    ).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('shows loading skeleton while fetching', async () => {
    let resolveWallets: (value: unknown) => void = () => {};
    (mockedWalletApi.listWallets as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        resolveWallets = resolve;
      }),
    );
    renderWalletPage();
    expect(await screen.findByLabelText('Loading...')).toBeInTheDocument();
    resolveWallets(MOCK_WALLETS);
    await waitFor(() => {
      expect(screen.getByTestId('wallet-balance-card')).toBeInTheDocument();
    });
  });

  it('links to the reward page from the reward summary card', async () => {
    const user = userEvent.setup();
    renderWalletPage();
    expect(await screen.findByText('Reward activity')).toBeInTheDocument();
    await user.click(screen.getByText('View rewards'));
    expect(await screen.findByText('Rewards page')).toBeInTheDocument();
  });
});

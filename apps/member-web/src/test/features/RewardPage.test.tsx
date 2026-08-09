// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@ipoint/api-client';
import { RewardPage } from '../../pages/RewardPage';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'reward.title': 'Rewards',
        'reward.subtitle': 'Your iPoint reward activity',
        'reward.statusFilterLabel': 'Status',
        'reward.statusFilterAll': 'All statuses',
        'reward.status.SCHEDULED': 'Scheduled',
        'reward.status.ACTIVE': 'Active',
        'reward.status.CAPPED': 'Capped',
        'reward.status.SUSPENDED': 'Suspended',
        'reward.status.REVERSED': 'Reversed',
        'reward.status.COMPLETED': 'Completed',
        'reward.totalEarned': 'Total earned',
        'reward.capAmount': 'Cap',
        'reward.createdAt': 'Created',
        'reward.activatedAt': 'Activated',
        'reward.noPlans': 'No reward activity yet',
        'reward.noPlansDescription':
          'Rewards earned from your purchases will appear here.',
        'reward.loadError': 'Failed to load rewards',
        'reward.pageOf': 'Page {page} of {total}',
        'reward.previous': 'Previous',
        'reward.next': 'Next',
        'errors.marketAccess': 'Market access required',
        'errors.marketAccessDescription': 'Select a market to view this page.',
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

import { memberRewardApi as mockedRewardApi } from '../../api/client';

const MOCK_PLANS = {
  items: [
    {
      id: 'plan-1',
      sourceType: 'TRANSACTION',
      sourceId: 'tx-1',
      memberId: 'member-1',
      marketId: 'market-my',
      merchantId: 'merchant-1',
      status: 'ACTIVE',
      totalEarned: '15.0000000000',
      capAmount: '100.0000000000',
      snapshot: null,
      ruleVersionId: 'rule-1',
      activatedAt: '2026-07-01T00:00:00.000Z',
      completedAt: null,
      reversedAt: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    {
      id: 'plan-2',
      sourceType: 'TRANSACTION',
      sourceId: 'tx-2',
      memberId: 'member-1',
      marketId: 'market-my',
      merchantId: 'merchant-2',
      status: 'COMPLETED',
      totalEarned: '3.5000000000',
      capAmount: null,
      snapshot: null,
      ruleVersionId: 'rule-1',
      activatedAt: null,
      completedAt: '2026-07-15T00:00:00.000Z',
      reversedAt: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

function renderRewardPage() {
  return render(
    <MemoryRouter initialEntries={['/reward']}>
      <RewardPage />
    </MemoryRouter>,
  );
}

describe('RewardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockedRewardApi.plans as ReturnType<typeof vi.fn>).mockResolvedValue(
      MOCK_PLANS,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders reward plans with exact decimal amounts', async () => {
    renderRewardPage();
    const rows = await screen.findAllByTestId('reward-plan-row');
    expect(rows).toHaveLength(2);
    // '15.0000000000' -> '15', '3.5000000000' -> '3.5'
    expect(rows[0]!.textContent).toContain('15');
    expect(rows[0]!.textContent).toContain('100');
    expect(rows[0]!.textContent).toContain('Active');
    expect(rows[0]!.textContent).toContain('TRANSACTION');
    expect(rows[1]!.textContent).toContain('3.5');
    expect(rows[1]!.textContent).toContain('Completed');
  });

  it('passes status filter to the client', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    renderRewardPage();
    await screen.findAllByTestId('reward-plan-row');
    const select = screen.getByLabelText('Status');
    await user.selectOptions(select, 'ACTIVE');
    const plansMock = mockedRewardApi.plans as ReturnType<typeof vi.fn>;
    expect(plansMock).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      status: 'ACTIVE',
    });
  });

  it('shows empty state when there are no plans', async () => {
    (mockedRewardApi.plans as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
    renderRewardPage();
    expect(
      await screen.findByText('No reward activity yet'),
    ).toBeInTheDocument();
  });

  it('shows market gate on 403 market error', async () => {
    (mockedRewardApi.plans as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(403, { code: 'MARKET_ACCESS_DENIED', message: 'No market' }),
    );
    renderRewardPage();
    expect(
      await screen.findByText('Market access required'),
    ).toBeInTheDocument();
  });

  it('shows retry on generic error', async () => {
    (mockedRewardApi.plans as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(0, { message: 'Network failure' }),
    );
    renderRewardPage();
    expect(
      await screen.findByText('Failed to load rewards'),
    ).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('shows loading skeleton while fetching', async () => {
    (mockedRewardApi.plans as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}),
    );
    renderRewardPage();
    expect(await screen.findByLabelText('Loading...')).toBeInTheDocument();
  });
});

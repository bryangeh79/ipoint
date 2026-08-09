// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@ipoint/api-client';
import { TeamPage } from '../../pages/TeamPage';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'team.title': 'My Team',
        'team.subtitle': 'Referrals, agent status and commissions',
        'team.referralTitle': 'Referral',
        'team.referralCode': 'My referral code',
        'team.copyCode': 'Copy',
        'team.copied': 'Copied',
        'team.referrer': 'Referred by',
        'team.noReferrer': 'No referrer',
        'team.agentBadge': 'Agent',
        'team.directReferrals': 'Direct referrals (G1)',
        'team.indirectReferrals': 'Indirect referrals (G2)',
        'team.g1Agents': 'Direct agents',
        'team.g2Agents': 'Indirect agents',
        'team.agentStatusTitle': 'Agent status',
        'team.agentStatus.ACTIVE': 'Active',
        'team.agentStatus.NOT_APPLIED': 'Not applied',
        'team.agentStatus.PENDING_PAYMENT': 'Pending payment',
        'team.agentStatus.PAYMENT_CONFIRMED': 'Payment confirmed',
        'team.agentStatus.COURSE_PENDING': 'Course pending',
        'team.agentStatus.COURSE_COMPLETED': 'Course completed',
        'team.agentStatus.PENDING_APPROVAL': 'Pending approval',
        'team.agentStatus.SUSPENDED': 'Suspended',
        'team.agentStatus.DEACTIVATED': 'Deactivated',
        'team.agentStatus.REJECTED': 'Rejected',
        'team.notApplied': 'Not applied',
        'team.notAppliedDescription':
          'You have not applied for agent activation yet.',
        'team.activationFee': 'Activation fee',
        'team.activatedAt': 'Activated',
        'team.commissionSummary': 'Commission summary',
        'team.summaryUnavailable': 'Commission summary unavailable',
        'team.summaryUnavailableDescription':
          'The commission summary could not be loaded right now.',
        'team.marketTotal': 'Earned - {market}',
        'team.entryCount': '{count} entries',
        'team.grandTotal': 'Grand total',
        'team.commissionLedger': 'Commission ledger',
        'team.noCommission': 'No commission entries yet',
        'team.noCommissionDescription':
          'Commissions from your referrals will appear here.',
        'team.showing': 'Showing {from}-{to} of {total}',
        'team.pageOf': 'Page {page} of {total}',
        'team.previous': 'Previous',
        'team.next': 'Next',
        'team.loadError': 'Failed to load your team data',
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

import { memberTeamApi as mockedTeamApi } from '../../api/client';

const MOCK_TREE = {
  myCode: 'ABCD1234',
  referrer: { maskedReference: 'AB***', isAgent: true },
  referrals: { g1Count: 2, g2Count: 5, g1Agents: 1, g2Agents: 2 },
};

const MOCK_AGENT_STATUS = {
  activationId: 'act-1',
  status: 'ACTIVE',
  market: 'MY',
  activatedAt: '2026-07-01T00:00:00.000Z',
  currency: 'MYR',
  feeRateVersionId: 'rate-1',
  activationFee: '100.0000000000',
  activationFeeCurrency: 'MYR',
  paymentReference: 'PAY-1',
  courseReference: 'CRS-1',
  rejectionReason: null,
  revocationReason: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const MOCK_SUMMARY = {
  memberId: 'member-1',
  markets: [
    {
      market: 'MY',
      currency: 'MYR',
      totalEarned: '250.0000000000',
      entryCount: 3,
    },
    {
      market: 'SG',
      currency: 'SGD',
      totalEarned: '10.0000000000',
      entryCount: 1,
    },
  ],
  grandTotal: '260.0000000000',
  currency: 'MYR',
};

const MOCK_LEDGER = {
  entries: [
    {
      id: 'ledger-1',
      publicReference: 'REF-1001',
      beneficiaryId: 'member-1',
      sourceType: 'AGENT_UPGRADE',
      sourceReference: 'src-1',
      market: 'MY',
      currency: 'MYR',
      amount: '50.0000000000',
      generation: 1,
      entryType: 'COMMISSION',
      postingStatus: 'EARNED',
      effectiveTime: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
      reversalLinkage: null,
      auditLinkage: null,
      notes: null,
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

function renderTeamPage() {
  return render(
    <MemoryRouter initialEntries={['/team']}>
      <TeamPage />
    </MemoryRouter>,
  );
}

describe('TeamPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockedTeamApi.referralTree as ReturnType<typeof vi.fn>).mockResolvedValue(
      MOCK_TREE,
    );
    (mockedTeamApi.agentStatus as ReturnType<typeof vi.fn>).mockResolvedValue(
      MOCK_AGENT_STATUS,
    );
    (
      mockedTeamApi.commissionSummary as ReturnType<typeof vi.fn>
    ).mockResolvedValue(MOCK_SUMMARY);
    (
      mockedTeamApi.commissionLedger as ReturnType<typeof vi.fn>
    ).mockResolvedValue(MOCK_LEDGER);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders referral code and anonymized tree counts', async () => {
    renderTeamPage();
    expect(await screen.findByTestId('team-referral-code')).toHaveTextContent(
      'ABCD1234',
    );
    expect(screen.getByText('AB***')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    const counts = screen.getByTestId('team-referral-counts');
    expect(counts.textContent).toContain('2');
    expect(counts.textContent).toContain('5');
    expect(counts.textContent).toContain('1');
  });

  it('renders agent status with exact activation fee', async () => {
    renderTeamPage();
    const status = await screen.findByTestId('team-agent-status');
    expect(status.textContent).toContain('Active');
    expect(status.textContent).toContain('MYR 100');
    expect(status.textContent).toContain('MY');
  });

  it('shows not-applied state when agent status is null', async () => {
    (mockedTeamApi.agentStatus as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );
    renderTeamPage();
    expect(await screen.findByText('Not applied')).toBeInTheDocument();
    expect(
      screen.getByText('You have not applied for agent activation yet.'),
    ).toBeInTheDocument();
  });

  it('renders commission summary with exact grand total', async () => {
    renderTeamPage();
    const summary = await screen.findByTestId('team-commission-summary');
    // '260.0000000000' -> '260', '250.0000000000' -> '250', '10.0000000000' -> '10'
    expect(summary.textContent).toContain('MYR 260');
    expect(summary.textContent).toContain('MYR 250');
    expect(summary.textContent).toContain('SGD 10');
  });

  it('renders commission ledger entries with exact amounts', async () => {
    renderTeamPage();
    const rows = await screen.findAllByTestId('team-ledger-entry');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('REF-1001');
    expect(rows[0]!.textContent).toContain('EARNED');
    expect(rows[0]!.textContent).toContain('MYR 50');
    expect(rows[0]!.textContent).toContain('AGENT_UPGRADE');
  });

  it('shows empty state for commission ledger without rows', async () => {
    (
      mockedTeamApi.commissionLedger as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      entries: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
    renderTeamPage();
    expect(
      await screen.findByText('No commission entries yet'),
    ).toBeInTheDocument();
  });

  it('shows market gate on referral 403 market error', async () => {
    (mockedTeamApi.referralTree as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(403, { code: 'MARKET_ACCESS_DENIED', message: 'No market' }),
    );
    renderTeamPage();
    expect(
      await screen.findByText('Market access required'),
    ).toBeInTheDocument();
  });

  it('shows retry on referral error', async () => {
    (mockedTeamApi.referralTree as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(0, { message: 'Network failure' }),
    );
    renderTeamPage();
    expect(
      await screen.findByText('Failed to load your team data'),
    ).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});

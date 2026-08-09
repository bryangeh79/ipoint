// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@ipoint/api-client';
import { RedemptionPage } from '../../pages/RedemptionPage';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'redemption.title': 'Redemption Center',
        'redemption.subtitle': 'Redeem your iPoint points',
        'redemption.catalogueTitle': 'Catalogue',
        'redemption.noItems': 'No items available',
        'redemption.noItemsDescription':
          'Redeemable items for your market will appear here.',
        'redemption.featured': 'Featured',
        'redemption.itemType.PHYSICAL': 'Physical',
        'redemption.itemType.DIGITAL_VOUCHER': 'Digital voucher',
        'redemption.itemType.SERVICE': 'Service',
        'redemption.fulfilmentMode.DELIVERY': 'Delivery',
        'redemption.fulfilmentMode.PICKUP': 'Pickup',
        'redemption.fulfilmentMode.DELIVERY_OR_PICKUP': 'Delivery or pickup',
        'redemption.fulfilmentMode.DIGITAL': 'Digital',
        'redemption.fulfilmentMode.SERVICE': 'Service',
        'redemption.fiatReference': 'Reference value',
        'redemption.loadError': 'Failed to load the catalogue',
        'redemption.pageOf': 'Page {page} of {total}',
        'redemption.previous': 'Previous',
        'redemption.next': 'Next',
        'redemption.closeDetail': 'Close',
        'redemption.detailLoadError': 'Item details unavailable',
        'redemption.detailLoadErrorDescription':
          'The item details could not be loaded. Please try again.',
        'redemption.selectQuantity': 'Quantity',
        'redemption.quotePoints': 'You will spend',
        'redemption.quoteExpires': 'Quote expires at {time}',
        'redemption.quoteFailed': 'Quote unavailable',
        'redemption.quoteFailedDescription':
          'A quote could not be generated for this item right now.',
        'redemption.termsLabel': 'Terms',
        'redemption.acceptTerms': 'I accept the redemption terms',
        'redemption.termsRequired': 'You must accept the terms to continue',
        'redemption.confirmOrder': 'Confirm order',
        'redemption.confirming': 'Confirming...',
        'redemption.orderAgain': 'Confirm another order',
        'redemption.orderFailed': 'Order could not be confirmed',
        'redemption.orderSuccess': 'Order confirmed',
        'redemption.orderReference': 'Order reference',
        'redemption.orderStatus': 'Status',
        'redemption.orderPoints': 'Points',
        'redemption.deliveryNotAvailable':
          'Delivery checkout is not available in this view',
        'redemption.deliveryNotAvailableDescription':
          'Delivery orders require the shipping payment flow which is not exposed to the member web surface. Pickup fulfilment is available for qualifying items.',
        'redemption.myOrders': 'My orders',
        'redemption.historyUnavailable': 'Order history is not available yet',
        'redemption.historyUnavailableDescription':
          'Your confirmed orders are being processed. Order history will appear here once the member order-history surface is available.',
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

import { memberRedemptionApi as mockedRedemptionApi } from '../../api/client';

const MOCK_CATALOG = {
  items: [
    {
      id: 'item-1',
      name: 'Gift Card',
      sku: 'GC-001',
      itemType: 'DIGITAL_VOUCHER',
      fiatReferenceValue: '50.0000000000',
      fiatCurrency: 'MYR',
      inventoryMode: 'UNLIMITED',
      fulfilmentMode: 'PICKUP',
      imageUrl: null,
      tags: ['gift'],
      isFeatured: false,
      sortOrder: 1,
    },
    {
      id: 'item-2',
      name: 'Delivery Hamper',
      sku: 'HP-001',
      itemType: 'PHYSICAL',
      fiatReferenceValue: '120.0000000000',
      fiatCurrency: 'MYR',
      inventoryMode: 'TRACKED',
      fulfilmentMode: 'DELIVERY',
      imageUrl: null,
      tags: [],
      isFeatured: false,
      sortOrder: 2,
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
};

const MOCK_DETAIL = {
  id: 'item-1',
  marketId: 'market-my',
  name: 'Gift Card',
  description: 'A digital gift card.',
  itemType: 'DIGITAL_VOUCHER',
  fiatReferenceValue: '50.0000000000',
  fiatCurrency: 'MYR',
  inventoryMode: 'UNLIMITED',
  imageUrl: null,
  terms: 'Redemption terms v1',
  fulfilmentMode: 'PICKUP',
  tags: ['gift'],
  isFeatured: false,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveUntil: null,
  version: 3,
};

const MOCK_QUOTE = {
  quoteId: 'quote-1',
  catalogItemId: 'item-1',
  marketId: 'market-my',
  rateVersionId: 'rate-1',
  rateSnapshot: {
    rateVersionId: 'rate-1',
    rateType: 'POINTS_PER_CURRENCY',
    rateValue: '20',
  },
  unroundedPointCost: '1000.0000000000',
  postedPointCost: '1000.0000000000',
  quantity: 1,
  payloadHash: 'hash-1',
  expiresAt: '2026-08-09T12:00:00.000Z',
  createdAt: '2026-08-09T11:45:00.000Z',
};

const MOCK_ORDER = {
  id: 'order-1',
  orderReference: 'RDM-ABC123',
  marketId: 'market-my',
  memberId: 'member-1',
  itemId: 'item-1',
  walletAccountId: 'wallet-1',
  walletEntryId: 'entry-1',
  quoteId: 'quote-1',
  status: 'CONFIRMED',
  totalPointCost: '1000.0000000000',
  quantity: '1',
  backorderQuantity: '0',
  itemSnapshot: {},
  rateSnapshot: {},
  idempotencyKey: 'idem-key',
  confirmedAt: '2026-08-09T11:46:00.000Z',
  createdAt: '2026-08-09T11:46:00.000Z',
};

function renderRedemptionPage() {
  return render(
    <MemoryRouter initialEntries={['/redemption']}>
      <RedemptionPage />
    </MemoryRouter>,
  );
}

describe('RedemptionPage', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
    (mockedRedemptionApi.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
      MOCK_CATALOG,
    );
    (
      mockedRedemptionApi.itemDetail as ReturnType<typeof vi.fn>
    ).mockResolvedValue(MOCK_DETAIL);
    (mockedRedemptionApi.quote as ReturnType<typeof vi.fn>).mockResolvedValue(
      MOCK_QUOTE,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the catalogue with reference values as exact strings', async () => {
    renderRedemptionPage();
    const items = await screen.findAllByTestId('redemption-catalogue-item');
    expect(items).toHaveLength(2);
    expect(screen.getByText('Gift Card')).toBeInTheDocument();
    // '50.0000000000' -> '50', '120.0000000000' -> '120'
    expect(screen.getByText('MYR 50')).toBeInTheDocument();
    expect(screen.getByText('MYR 120')).toBeInTheDocument();
    expect(screen.getByText('Digital voucher')).toBeInTheDocument();
    expect(screen.getByText('Delivery')).toBeInTheDocument();
  });

  it('shows the order-history unavailable note (no member read endpoint)', async () => {
    renderRedemptionPage();
    expect(
      await screen.findByTestId('redemption-history-unavailable'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Order history is not available yet'),
    ).toBeInTheDocument();
  });

  it('submits an order with the owner payload and an idempotency key', async () => {
    const confirmMock = (
      mockedRedemptionApi.confirmOrder as ReturnType<typeof vi.fn>
    ).mockResolvedValue(MOCK_ORDER);
    renderRedemptionPage();
    await screen.findAllByTestId('redemption-catalogue-item');

    await user.click(screen.getByText('Gift Card'));
    // Quote appears with exact posted point cost '1000.0000000000' -> '1000'
    await waitFor(() => {
      expect(screen.getByTestId('redemption-quote').textContent).toContain(
        '1000',
      );
    });
    expect(screen.getByText('Redemption terms v1')).toBeInTheDocument();

    await user.click(screen.getByTestId('redemption-terms-checkbox'));
    await user.click(screen.getByTestId('redemption-confirm'));

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledTimes(1);
    });
    const payload = confirmMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.quoteId).toBe('quote-1');
    expect(typeof payload.idempotencyKey).toBe('string');
    expect((payload.idempotencyKey as string).length).toBeGreaterThan(0);
    expect(payload.expectedItemVersion).toBe(3);
    expect(payload.expectedTotalPoints).toBe('1000.0000000000');
    expect(payload.expectedQuantity).toBe('1');
    expect(payload.fulfilment).toEqual({ type: 'PICKUP' });
    expect(payload.termsAcceptance).toEqual({
      accepted: true,
      termsVersion: '1.0',
    });

    // Success state shows the order reference
    expect(
      await screen.findByTestId('redemption-order-success'),
    ).toBeInTheDocument();
    expect(screen.getByText('RDM-ABC123')).toBeInTheDocument();
  });

  it('does not double-submit when the button is clicked twice', async () => {
    let resolveOrder: (value: unknown) => void = () => {};
    const confirmMock = (
      mockedRedemptionApi.confirmOrder as ReturnType<typeof vi.fn>
    ).mockReturnValue(
      new Promise((resolve) => {
        resolveOrder = resolve;
      }),
    );
    renderRedemptionPage();
    await screen.findAllByTestId('redemption-catalogue-item');
    await user.click(screen.getByText('Gift Card'));
    await waitFor(() => {
      expect(screen.getByTestId('redemption-quote')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('redemption-terms-checkbox'));
    await user.click(screen.getByTestId('redemption-confirm'));
    await user.click(screen.getByTestId('redemption-confirm'));
    expect(confirmMock).toHaveBeenCalledTimes(1);
    resolveOrder(MOCK_ORDER);
    expect(
      await screen.findByTestId('redemption-order-success'),
    ).toBeInTheDocument();
  });

  it('reuses the same idempotency key on retry after failure', async () => {
    const confirmMock = (
      mockedRedemptionApi.confirmOrder as ReturnType<typeof vi.fn>
    )
      .mockRejectedValueOnce(
        new ApiError(409, {
          code: 'REDEMPTION_BALANCE_INSUFFICIENT',
          message: 'Low balance',
        }),
      )
      .mockResolvedValueOnce(MOCK_ORDER);
    renderRedemptionPage();
    await screen.findAllByTestId('redemption-catalogue-item');
    await user.click(screen.getByText('Gift Card'));
    await waitFor(() => {
      expect(screen.getByTestId('redemption-quote')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('redemption-terms-checkbox'));
    await user.click(screen.getByTestId('redemption-confirm'));

    await waitFor(() => {
      expect(
        screen.getByText('Order could not be confirmed'),
      ).toBeInTheDocument();
    });
    expect(confirmMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('redemption-confirm'));
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledTimes(2);
    });
    const firstKey = (
      confirmMock.mock.calls[0]![0] as { idempotencyKey: string }
    ).idempotencyKey;
    const secondKey = (
      confirmMock.mock.calls[1]![0] as { idempotencyKey: string }
    ).idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });

  it('blocks submission when terms are not accepted', async () => {
    const confirmMock = (
      mockedRedemptionApi.confirmOrder as ReturnType<typeof vi.fn>
    ).mockResolvedValue(MOCK_ORDER);
    renderRedemptionPage();
    await screen.findAllByTestId('redemption-catalogue-item');
    await user.click(screen.getByText('Gift Card'));
    await waitFor(() => {
      expect(screen.getByTestId('redemption-quote')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('redemption-confirm'));
    await waitFor(() => {
      expect(
        screen.getByText('You must accept the terms to continue'),
      ).toBeInTheDocument();
    });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('shows the delivery-unavailable note and no confirm button for delivery-only items', async () => {
    (
      mockedRedemptionApi.itemDetail as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      ...MOCK_DETAIL,
      id: 'item-2',
      name: 'Delivery Hamper',
      fulfilmentMode: 'DELIVERY',
    });
    renderRedemptionPage();
    await screen.findAllByTestId('redemption-catalogue-item');
    await user.click(screen.getByText('Delivery Hamper'));
    expect(
      await screen.findByTestId('redemption-delivery-unavailable'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('redemption-confirm')).not.toBeInTheDocument();
  });

  it('shows empty state when the catalogue has no items', async () => {
    (mockedRedemptionApi.catalog as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      },
    );
    renderRedemptionPage();
    expect(await screen.findByText('No items available')).toBeInTheDocument();
  });

  it('shows market gate on catalogue 403 market error', async () => {
    (mockedRedemptionApi.catalog as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(403, { code: 'MARKET_ACCESS_DENIED', message: 'No market' }),
    );
    renderRedemptionPage();
    expect(
      await screen.findByText('Market access required'),
    ).toBeInTheDocument();
  });

  it('shows retry on catalogue error', async () => {
    (mockedRedemptionApi.catalog as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(0, { message: 'Network failure' }),
    );
    renderRedemptionPage();
    expect(
      await screen.findByText('Failed to load the catalogue'),
    ).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('starts a fresh order attempt after success ("Confirm another order")', async () => {
    const confirmMock = (
      mockedRedemptionApi.confirmOrder as ReturnType<typeof vi.fn>
    ).mockResolvedValue(MOCK_ORDER);
    renderRedemptionPage();
    await screen.findAllByTestId('redemption-catalogue-item');
    await user.click(screen.getByText('Gift Card'));
    await waitFor(() => {
      expect(screen.getByTestId('redemption-quote')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('redemption-terms-checkbox'));
    await user.click(screen.getByTestId('redemption-confirm'));
    expect(
      await screen.findByTestId('redemption-order-success'),
    ).toBeInTheDocument();

    // The success-state button closes the checkout so the next selection
    // starts a brand-new logical order attempt (new quote, new key).
    await user.click(screen.getByTestId('redemption-confirm'));
    await waitFor(() => {
      expect(
        screen.queryByTestId('redemption-checkout'),
      ).not.toBeInTheDocument();
    });
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });
});

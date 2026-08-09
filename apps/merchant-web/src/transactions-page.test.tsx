// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@ipoint/api-client';
import type {
  MerchantTransactionConfirmDto,
  MerchantTransactionListPageDto,
  MerchantTransactionPreviewDto,
} from '@ipoint/api-client';
import { TransactionsPage } from './transactions-page';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  preview: vi.fn(),
  confirm: vi.fn(),
  api: {
    tokens: undefined as unknown,
    request: vi.fn(),
    login: vi.fn(),
    clearSession: vi.fn(),
    attemptSessionRestore: vi.fn(),
  },
}));

vi.mock('./api/client', () => ({
  api: mocks.api,
  merchantTransactionApi: {
    list: mocks.list,
    detail: mocks.detail,
    preview: mocks.preview,
    confirm: mocks.confirm,
  },
}));

const CONTEXT = { branchId: 'branch-1', marketId: 'market-1' };

const MOCK_HISTORY: MerchantTransactionListPageDto = {
  items: [
    {
      transactionNumber: '42',
      status: 'CONFIRMED',
      merchant: {
        merchantId: 'm-1',
        merchantName: 'Kopitiam',
        branchName: 'Main',
      },
      member: { maskedReference: 'M-****-1234', displayName: null },
      market: { marketCode: 'MY' },
      currency: 'MYR',
      purchaseAmount: '120.5000000000',
      package: { packageName: 'Standard', serviceFeeRate: '10.0000000000' },
      serviceFeeAmount: '12.0500000000',
      reward: {
        rewardRate: '1.0000000000',
        dailyRewardAmount: '1.2050000000',
        rewardCap: '10.0000000000',
        rewardStartBusinessDate: '2026-08-10',
      },
      merchantReceiptNumber: null,
      transactionNote: null,
      transactionTime: '2026-08-10T00:30:00.000Z',
      mcpDeducted: '12.0500000000',
      mcpBalanceAfter: '112.9500000000',
    },
    {
      transactionNumber: '41',
      status: 'CONFIRMED',
      merchant: {
        merchantId: 'm-1',
        merchantName: 'Kopitiam',
        branchName: 'Main',
      },
      member: { maskedReference: 'M-****-5678', displayName: 'Ali' },
      market: { marketCode: 'MY' },
      currency: 'MYR',
      purchaseAmount: '88.0000000000',
      package: { packageName: 'Standard', serviceFeeRate: '10.0000000000' },
      serviceFeeAmount: '8.8000000000',
      reward: {
        rewardRate: '1.0000000000',
        dailyRewardAmount: '0.8800000000',
        rewardCap: '10.0000000000',
        rewardStartBusinessDate: '2026-08-10',
      },
      merchantReceiptNumber: 'R-001',
      transactionNote: 'Lunch',
      transactionTime: '2026-08-09T12:00:00.000Z',
      mcpDeducted: '8.8000000000',
      mcpBalanceAfter: '121.2000000000',
    },
  ],
  nextCursor: null,
};

const MOCK_PREVIEW: MerchantTransactionPreviewDto = {
  previewSessionId: 'session-1',
  protectedMemberReference: 'M-****-1234',
  amount: '120.5000000000',
  currency: 'MYR',
  selectedPackage: { name: 'Standard', rate: '10.0000000000' },
  serviceFeeRate: '10.0000000000',
  estimatedMcpDebit: '12.0500000000',
  currentMcpBalance: '125.0000000000',
  estimatedMcpBalanceAfter: '112.9500000000',
  mcpSufficient: true,
  confirmAllowed: true,
  mcpShortfall: '0.0000000000',
  rewardRate: '1.0000000000',
  expectedDailyRewardAmount: '1.2050000000',
  rewardCap: '10.0000000000',
  rewardStartDate: '2026-08-10',
  transactionMarket: { code: 'MY', timezone: 'Asia/Kuala_Lumpur' },
  previewExpiresAt: '2026-08-10T02:00:00.000Z',
};

const MOCK_CONFIRM: MerchantTransactionConfirmDto = {
  transactionNumber: '43',
  status: 'CONFIRMED',
  transactionTime: '2026-08-10T00:45:00.000Z',
  merchant: {
    merchantId: 'm-1',
    merchantName: 'Kopitiam',
    branchName: 'Main',
  },
  market: { marketCode: 'MY' },
  currency: 'MYR',
  amount: '120.5000000000',
  serviceFee: '12.0500000000',
  mcpDeducted: '12.0500000000',
  mcpBalanceAfter: '112.9500000000',
  dailyRewardAmount: '1.2050000000',
  rewardCap: '10.0000000000',
  rewardStartBusinessDate: '2026-08-10',
  receiptData: {
    transactionNumber: '43',
    status: 'CONFIRMED',
    merchant: {
      merchantId: 'm-1',
      merchantName: 'Kopitiam',
      branchName: 'Main',
    },
    member: { maskedReference: 'M-****-1234', displayName: null },
    market: { marketCode: 'MY' },
    currency: 'MYR',
    purchaseAmount: '120.5000000000',
    package: { packageName: 'Standard', serviceFeeRate: '10.0000000000' },
    serviceFeeAmount: '12.0500000000',
    reward: {
      rewardRate: '1.0000000000',
      dailyRewardAmount: '1.2050000000',
      rewardCap: '10.0000000000',
      rewardStartBusinessDate: '2026-08-10',
    },
    merchantReceiptNumber: null,
    transactionNote: null,
    transactionTime: '2026-08-10T00:45:00.000Z',
  },
};

const listMock = mocks.list as ReturnType<typeof vi.fn>;
const detailMock = mocks.detail as ReturnType<typeof vi.fn>;
const previewMock = mocks.preview as ReturnType<typeof vi.fn>;
const confirmMock = mocks.confirm as ReturnType<typeof vi.fn>;

function renderTransactionsPage() {
  return render(<TransactionsPage context={CONTEXT} />);
}

async function goToPreview(user: ReturnType<typeof userEvent.setup>) {
  renderTransactionsPage();
  await user.click(
    await screen.findByRole('button', { name: 'New transaction' }),
  );
  await user.type(screen.getByLabelText('Amount'), '120.50');
  await user.type(screen.getByLabelText('Member QR token'), 'qr-member-1');
  await user.click(screen.getByRole('button', { name: 'Preview transaction' }));
  await screen.findByTestId('transaction-preview-quote');
}

describe('TransactionsPage', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
    listMock.mockResolvedValue(MOCK_HISTORY);
    previewMock.mockResolvedValue(MOCK_PREVIEW);
    confirmMock.mockResolvedValue(MOCK_CONFIRM);
    detailMock.mockResolvedValue(MOCK_CONFIRM.receiptData);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the history list with exact amount strings', async () => {
    renderTransactionsPage();
    const rows = await screen.findAllByTestId('transaction-history-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('42');
    // '120.5000000000' -> '120.5' and '88.0000000000' -> '88' (display-only trim)
    expect(rows[0]?.textContent).toContain('MYR 120.5');
    expect(rows[1]?.textContent).toContain('MYR 88');
    expect(rows[0]?.textContent).toContain('M-****-1234');
    expect(rows[1]?.textContent).toContain('M-****-5678');
    expect(rows[0]?.textContent).toContain('CONFIRMED');
    expect(listMock).toHaveBeenCalledWith({ limit: 20 });
  });

  it('shows the explicit empty state when there are no transactions', async () => {
    listMock.mockResolvedValue({ items: [], nextCursor: null });
    renderTransactionsPage();
    expect(
      await screen.findByTestId('transaction-history-empty'),
    ).toBeInTheDocument();
    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
  });

  it('shows the market gate on a 403 market error', async () => {
    listMock.mockRejectedValue(
      new ApiError(403, {
        code: 'MARKET_ACCESS_DENIED',
        message: 'Market access is denied for this account.',
      }),
    );
    renderTransactionsPage();
    expect(await screen.findByText('Market access denied')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('shows retry on a generic list error', async () => {
    listMock.mockRejectedValue(new ApiError(0, { message: 'Network failure' }));
    renderTransactionsPage();
    expect(await screen.findByText('You are offline')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('loads the next page with the server cursor', async () => {
    listMock
      .mockResolvedValueOnce({
        items: [MOCK_HISTORY.items[0]],
        nextCursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        items: [MOCK_HISTORY.items[1]],
        nextCursor: null,
      });
    renderTransactionsPage();
    await screen.findAllByTestId('transaction-history-row');
    await user.click(screen.getByTestId('transaction-load-more'));
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });
    expect(listMock.mock.calls[1]).toEqual([{ limit: 20, cursor: 'cursor-2' }]);
    const rows = await screen.findAllByTestId('transaction-history-row');
    expect(rows).toHaveLength(2);
    expect(
      screen.queryByTestId('transaction-load-more'),
    ).not.toBeInTheDocument();
  });

  it('opens a receipt from the history list via the detail endpoint', async () => {
    renderTransactionsPage();
    await screen.findAllByTestId('transaction-history-row');
    const firstRow = screen.getAllByTestId('transaction-history-row')[0]!;
    await user.click(
      within(firstRow).getByRole('button', { name: 'View receipt' }),
    );
    expect(
      await screen.findByTestId('transaction-receipt'),
    ).toBeInTheDocument();
    expect(detailMock).toHaveBeenCalledWith('42');
    expect(screen.getByText('M-****-1234')).toBeInTheDocument();
    // receipt shows exact amounts
    expect(screen.getByText('MYR 120.5')).toBeInTheDocument();
    expect(screen.getByText('MYR 12.05')).toBeInTheDocument();
  });

  it('submits the preview form with the market id and an idempotency key', async () => {
    await goToPreview(user);
    const call = previewMock.mock.calls[0] as [
      Record<string, unknown>,
      string,
      string,
    ];
    expect(call[0]).toEqual({
      amount: '120.50',
      memberQrToken: 'qr-member-1',
    });
    expect(call[1]).toBe(CONTEXT.marketId);
    expect(typeof call[2]).toBe('string');
    expect(call[2].length).toBeGreaterThan(0);
  });

  it('shows the server quote with exact decimal amounts', async () => {
    await goToPreview(user);
    const quote = screen.getByTestId('transaction-preview-quote');
    // '120.5000000000' -> '120.5', '125.0000000000' -> '125'
    expect(quote.textContent).toContain('MYR 120.5');
    expect(quote.textContent).toContain('MYR 125');
    expect(quote.textContent).toContain('MYR 12.05');
    expect(quote.textContent).toContain('MYR 112.95');
    expect(quote.textContent).toContain('M-****-1234');
    expect(quote.textContent).toContain('10%');
  });

  it('confirms with the same attempt key and shows the receipt', async () => {
    await goToPreview(user);
    await user.click(screen.getByTestId('transaction-confirm'));
    expect(
      await screen.findByTestId('transaction-receipt'),
    ).toBeInTheDocument();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    const call = confirmMock.mock.calls[0] as [string, unknown, string];
    expect(call[0]).toBe('session-1');
    expect(call[1]).toEqual({});
    const previewKey = (previewMock.mock.calls[0] as unknown[])[2] as string;
    expect(call[2]).toBe(previewKey);
    // receipt content from the confirm response
    expect(screen.getByText('Receipt 43 · CONFIRMED')).toBeInTheDocument();
    expect(screen.getByText('MYR 120.5')).toBeInTheDocument();
  });

  it('does not double-submit the preview when submitted twice', async () => {
    let resolvePreview: (
      value: MerchantTransactionPreviewDto,
    ) => void = () => {};
    previewMock.mockReturnValue(
      new Promise<MerchantTransactionPreviewDto>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    renderTransactionsPage();
    await user.click(
      await screen.findByRole('button', { name: 'New transaction' }),
    );
    await user.type(screen.getByLabelText('Amount'), '10.00');
    await user.type(screen.getByLabelText('Member QR token'), 'qr-member-1');
    const submit = screen.getByRole('button', {
      name: 'Preview transaction',
    });
    await user.click(submit);
    await user.click(submit);
    expect(previewMock).toHaveBeenCalledTimes(1);
    resolvePreview(MOCK_PREVIEW);
    expect(
      await screen.findByTestId('transaction-preview-quote'),
    ).toBeInTheDocument();
  });

  it('does not double-submit the confirm when clicked twice', async () => {
    let resolveConfirm: (
      value: MerchantTransactionConfirmDto,
    ) => void = () => {};
    confirmMock.mockReturnValue(
      new Promise<MerchantTransactionConfirmDto>((resolve) => {
        resolveConfirm = resolve;
      }),
    );
    await goToPreview(user);
    const confirm = screen.getByTestId('transaction-confirm');
    await user.click(confirm);
    await user.click(confirm);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    resolveConfirm(MOCK_CONFIRM);
    expect(
      await screen.findByTestId('transaction-receipt'),
    ).toBeInTheDocument();
  });

  it('reuses the same idempotency key on retry after a failed preview', async () => {
    previewMock
      .mockRejectedValueOnce(
        new ApiError(422, {
          code: 'TRANSACTION_AMOUNT_BELOW_MINIMUM',
          message: 'Amount is below the market minimum.',
        }),
      )
      .mockResolvedValueOnce(MOCK_PREVIEW);
    renderTransactionsPage();
    await user.click(
      await screen.findByRole('button', { name: 'New transaction' }),
    );
    await user.type(screen.getByLabelText('Amount'), '1.00');
    await user.type(screen.getByLabelText('Member QR token'), 'qr-member-1');
    const submit = screen.getByRole('button', {
      name: 'Preview transaction',
    });
    await user.click(submit);
    await waitFor(() => {
      expect(previewMock).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByText('Check the highlighted information'),
    ).toBeInTheDocument();
    // fix the amount and retry with the same key
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '120.50');
    await user.click(submit);
    expect(
      await screen.findByTestId('transaction-preview-quote'),
    ).toBeInTheDocument();
    expect(previewMock).toHaveBeenCalledTimes(2);
    const firstKey = (previewMock.mock.calls[0] as unknown[])[2] as string;
    const secondKey = (previewMock.mock.calls[1] as unknown[])[2] as string;
    expect(secondKey).toBe(firstKey);
  });

  it('reuses the same idempotency key on retry after a failed confirm', async () => {
    confirmMock
      .mockRejectedValueOnce(
        new ApiError(500, {
          code: 'TRANSACTION_CONFIRMATION_FAILED',
          message: 'The confirmation could not be completed.',
        }),
      )
      .mockResolvedValueOnce(MOCK_CONFIRM);
    await goToPreview(user);
    await user.click(screen.getByTestId('transaction-confirm'));
    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByText('TRANSACTION_CONFIRMATION_FAILED'),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId('transaction-confirm'));
    expect(
      await screen.findByTestId('transaction-receipt'),
    ).toBeInTheDocument();
    expect(confirmMock).toHaveBeenCalledTimes(2);
    const firstKey = (confirmMock.mock.calls[0] as unknown[])[2] as string;
    const secondKey = (confirmMock.mock.calls[1] as unknown[])[2] as string;
    expect(secondKey).toBe(firstKey);
  });

  it('starts a fresh idempotency key after success (M-1 regression)', async () => {
    await goToPreview(user);
    const previewKey = (previewMock.mock.calls[0] as unknown[])[2] as string;
    await user.click(screen.getByTestId('transaction-confirm'));
    expect(
      await screen.findByTestId('transaction-receipt'),
    ).toBeInTheDocument();
    // success resets the attempt; the next transaction gets a new key
    await user.click(screen.getByTestId('transaction-new-attempt'));
    await user.type(screen.getByLabelText('Amount'), '50.00');
    await user.type(screen.getByLabelText('Member QR token'), 'qr-member-2');
    await user.click(
      screen.getByRole('button', { name: 'Preview transaction' }),
    );
    await screen.findByTestId('transaction-preview-quote');
    expect(previewMock).toHaveBeenCalledTimes(2);
    const secondKey = (previewMock.mock.calls[1] as unknown[])[2] as string;
    expect(secondKey).not.toBe(previewKey);
    expect(secondKey.length).toBeGreaterThan(0);
  });

  it('keeps the form usable and shows the error on a failed preview', async () => {
    previewMock.mockRejectedValue(
      new ApiError(422, {
        code: 'TRANSACTION_MEMBER_QR_INVALID',
        message: 'The member QR token is invalid or expired.',
      }),
    );
    renderTransactionsPage();
    await user.click(
      await screen.findByRole('button', { name: 'New transaction' }),
    );
    await user.type(screen.getByLabelText('Amount'), '120.50');
    await user.type(screen.getByLabelText('Member QR token'), 'bad-qr');
    await user.click(
      screen.getByRole('button', { name: 'Preview transaction' }),
    );
    expect(
      await screen.findByText('The member QR token is invalid or expired.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('transaction-preview-form')).toBeInTheDocument();
    // the attempt key is retained for retry
    expect(previewMock).toHaveBeenCalledTimes(1);
  });

  it('offers no export/download affordance and no reversal/refund actions', async () => {
    await goToPreview(user);
    await user.click(screen.getByTestId('transaction-confirm'));
    await screen.findByTestId('transaction-receipt');
    expect(screen.queryByText(/export/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/download/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reversal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/refund/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /export/i }),
    ).not.toBeInTheDocument();
  });
});

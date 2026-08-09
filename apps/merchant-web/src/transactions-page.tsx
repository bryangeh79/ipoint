import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Skeleton,
  Table,
  Textarea,
} from '@ipoint/ui';
import {
  ApiError,
  createIdempotencyKey,
  describeApiError,
  type MerchantTransactionListPageDto,
  type MerchantTransactionListItemDto,
  type MerchantTransactionPreviewDto,
  type MerchantTransactionReceiptDto,
} from '@ipoint/api-client';
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { merchantTransactionApi } from './api/client';
import { money, trimAmount } from './amount';

interface MerchantContext {
  branchId: string;
  marketId: string;
}

type TransactionsView =
  | { name: 'history' }
  | { name: 'form' }
  | { name: 'preview'; preview: MerchantTransactionPreviewDto }
  | { name: 'receipt'; receipt?: MerchantTransactionReceiptDto };

const HISTORY_PAGE_SIZE = 20;

/**
 * Merchant Transactions surface (P8-S5C): history → preview → confirm →
 * receipt over the frozen Phase 4 merchant transaction endpoints.
 *
 * Idempotency (P8-S5b M-1 lesson): ONE key per logical order attempt.
 * The key is created lazily at the first preview submit, reused on any
 * retry of the same attempt (preview or confirm), and reset after
 * confirm success (or when the user explicitly starts a new attempt),
 * so "create another transaction" always begins with a fresh key.
 * Double submission is prevented by disabling the in-flight buttons.
 */
export function TransactionsPage({ context }: { context: MerchantContext }) {
  const [view, setView] = useState<TransactionsView>({ name: 'history' });
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const [attemptKey, setAttemptKey] = useState<string>();
  const [confirmPending, setConfirmPending] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);

  const [history, setHistory] = useState<MerchantTransactionListPageDto>();
  const [historyError, setHistoryError] = useState<unknown>();
  const [historyLoading, setHistoryLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>();
  const [historyVersion, setHistoryVersion] = useState(0);

  const reloadHistory = useCallback(() => {
    setHistory(undefined);
    setHistoryError(undefined);
    setMoreError(undefined);
    setHistoryVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    setHistoryError(undefined);
    merchantTransactionApi
      .list({ limit: HISTORY_PAGE_SIZE })
      .then((page) => {
        if (active) setHistory(page);
      })
      .catch((caught: unknown) => {
        if (active) setHistoryError(caught);
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [historyVersion]);

  const loadMore = async () => {
    if (!history?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await merchantTransactionApi.list({
        limit: HISTORY_PAGE_SIZE,
        cursor: history.nextCursor,
      });
      setHistory((current) =>
        current ? { ...page, items: [...current.items, ...page.items] } : page,
      );
    } catch (caught) {
      setMoreError(caught);
    } finally {
      setLoadingMore(false);
    }
  };

  /** Begin a fresh logical order attempt (new idempotency key). */
  const startNewAttempt = () => {
    setAttemptKey(undefined);
    setError(undefined);
    setNotice('');
    setView({ name: 'form' });
  };

  const submitPreview = async (data: FormData) => {
    setError(undefined);
    setNotice('');
    const key = attemptKey ?? createIdempotencyKey();
    setAttemptKey(key);
    const note = text(data, 'note');
    try {
      const preview = await merchantTransactionApi.preview(
        {
          amount: text(data, 'amount'),
          memberQrToken: text(data, 'memberQrToken'),
          ...(note ? { transactionNote: note } : {}),
        },
        context.marketId,
        key,
      );
      setView({ name: 'preview', preview });
    } catch (caught) {
      // Keep the key: a failed attempt replays with the same key.
      setError(caught);
    }
  };

  const confirmTransaction = async () => {
    if (view.name !== 'preview' || confirmPending) return;
    const key = attemptKey;
    if (!key) return;
    setConfirmPending(true);
    setError(undefined);
    try {
      const confirmed = await merchantTransactionApi.confirm(
        view.preview.previewSessionId,
        {},
        key,
      );
      // M-1: reset the key after success so the next transaction is a
      // fresh logical attempt.
      setAttemptKey(undefined);
      setView({ name: 'receipt', receipt: confirmed.receiptData });
    } catch (caught) {
      // Keep the key: retry of a failed confirm replays the same key.
      setError(caught);
    } finally {
      setConfirmPending(false);
    }
  };

  const openReceipt = async (transactionNumber: string) => {
    setError(undefined);
    setNotice('');
    setReceiptLoading(true);
    setView({ name: 'receipt' });
    try {
      const receipt = await merchantTransactionApi.detail(transactionNumber);
      setView({ name: 'receipt', receipt });
    } catch (caught) {
      setError(caught);
      setView({ name: 'history' });
    } finally {
      setReceiptLoading(false);
    }
  };

  return (
    <>
      {view.name === 'history' ? (
        <HistoryView
          context={context}
          history={history}
          loading={historyLoading}
          error={historyError}
          moreError={moreError}
          loadingMore={loadingMore}
          onReload={reloadHistory}
          onLoadMore={loadMore}
          onOpenReceipt={openReceipt}
          onNewTransaction={startNewAttempt}
        />
      ) : null}
      {view.name === 'form' ? (
        <FormView
          context={context}
          error={error}
          notice={notice}
          onSubmit={submitPreview}
          onBack={() => setView({ name: 'history' })}
        />
      ) : null}
      {view.name === 'preview' ? (
        <PreviewView
          preview={view.preview}
          error={error}
          confirmPending={confirmPending}
          onConfirm={confirmTransaction}
          onStartOver={startNewAttempt}
        />
      ) : null}
      {view.name === 'receipt' ? (
        <ReceiptView
          receipt={view.receipt}
          loading={receiptLoading}
          error={error}
          onNewTransaction={startNewAttempt}
          onBack={() => {
            reloadHistory();
            setView({ name: 'history' });
          }}
        />
      ) : null}
    </>
  );
}

function HistoryView(props: {
  context: MerchantContext;
  history?: MerchantTransactionListPageDto;
  loading: boolean;
  error?: unknown;
  moreError?: unknown;
  loadingMore: boolean;
  onReload: () => void;
  onLoadMore: () => void;
  onOpenReceipt: (transactionNumber: string) => void;
  onNewTransaction: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow={`Branch ${props.context.branchId}`}
        title="Transactions"
        description="Confirmed transaction history from the live transaction API; create a new transaction to preview and confirm."
        actions={
          <>
            <Button variant="secondary" onClick={props.onReload}>
              Refresh
            </Button>
            <Button onClick={props.onNewTransaction}>New transaction</Button>
          </>
        }
      />
      {props.error ? (
        <ErrorState error={props.error} retry={props.onReload} />
      ) : null}
      {!props.error && props.loading ? <Loading /> : null}
      {!props.error && !props.loading && props.history ? (
        props.history.items.length === 0 ? (
          <EmptyState
            data-testid="transaction-history-empty"
            title="No transactions yet"
            description="Confirmed transactions for this branch will appear here. Create the first transaction to get started."
            action={
              <Button onClick={props.onNewTransaction}>New transaction</Button>
            }
          />
        ) : (
          <Card>
            <Table>
              <thead>
                <tr>
                  <th>Transaction #</th>
                  <th>Time</th>
                  <th>Member</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {props.history.items.map((item) => (
                  <tr
                    key={item.transactionNumber}
                    data-testid="transaction-history-row"
                  >
                    <td>{item.transactionNumber}</td>
                    <td>{formatTimestamp(item.transactionTime)}</td>
                    <td>{item.member.maskedReference}</td>
                    <td>{money(item.currency, item.purchaseAmount)}</td>
                    <td>
                      <Badge>{item.status}</Badge>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          props.onOpenReceipt(item.transactionNumber)
                        }
                      >
                        View receipt
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {props.history.nextCursor ? (
              <div>
                <Button
                  variant="secondary"
                  disabled={props.loadingMore}
                  onClick={props.onLoadMore}
                  data-testid="transaction-load-more"
                >
                  {props.loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            ) : null}
            {props.moreError ? <ErrorAlert error={props.moreError} /> : null}
          </Card>
        )
      ) : null}
    </>
  );
}

function FormView(props: {
  context: MerchantContext;
  error?: unknown;
  notice: string;
  onSubmit: (data: FormData) => void | Promise<void>;
  onBack: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow={`Market ${props.context.marketId}`}
        title="New transaction"
        description="Enter the member QR token and the exact amount; the API returns a server quote before any confirmation."
      />
      {props.error ? <ErrorAlert error={props.error} /> : null}
      {props.notice ? (
        <Alert tone="success" title="Request completed">
          {props.notice}
        </Alert>
      ) : null}
      <Card>
        <LiveForm
          submitLabel="Preview transaction"
          onSubmit={props.onSubmit}
          data-testid="transaction-preview-form"
        >
          <div className="merchant-form-grid">
            <Field
              name="amount"
              label="Amount"
              required
              inputMode="decimal"
              placeholder="0.00"
              pattern="[0-9]+(\.[0-9]+)?"
              title="Amount as a decimal, e.g. 120.50"
            />
            <Field
              name="memberQrToken"
              label="Member QR token"
              required
              placeholder="Paste the member QR token"
            />
          </div>
          <FormField label="Note (optional)" htmlFor="transaction-note">
            <Textarea
              id="transaction-note"
              name="note"
              rows={3}
              maxLength={200}
            />
          </FormField>
        </LiveForm>
      </Card>
      <Button variant="secondary" onClick={props.onBack}>
        Back to history
      </Button>
    </>
  );
}

function PreviewView(props: {
  preview: MerchantTransactionPreviewDto;
  error?: unknown;
  confirmPending: boolean;
  onConfirm: () => void;
  onStartOver: () => void;
}) {
  const quote = props.preview;
  const confirmBlocked = !quote.confirmAllowed || !quote.mcpSufficient;
  return (
    <>
      <PageHeader
        eyebrow="Server quote"
        title="Review transaction"
        description="The preview session is valid until it expires; confirming creates the transaction."
      />
      {props.error ? <ErrorAlert error={props.error} /> : null}
      <div
        className="merchant-stat-grid"
        data-testid="transaction-preview-quote"
      >
        <LiveCard title="Amount" value={money(quote.currency, quote.amount)} />
        <LiveCard
          title="Service fee rate"
          value={`${trimAmount(quote.serviceFeeRate)}%`}
        />
        <LiveCard
          title="Service fee package"
          value={quote.selectedPackage.name}
        />
        <LiveCard
          title="Estimated MCP debit"
          value={money(quote.currency, quote.estimatedMcpDebit)}
        />
        <LiveCard
          title="Current MCP balance"
          value={money(quote.currency, quote.currentMcpBalance)}
        />
        <LiveCard
          title="MCP balance after"
          value={money(quote.currency, quote.estimatedMcpBalanceAfter)}
        />
        <LiveCard
          title="Expected daily reward"
          value={money(quote.currency, quote.expectedDailyRewardAmount)}
        />
        <LiveCard
          title="Reward cap"
          value={money(quote.currency, quote.rewardCap)}
        />
        <LiveCard
          title="Reward rate"
          value={`${trimAmount(quote.rewardRate)}%`}
        />
        <LiveCard title="Member" value={quote.protectedMemberReference} />
        <LiveCard
          title="Market"
          value={`${quote.transactionMarket.code} (${quote.transactionMarket.timezone})`}
        />
        <LiveCard
          title="Quote expires"
          value={formatTimestamp(quote.previewExpiresAt)}
        />
      </div>
      {confirmBlocked ? (
        <Alert tone="error" title="Transaction cannot be confirmed">
          The quote is not confirmable
          {quote.mcpSufficient
            ? ''
            : ` — MCP shortfall ${money(quote.currency, quote.mcpShortfall)}`}
          .
        </Alert>
      ) : null}
      <div className="merchant-form-grid">
        <Button
          onClick={props.onConfirm}
          disabled={props.confirmPending || confirmBlocked}
          data-testid="transaction-confirm"
        >
          {props.confirmPending ? 'Confirming…' : 'Confirm transaction'}
        </Button>
        <Button
          variant="secondary"
          onClick={props.onStartOver}
          disabled={props.confirmPending}
          data-testid="transaction-start-over"
        >
          Start over
        </Button>
      </div>
    </>
  );
}

function ReceiptView(props: {
  receipt?: MerchantTransactionReceiptDto;
  loading: boolean;
  error?: unknown;
  onNewTransaction: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Receipt"
        title="Transaction receipt"
        description="Confirmed receipt as returned by the transaction API."
      />
      {props.loading ? <Loading /> : null}
      {props.error ? <ErrorAlert error={props.error} /> : null}
      {!props.loading && props.receipt ? (
        <Card data-testid="transaction-receipt">
          <SectionHeading
            title={`Receipt ${props.receipt.transactionNumber} · ${props.receipt.status}`}
          />
          <dl className="merchant-definition-list">
            <ReceiptRow
              label="Transaction number"
              value={props.receipt.transactionNumber}
            />
            <ReceiptRow label="Status" value={props.receipt.status} />
            <ReceiptRow
              label="Merchant"
              value={props.receipt.merchant.merchantName}
            />
            <ReceiptRow
              label="Branch"
              value={props.receipt.merchant.branchName ?? '—'}
            />
            <ReceiptRow
              label="Member"
              value={props.receipt.member.maskedReference}
            />
            <ReceiptRow
              label="Member name"
              value={props.receipt.member.displayName ?? '—'}
            />
            <ReceiptRow
              label="Market"
              value={props.receipt.market.marketCode}
            />
            <ReceiptRow
              label="Amount"
              value={money(
                props.receipt.currency,
                props.receipt.purchaseAmount,
              )}
            />
            <ReceiptRow
              label="Service fee"
              value={money(
                props.receipt.currency,
                props.receipt.serviceFeeAmount,
              )}
            />
            <ReceiptRow
              label="Service fee rate"
              value={`${trimAmount(props.receipt.package.serviceFeeRate)}%`}
            />
            <ReceiptRow
              label="Package"
              value={props.receipt.package.packageName}
            />
            <ReceiptRow
              label="Reward rate"
              value={`${trimAmount(props.receipt.reward.rewardRate)}%`}
            />
            <ReceiptRow
              label="Daily reward"
              value={money(
                props.receipt.currency,
                props.receipt.reward.dailyRewardAmount,
              )}
            />
            <ReceiptRow
              label="Reward cap"
              value={money(
                props.receipt.currency,
                props.receipt.reward.rewardCap,
              )}
            />
            <ReceiptRow
              label="Reward start date"
              value={props.receipt.reward.rewardStartBusinessDate}
            />
            <ReceiptRow
              label="Merchant receipt number"
              value={props.receipt.merchantReceiptNumber ?? 'Not provided'}
            />
            <ReceiptRow
              label="Note"
              value={props.receipt.transactionNote ?? 'None'}
            />
            <ReceiptRow
              label="Transaction time"
              value={formatTimestamp(props.receipt.transactionTime)}
            />
          </dl>
        </Card>
      ) : null}
      <div className="merchant-form-grid">
        <Button
          onClick={props.onNewTransaction}
          data-testid="transaction-new-attempt"
        >
          Create another transaction
        </Button>
        <Button
          variant="secondary"
          onClick={props.onBack}
          data-testid="transaction-back-to-history"
        >
          Back to history
        </Button>
      </div>
    </>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

/* ---- shared form / presentation helpers (same pattern as merchant-app) ---- */

function LiveForm({
  children,
  submitLabel,
  onSubmit,
  'data-testid': testId,
}: {
  children: ReactNode;
  submitLabel: string;
  onSubmit: (data: FormData) => void | Promise<void>;
  'data-testid'?: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <form
      data-testid={testId}
      className="merchant-panel"
      onSubmit={async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        try {
          await onSubmit(new FormData(event.currentTarget));
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
      <Button type="submit" disabled={pending}>
        {pending ? 'Working…' : submitLabel}
      </Button>
    </form>
  );
}

function Field(props: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  minLength?: number;
  maxLength?: number;
  inputMode?:
    | 'search'
    | 'none'
    | 'text'
    | 'tel'
    | 'url'
    | 'email'
    | 'numeric'
    | 'decimal';
  placeholder?: string;
  pattern?: string;
  title?: string;
}) {
  const id = useId();
  return (
    <FormField label={props.label} htmlFor={id}>
      <Input id={id} {...props} />
    </FormField>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="merchant-section-heading">
      <h2>{title}</h2>
    </div>
  );
}

function LiveCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <small>{title}</small>
      <h2>{value}</h2>
    </Card>
  );
}

function ErrorAlert({ error }: { error: unknown }) {
  const described = describeTransactionError(error);
  return (
    <Alert tone="error" title={described.title}>
      {described.detail}
    </Alert>
  );
}

function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  const described = describeTransactionError(error);
  return (
    <EmptyState
      title={described.title}
      description={described.detail}
      action={<Button onClick={retry}>Retry</Button>}
    />
  );
}

/**
 * Market-scope errors surfaced by the frozen transaction controller
 * (TRANSACTION_MARKET_MISMATCH / TRANSACTION_MARKET_SETTINGS_MISSING) are
 * 403s but are not in describeApiError's market list, so without this map
 * they would render as "Permission denied". Map them to the market gate
 * copy so the real behaviour matches the page's market-gate claim.
 */
function describeTransactionError(error: unknown): {
  title: string;
  detail: string;
} {
  const described = describeApiError(error);
  if (
    error instanceof ApiError &&
    (error.body.code === 'TRANSACTION_MARKET_MISMATCH' ||
      error.body.code === 'TRANSACTION_MARKET_SETTINGS_MISSING')
  ) {
    return {
      title: 'Market access denied',
      detail:
        error.body.message ??
        'The transaction market does not match your current market context.',
    };
  }
  return described;
}

function Loading() {
  return (
    <section
      aria-label="Loading merchant workspace"
      className="merchant-loading"
    >
      <Skeleton width="38%" height={28} />
      <Skeleton width="70%" height={18} />
      <Skeleton height={180} />
    </section>
  );
}

function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return date.toString() === 'Invalid Date' ? value : date.toLocaleString();
}

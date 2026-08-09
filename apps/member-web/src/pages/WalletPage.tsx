import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PageHeader,
  Card,
  Badge,
  Alert,
  Button,
  EmptyState,
  Skeleton,
  Select,
  FormField,
} from '@ipoint/ui';
import {
  Wallet,
  Receipt,
  Gift,
  ChevronLeft,
  ChevronRight,
  Globe,
} from 'lucide-react';
import {
  ApiError,
  describeApiError,
  type MemberWalletAccountDto,
  type MemberWalletEntryDto,
  type MemberWalletEntriesPageDto,
} from '@ipoint/api-client';
import { apiClient, memberWalletApi } from '../api/client';
import { useAbortController } from '../hooks/useAbortController';
import { trimAmount } from '../utils/amount';

interface MarketInfo {
  id: string;
  code: string;
  name: string;
  currency: string;
  isActive: boolean;
}

type FetchState = 'idle' | 'loading' | 'error' | 'success';

const LEDGER_PAGE_SIZE = 20;

function entryTypeTone(
  entryType: MemberWalletEntryDto['entryType'],
): 'success' | 'warning' | 'neutral' {
  switch (entryType) {
    case 'AVAILABLE':
    case 'COMPENSATION':
      return 'success';
    case 'PENDING':
      return 'warning';
    default:
      return 'neutral';
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function WalletPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const abortController = useAbortController();

  const [wallets, setWallets] = useState<MemberWalletAccountDto[]>([]);
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isMarketGate, setIsMarketGate] = useState(false);

  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<MemberWalletEntriesPageDto | null>(null);
  const [ledgerState, setLedgerState] = useState<FetchState>('idle');
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const loadMarkets = useCallback(async (): Promise<MarketInfo[]> => {
    try {
      const response = await apiClient.get<{ data: MarketInfo[] }>('/markets', {
        signal: abortController.signal,
      });
      const data = ((response.data as Record<string, unknown>)?.data ??
        response.data) as MarketInfo[];
      return data ?? [];
    } catch {
      // Markets are optional for balance display (currency/name enrichment).
      return [];
    }
  }, [abortController]);

  const fetchWallets = useCallback(async () => {
    setFetchState('loading');
    setFetchError(null);
    setIsMarketGate(false);
    try {
      const [walletList, marketList] = await Promise.all([
        memberWalletApi.listWallets(),
        loadMarkets(),
      ]);
      if (abortController.signal.aborted) return;
      setWallets(walletList);
      setMarkets(marketList);
      setSelectedWalletId((prev) => prev ?? walletList[0]?.id ?? null);
      setFetchState('success');
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const description = describeApiError(err);
      setIsMarketGate(description.kind === 'market');
      setFetchError(description.detail);
      setFetchState('error');
    }
  }, [abortController, loadMarkets]);

  const fetchLedger = useCallback(
    async (walletId: string, nextOffset: number) => {
      setLedgerState('loading');
      setLedgerError(null);
      try {
        const page = await memberWalletApi.walletEntries(walletId, {
          limit: LEDGER_PAGE_SIZE,
          offset: nextOffset,
        });
        if (abortController.signal.aborted) return;
        setLedger(page);
        setOffset(page.offset);
        setLedgerState('success');
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLedgerError(t('wallet.loadError'));
        setLedgerState('error');
      }
    },
    [abortController, t],
  );

  useEffect(() => {
    void fetchWallets();
  }, [fetchWallets]);

  useEffect(() => {
    if (selectedWalletId) {
      void fetchLedger(selectedWalletId, 0);
    } else {
      setLedger(null);
      setLedgerState('idle');
    }
  }, [selectedWalletId, fetchLedger]);

  const selectedWallet = wallets.find((w) => w.id === selectedWalletId) ?? null;

  const marketOf = useCallback(
    (wallet: MemberWalletAccountDto): MarketInfo | undefined =>
      markets.find((m) => m.id === wallet.marketId),
    [markets],
  );

  const handleRetry = useCallback(() => {
    void fetchWallets();
  }, [fetchWallets]);

  const handleLedgerRetry = useCallback(() => {
    if (selectedWalletId) void fetchLedger(selectedWalletId, offset);
  }, [selectedWalletId, offset, fetchLedger]);

  const handleWalletChange = useCallback((walletId: string) => {
    setSelectedWalletId(walletId);
  }, []);

  const handlePreviousPage = useCallback(() => {
    if (selectedWalletId && offset > 0) {
      void fetchLedger(
        selectedWalletId,
        Math.max(0, offset - LEDGER_PAGE_SIZE),
      );
    }
  }, [selectedWalletId, offset, fetchLedger]);

  const handleNextPage = useCallback(() => {
    if (
      selectedWalletId &&
      ledger &&
      offset + LEDGER_PAGE_SIZE < ledger.total
    ) {
      void fetchLedger(selectedWalletId, offset + LEDGER_PAGE_SIZE);
    }
  }, [selectedWalletId, offset, ledger, fetchLedger]);

  const renderMarketGate = (marketBlocked: boolean) => {
    if (!marketBlocked) return null;
    return (
      <Alert tone="warning" title={t('errors.marketAccess')}>
        <p>{t('errors.marketAccessDescription')}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate('/market')}
        >
          {t('errors.selectMarket')}
        </Button>
      </Alert>
    );
  };

  if (fetchState === 'idle' || fetchState === 'loading') {
    return (
      <>
        <PageHeader
          title={t('wallet.title')}
          description={t('wallet.subtitle')}
        />
        <div className="ip-wallet-skeleton" aria-label={t('common.loading')}>
          <Skeleton width="100%" height="96px" />
          <Skeleton width="100%" height="240px" />
        </div>
      </>
    );
  }

  if (fetchState === 'error') {
    return (
      <>
        <PageHeader
          title={t('wallet.title')}
          description={t('wallet.subtitle')}
        />
        {renderMarketGate(isMarketGate)}
        <Alert tone="error" title={t('wallet.loadError')}>
          <p>{fetchError}</p>
          <Button variant="secondary" size="sm" onClick={handleRetry}>
            {t('common.retry')}
          </Button>
        </Alert>
      </>
    );
  }

  const ledgerTotalPages = ledger
    ? Math.max(1, Math.ceil(ledger.total / LEDGER_PAGE_SIZE))
    : 0;
  const currentPage = ledger ? Math.floor(offset / LEDGER_PAGE_SIZE) + 1 : 0;

  return (
    <>
      <PageHeader
        title={t('wallet.title')}
        description={t('wallet.subtitle')}
      />

      {/* Balance cards (one per market wallet) */}
      {wallets.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet size={48} />}
            title={t('wallet.noWallet')}
            description={t('wallet.noWalletDescription')}
          />
        </Card>
      ) : (
        <div className="ip-wallet-balances">
          {wallets.map((wallet) => {
            const market = marketOf(wallet);
            const currency = market?.currency ?? t('wallet.currencyUnknown');
            return (
              <Card
                key={wallet.id}
                className="ip-wallet-balance-card"
                data-testid="wallet-balance-card"
              >
                <div className="ip-wallet-balance-card__header">
                  <span className="ip-stat-card__label">
                    {market
                      ? `${market.name} (${market.code})`
                      : t('wallet.marketLabel')}
                  </span>
                  <span className="ip-text-sm ip-text-muted">
                    {t('wallet.availableBalance')}
                  </span>
                </div>
                <strong className="ip-wallet-balance-card__value">
                  {currency} {trimAmount(wallet.availableBalance)}
                </strong>
                <div className="ip-wallet-balance-card__detail">
                  <span>
                    {t('wallet.pendingBalance')}:{' '}
                    <strong>{trimAmount(wallet.pendingBalance)}</strong>
                  </span>
                  <span>
                    {t('wallet.reversedBalance')}:{' '}
                    <strong>{trimAmount(wallet.reversedBalance)}</strong>
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Ledger history */}
      <Card className="ip-wallet-ledger">
        <div className="ip-wallet-ledger__header">
          <h2 className="ip-section-title">{t('wallet.ledgerTitle')}</h2>
          {wallets.length > 1 ? (
            <FormField label={t('wallet.marketLabel')} htmlFor="wallet-select">
              <Select
                id="wallet-select"
                value={selectedWalletId ?? ''}
                onChange={(e) => handleWalletChange(e.target.value)}
              >
                {wallets.map((wallet) => {
                  const market = marketOf(wallet);
                  return (
                    <option key={wallet.id} value={wallet.id}>
                      {market
                        ? `${market.name} (${market.code})`
                        : t('wallet.marketLabel')}
                    </option>
                  );
                })}
              </Select>
            </FormField>
          ) : null}
        </div>

        {!selectedWallet ? (
          <EmptyState
            icon={<Receipt size={48} />}
            title={t('wallet.noEntries')}
            description={t('wallet.noEntriesDescription')}
          />
        ) : null}

        {selectedWallet && ledgerState === 'loading' ? (
          <div aria-label={t('common.loading')}>
            <Skeleton width="100%" height="56px" />
            <Skeleton width="100%" height="56px" />
            <Skeleton width="100%" height="56px" />
          </div>
        ) : null}

        {selectedWallet && ledgerState === 'error' ? (
          <Alert tone="error" title={t('wallet.loadError')}>
            <p>{ledgerError}</p>
            <Button variant="secondary" size="sm" onClick={handleLedgerRetry}>
              {t('common.retry')}
            </Button>
          </Alert>
        ) : null}

        {selectedWallet &&
        ledgerState === 'success' &&
        ledger &&
        ledger.entries.length === 0 ? (
          <EmptyState
            icon={<Receipt size={48} />}
            title={t('wallet.noEntries')}
            description={t('wallet.noEntriesDescription')}
          />
        ) : null}

        {selectedWallet &&
        ledgerState === 'success' &&
        ledger &&
        ledger.entries.length > 0 ? (
          <>
            <ul className="ip-wallet-ledger__list">
              {ledger.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="ip-wallet-ledger__row"
                  data-testid="wallet-ledger-entry"
                >
                  <div className="ip-wallet-ledger__row-main">
                    <Badge tone={entryTypeTone(entry.entryType)}>
                      {t(`wallet.entryTypes.${entry.entryType}`)}
                    </Badge>
                    <div>
                      <strong>
                        {entry.description || t('wallet.entryGeneric')}
                      </strong>
                      <span className="ip-text-sm ip-text-muted">
                        {formatDate(entry.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="ip-wallet-ledger__row-amount">
                    <strong>{trimAmount(entry.amount)}</strong>
                    <span className="ip-text-sm ip-text-muted">
                      {t('wallet.balanceAfter')}:{' '}
                      {trimAmount(entry.balanceAfter)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="ip-wallet-ledger__pagination">
              <span className="ip-text-sm ip-text-muted">
                {t('wallet.showing', {
                  from: offset + 1,
                  to: Math.min(offset + LEDGER_PAGE_SIZE, ledger.total),
                  total: ledger.total,
                })}
              </span>
              <div className="ip-wallet-ledger__pagination-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePreviousPage}
                  disabled={offset <= 0}
                  aria-label={t('wallet.previous')}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                  {t('wallet.previous')}
                </Button>
                <span className="ip-text-sm ip-text-muted">
                  {t('wallet.pageOf', {
                    page: currentPage,
                    total: ledgerTotalPages,
                  })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={offset + LEDGER_PAGE_SIZE >= ledger.total}
                  aria-label={t('wallet.next')}
                >
                  {t('wallet.next')}
                  <ChevronRight size={16} aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </Card>

      {/* Reward summary link */}
      <Card>
        <div className="ip-wallet-reward-summary">
          <div className="ip-wallet-reward-summary__icon">
            <Gift size={24} aria-hidden="true" />
          </div>
          <div className="ip-wallet-reward-summary__content">
            <strong>{t('wallet.rewardSummary')}</strong>
            <span className="ip-text-sm ip-text-muted">
              {t('wallet.rewardSummaryDescription')}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/reward')}
          >
            {t('wallet.viewRewards')}
          </Button>
        </div>
      </Card>

      {/* Market notice */}
      <div className="ip-text-sm ip-text-muted ip-wallet-market-note">
        <Globe size={14} aria-hidden="true" />
        <span>{t('wallet.marketNote')}</span>
      </div>
    </>
  );
}

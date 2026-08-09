import { useCallback, useEffect, useRef, useState } from 'react';
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
  Checkbox,
} from '@ipoint/ui';
import {
  ShoppingBag,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Info,
} from 'lucide-react';
import {
  createIdempotencyKey,
  describeApiError,
  type MemberRedemptionCatalogItemDto,
  type MemberRedemptionCatalogPageDto,
  type MemberRedemptionItemDetailDto,
  type MemberRedemptionOrderDto,
  type MemberRedemptionQuoteDto,
} from '@ipoint/api-client';
import { memberRedemptionApi } from '../api/client';
import { useAbortController } from '../hooks/useAbortController';
import { trimAmount } from '../utils/amount';

type FetchState = 'idle' | 'loading' | 'error' | 'success';
type SubmitState = 'idle' | 'submitting' | 'error' | 'success';

const PAGE_SIZE = 20;
const QUANTITY_OPTIONS = [1, 2, 3, 4, 5];

/**
 * Redemption terms version accepted by the member UI.
 *
 * CONFIGURABLE: mirrors the frozen POST /redemption/orders owner payload
 * (termsAcceptance.termsVersion is stored verbatim and is not validated
 * against any server-side registry). The frozen member surface exposes no
 * terms-version source; the RegisterPage uses the same convention for the
 * registration terms (CURRENT_TERMS_VERSION = '1.0').
 */
const CURRENT_REDEMPTION_TERMS_VERSION = '1.0';

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function RedemptionPage() {
  const { t } = useTranslation();
  const abortController = useAbortController();

  // Catalogue
  const [catalog, setCatalog] = useState<MemberRedemptionCatalogPageDto | null>(
    null,
  );
  const [catalogState, setCatalogState] = useState<FetchState>('idle');
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [isMarketGate, setIsMarketGate] = useState(false);

  // Item detail + quote
  const [selectedItem, setSelectedItem] =
    useState<MemberRedemptionCatalogItemDto | null>(null);
  const [detail, setDetail] = useState<MemberRedemptionItemDetailDto | null>(
    null,
  );
  const [detailState, setDetailState] = useState<FetchState>('idle');
  const [quote, setQuote] = useState<MemberRedemptionQuoteDto | null>(null);
  const [quoteState, setQuoteState] = useState<FetchState>('idle');
  const [quantity, setQuantity] = useState(1);
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Submit
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [order, setOrder] = useState<MemberRedemptionOrderDto | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const supportsPickup =
    selectedItem?.fulfilmentMode === 'PICKUP' ||
    selectedItem?.fulfilmentMode === 'DELIVERY_OR_PICKUP';

  const fetchCatalog = useCallback(
    async (pageNum: number) => {
      setCatalogState('loading');
      setCatalogError(null);
      setIsMarketGate(false);
      try {
        const result = await memberRedemptionApi.catalog({
          page: pageNum,
          pageSize: PAGE_SIZE,
        });
        if (abortController.signal.aborted) return;
        setCatalog(result);
        setPage(result.page);
        setCatalogState('success');
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const description = describeApiError(err);
        setIsMarketGate(description.kind === 'market');
        setCatalogError(description.detail);
        setCatalogState('error');
      }
    },
    [abortController],
  );

  const fetchDetail = useCallback(
    async (itemId: string) => {
      setDetailState('loading');
      try {
        const result = await memberRedemptionApi.itemDetail(itemId);
        if (abortController.signal.aborted) return;
        setDetail(result);
        setDetailState('success');
      } catch {
        if (abortController.signal.aborted) return;
        setDetailState('error');
      }
    },
    [abortController],
  );

  const fetchQuote = useCallback(
    async (itemId: string, qty: number) => {
      setQuoteState('loading');
      try {
        const result = await memberRedemptionApi.quote(itemId, qty);
        if (abortController.signal.aborted) return;
        setQuote(result);
        setQuoteState('success');
      } catch {
        if (abortController.signal.aborted) return;
        setQuoteState('error');
      }
    },
    [abortController],
  );

  useEffect(() => {
    void fetchCatalog(1);
  }, [fetchCatalog]);

  useEffect(() => {
    if (!selectedItem) return;
    void fetchDetail(selectedItem.id);
    void fetchQuote(selectedItem.id, quantity);
  }, [selectedItem, quantity, fetchDetail, fetchQuote]);

  const handleSelectItem = useCallback(
    (item: MemberRedemptionCatalogItemDto) => {
      setSelectedItem(item);
      setDetail(null);
      setQuote(null);
      setTermsAccepted(false);
      setQuantity(1);
      setOrder(null);
      setSubmitState('idle');
      setSubmitError(null);
      idempotencyKeyRef.current = null;
    },
    [],
  );

  const handleQuantityChange = useCallback((value: string) => {
    const qty = Number.parseInt(value, 10);
    if (Number.isInteger(qty) && qty >= 1) setQuantity(qty);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedItem(null);
    setDetail(null);
    setQuote(null);
    setTermsAccepted(false);
    setOrder(null);
    setSubmitState('idle');
    setSubmitError(null);
    idempotencyKeyRef.current = null;
  }, []);

  const handleConfirmOrder = useCallback(async () => {
    if (submitState === 'submitting') return;
    if (!detail || !quote) return;
    if (!termsAccepted) {
      setSubmitState('error');
      setSubmitError(t('redemption.termsRequired'));
      return;
    }
    // The idempotency key is created once per logical order attempt and
    // reused on retries: same key + same payload replays the existing
    // order instead of creating a duplicate.
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = createIdempotencyKey();
    }
    setSubmitState('submitting');
    setSubmitError(null);
    try {
      const result = await memberRedemptionApi.confirmOrder({
        quoteId: quote.quoteId,
        idempotencyKey: idempotencyKeyRef.current,
        expectedItemVersion: detail.version,
        expectedTotalPoints: quote.postedPointCost,
        expectedQuantity: String(quote.quantity),
        fulfilment: { type: 'PICKUP' },
        termsAcceptance: {
          accepted: true,
          termsVersion: CURRENT_REDEMPTION_TERMS_VERSION,
        },
      });
      if (abortController.signal.aborted) return;
      setOrder(result);
      setSubmitState('success');
      // A completed order ends this logical order attempt: reset the key so
      // any further submission (new item, new quantity, "Order again")
      // creates a NEW order instead of replaying this one. Failed attempts
      // keep the key so retries replay the same order (idempotent).
      idempotencyKeyRef.current = null;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const description = describeApiError(err);
      setSubmitError(description.detail);
      setSubmitState('error');
    }
  }, [submitState, detail, quote, termsAccepted, t, abortController]);

  const handleRetryCatalog = useCallback(() => {
    void fetchCatalog(page);
  }, [page, fetchCatalog]);

  const handlePreviousPage = useCallback(() => {
    if (page > 1) void fetchCatalog(page - 1);
  }, [page, fetchCatalog]);

  const handleNextPage = useCallback(() => {
    if (catalog && page < catalog.total / PAGE_SIZE) {
      void fetchCatalog(page + 1);
    }
  }, [page, catalog, fetchCatalog]);

  const catalogueItems = catalog?.items ?? [];

  return (
    <>
      <PageHeader
        title={t('redemption.title')}
        description={t('redemption.subtitle')}
      />

      {isMarketGate ? (
        <Alert tone="warning" title={t('errors.marketAccess')}>
          <p>{t('errors.marketAccessDescription')}</p>
        </Alert>
      ) : null}

      {/* Catalogue */}
      <Card className="ip-redemption-catalogue">
        <h2 className="ip-section-title">{t('redemption.catalogueTitle')}</h2>

        {catalogState === 'idle' || catalogState === 'loading' ? (
          <div aria-label={t('common.loading')}>
            <Skeleton width="100%" height="72px" />
            <Skeleton width="100%" height="72px" />
            <Skeleton width="100%" height="72px" />
          </div>
        ) : null}

        {catalogState === 'error' ? (
          <Alert tone="error" title={t('redemption.loadError')}>
            <p>{catalogError}</p>
            <Button variant="secondary" size="sm" onClick={handleRetryCatalog}>
              {t('common.retry')}
            </Button>
          </Alert>
        ) : null}

        {catalogState === 'success' && catalogueItems.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag size={48} />}
            title={t('redemption.noItems')}
            description={t('redemption.noItemsDescription')}
          />
        ) : null}

        {catalogState === 'success' && catalogueItems.length > 0 ? (
          <div className="ip-redemption-catalogue__grid">
            {catalogueItems.map((item) => (
              <Card
                key={item.id}
                interactive={!selectedItem || selectedItem.id !== item.id}
                className="ip-redemption-catalogue__item"
                data-testid="redemption-catalogue-item"
                onClick={
                  selectedItem && selectedItem.id === item.id
                    ? undefined
                    : () => handleSelectItem(item)
                }
                tabIndex={selectedItem && selectedItem.id === item.id ? -1 : 0}
                onKeyDown={
                  selectedItem && selectedItem.id === item.id
                    ? undefined
                    : (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          handleSelectItem(item);
                        }
                      }
                }
                role="button"
                aria-label={item.name}
              >
                <div className="ip-redemption-catalogue__item-header">
                  <strong>{item.name}</strong>
                  {item.isFeatured ? (
                    <Badge tone="gold">{t('redemption.featured')}</Badge>
                  ) : null}
                </div>
                <div className="ip-redemption-catalogue__item-meta">
                  <Badge tone="neutral">
                    {t(`redemption.itemType.${item.itemType}`)}
                  </Badge>
                  <Badge tone="neutral">
                    {t(`redemption.fulfilmentMode.${item.fulfilmentMode}`)}
                  </Badge>
                </div>
                <div className="ip-redemption-catalogue__item-price">
                  <span className="ip-text-sm ip-text-muted">
                    {t('redemption.fiatReference')}
                  </span>
                  <strong>
                    {item.fiatCurrency} {trimAmount(item.fiatReferenceValue)}
                  </strong>
                </div>
              </Card>
            ))}
          </div>
        ) : null}

        {catalog && catalog.total > PAGE_SIZE ? (
          <div className="ip-redemption-catalogue__pagination">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePreviousPage}
              disabled={page <= 1}
              aria-label={t('redemption.previous')}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              {t('redemption.previous')}
            </Button>
            <span className="ip-text-sm ip-text-muted">
              {t('redemption.pageOf', {
                page,
                total: Math.ceil(catalog.total / PAGE_SIZE),
              })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNextPage}
              disabled={page >= Math.ceil(catalog.total / PAGE_SIZE)}
              aria-label={t('redemption.next')}
            >
              {t('redemption.next')}
              <ChevronRight size={16} aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </Card>

      {/* Item detail + quote + submit */}
      {selectedItem ? (
        <Card
          className="ip-redemption-checkout"
          data-testid="redemption-checkout"
        >
          <div className="ip-redemption-checkout__header">
            <h2 className="ip-section-title">{selectedItem.name}</h2>
            <Button variant="ghost" size="sm" onClick={handleCloseDetail}>
              {t('redemption.closeDetail')}
            </Button>
          </div>

          {detailState === 'idle' || detailState === 'loading' ? (
            <div aria-label={t('common.loading')}>
              <Skeleton width="100%" height="64px" />
              <Skeleton width="100%" height="64px" />
            </div>
          ) : null}

          {detailState === 'error' ? (
            <Alert tone="error" title={t('redemption.detailLoadError')}>
              <p>{t('redemption.detailLoadErrorDescription')}</p>
            </Alert>
          ) : null}

          {detailState === 'success' && detail ? (
            <>
              {detail.description ? (
                <p className="ip-redemption-checkout__description">
                  {detail.description}
                </p>
              ) : null}

              <FormField
                label={t('redemption.selectQuantity')}
                htmlFor="redemption-quantity"
              >
                <Select
                  id="redemption-quantity"
                  value={String(quantity)}
                  onChange={(e) => handleQuantityChange(e.target.value)}
                >
                  {QUANTITY_OPTIONS.map((qty) => (
                    <option key={qty} value={String(qty)}>
                      {qty}
                    </option>
                  ))}
                </Select>
              </FormField>

              {quoteState === 'idle' || quoteState === 'loading' ? (
                <div aria-label={t('common.loading')}>
                  <Skeleton width="100%" height="48px" />
                </div>
              ) : null}

              {quoteState === 'error' ? (
                <Alert tone="warning" title={t('redemption.quoteFailed')}>
                  <p>{t('redemption.quoteFailedDescription')}</p>
                </Alert>
              ) : null}

              {quoteState === 'success' && quote ? (
                <div
                  className="ip-redemption-checkout__quote"
                  data-testid="redemption-quote"
                >
                  <span className="ip-text-sm ip-text-muted">
                    {t('redemption.quotePoints')}
                  </span>
                  <strong className="ip-redemption-checkout__points">
                    {trimAmount(quote.postedPointCost)}
                  </strong>
                  <span className="ip-text-sm ip-text-muted">
                    {t('redemption.quoteExpires', {
                      time: formatDate(quote.expiresAt),
                    })}
                  </span>
                </div>
              ) : null}

              {detail.terms ? (
                <div className="ip-redemption-checkout__terms">
                  <span className="ip-text-sm ip-text-muted">
                    {t('redemption.termsLabel')}
                  </span>
                  <p>{detail.terms}</p>
                </div>
              ) : null}

              {supportsPickup ? (
                <div className="ip-redemption-checkout__actions">
                  <Checkbox
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    label={t('redemption.acceptTerms')}
                    data-testid="redemption-terms-checkbox"
                  />

                  {submitState === 'error' ? (
                    <Alert tone="error" title={t('redemption.orderFailed')}>
                      <p>{submitError}</p>
                    </Alert>
                  ) : null}

                  {submitState === 'success' && order ? (
                    <div
                      className="ip-redemption-checkout__success"
                      data-testid="redemption-order-success"
                    >
                      <CheckCircle2 size={20} aria-hidden="true" />
                      <div>
                        <strong>{t('redemption.orderSuccess')}</strong>
                        <span className="ip-text-sm">
                          {t('redemption.orderReference')}:{' '}
                          <strong>{order.orderReference}</strong>
                        </span>
                        <span className="ip-text-sm">
                          {t('redemption.orderStatus')}: {order.status} ·{' '}
                          {t('redemption.orderPoints')}:{' '}
                          {trimAmount(order.totalPointCost)}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <Button
                    variant="primary"
                    onClick={() =>
                      submitState === 'success'
                        ? handleCloseDetail()
                        : void handleConfirmOrder()
                    }
                    disabled={
                      submitState === 'submitting' ||
                      quoteState !== 'success' ||
                      !quote
                    }
                    loadingLabel={t('redemption.confirming')}
                    data-testid="redemption-confirm"
                  >
                    {submitState === 'submitting'
                      ? t('redemption.confirming')
                      : submitState === 'success'
                        ? t('redemption.orderAgain')
                        : t('redemption.confirmOrder')}
                  </Button>
                </div>
              ) : (
                <Alert
                  tone="info"
                  title={t('redemption.deliveryNotAvailable')}
                  data-testid="redemption-delivery-unavailable"
                >
                  <p>{t('redemption.deliveryNotAvailableDescription')}</p>
                </Alert>
              )}
            </>
          ) : null}
        </Card>
      ) : null}

      {/* My orders / history */}
      <Card className="ip-redemption-history">
        <h2 className="ip-section-title">{t('redemption.myOrders')}</h2>
        <Alert
          tone="info"
          title={t('redemption.historyUnavailable')}
          data-testid="redemption-history-unavailable"
        >
          <Info size={16} aria-hidden="true" />
          <p>{t('redemption.historyUnavailableDescription')}</p>
        </Alert>
      </Card>
    </>
  );
}

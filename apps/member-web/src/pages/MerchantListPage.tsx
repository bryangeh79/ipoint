import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  PageHeader,
  Card,
  Badge,
  Alert,
  Button,
  EmptyState,
  Skeleton,
  SearchField,
  Select,
  FormField,
} from '@ipoint/ui';
import { Store, MapPin, ChevronRight, WifiOff } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAbortController } from '../hooks/useAbortController';
import type {
  MerchantListItem,
  PaginatedResponse,
  CategoryResponse,
  OpenNowStatus,
} from '../api/types';

type FetchState = 'idle' | 'loading' | 'error' | 'success' | 'loading-more';

export function MerchantListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const abortController = useAbortController();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');
  const [categoryFilter, setCategoryFilter] = useState(
    searchParams.get('category') ?? '',
  );
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'online' | 'offline'
  >((searchParams.get('status') as 'all' | 'online' | 'offline') ?? 'all');

  // Data
  const [merchants, setMerchants] = useState<MerchantListItem[]>([]);
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageLoading = fetchState === 'loading-more';
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [onlineState, setOnlineState] = useState<'online' | 'offline'>(
    navigator.onLine ? 'online' : 'offline',
  );

  // Debounce ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Monitor online/offline
  useEffect(() => {
    const goOnline = () => setOnlineState('online');
    const goOffline = () => setOnlineState('offline');
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Load categories
  const loadCategories = useCallback(async () => {
    try {
      const response = await apiClient.get<CategoryResponse[]>(
        '/members/merchant-categories',
        { signal: abortController.signal },
      );
      setCategories(response.data);
    } catch {
      // Non-critical — categories are optional
    }
  }, [abortController]);

  // Fetch merchants
  const fetchMerchants = useCallback(
    async (pageNum: number, append = false) => {
      if (!append) {
        setFetchState('loading');
      } else {
        setFetchState('loading-more');
      }
      setError(null);

      // Abort any in-flight request for stale data
      const params = new URLSearchParams();
      params.set('page', String(pageNum));
      params.set('pageSize', '20');

      if (searchQuery.trim()) {
        params.set('query', searchQuery.trim());
      }
      if (categoryFilter) {
        params.set('category', categoryFilter);
      }
      if (statusFilter === 'online') {
        params.set('isOnline', 'true');
      } else if (statusFilter === 'offline') {
        params.set('isOffline', 'true');
      }

      try {
        const response = await apiClient.get<
          PaginatedResponse<MerchantListItem>
        >(`/members/merchants?${params.toString()}`, {
          signal: abortController.signal,
        });

        const data = response.data;

        // Abort guard: if our abort controller was triggered, ignore response
        if (abortController.signal.aborted) return;

        if (append) {
          setMerchants((prev) => [...prev, ...data.items]);
        } else {
          setMerchants(data.items);
        }
        setPage(data.page);
        setTotalPages(data.totalPages);
        setTotal(data.total);
        setFetchState('success');
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(t('merchants.loadError'));
        setFetchState('error');
      }
    },
    [searchQuery, categoryFilter, statusFilter, abortController, t],
  );

  // Initial load
  useEffect(() => {
    void fetchMerchants(1);
    void loadCategories();
  }, [fetchMerchants, loadCategories]);

  // Debounced search
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        void fetchMerchants(1);
      }, 400);
    },
    [fetchMerchants],
  );

  // Category filter handler
  const handleCategoryChange = useCallback(
    (value: string) => {
      setCategoryFilter(value);
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set('category', value);
        setSearchParams(params, { replace: true });
      } else {
        params.delete('category');
        setSearchParams(params, { replace: true });
      }
      void fetchMerchants(1);
    },
    [fetchMerchants, searchParams, setSearchParams],
  );

  // Status filter handler
  const handleStatusChange = useCallback(
    (value: 'all' | 'online' | 'offline') => {
      setStatusFilter(value);
      void fetchMerchants(1);
    },
    [fetchMerchants],
  );

  // Load more
  const handleLoadMore = useCallback(() => {
    if (page < totalPages && fetchState !== 'loading-more') {
      void fetchMerchants(page + 1, true);
    }
  }, [page, totalPages, fetchState, fetchMerchants]);

  // Retry
  const handleRetry = useCallback(() => {
    void fetchMerchants(1);
  }, [fetchMerchants]);

  // Navigate to detail
  const handleMerchantClick = useCallback(
    (merchantId: string) => {
      void navigate(`/merchants/${encodeURIComponent(merchantId)}`);
    },
    [navigate],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const openNowBadge = (openNow: OpenNowStatus | undefined) => {
    if (openNow === 'OPEN')
      return <Badge tone="success">{t('merchants.open')}</Badge>;
    if (openNow === 'CLOSED')
      return <Badge tone="neutral">{t('merchants.closed')}</Badge>;
    return null;
  };

  return (
    <>
      <PageHeader title={t('merchants.title')} />

      {/* Offline banner */}
      {onlineState === 'offline' && (
        <Alert
          tone="warning"
          title={t('errors.offline')}
          className="ip-merchant-offline-banner"
        >
          <p>{t('errors.offlineDescription')}</p>
        </Alert>
      )}

      {/* Search and filters */}
      <div className="ip-merchant-filters">
        <SearchField
          ref={searchRef}
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          onClear={() => {
            setSearchQuery('');
            void fetchMerchants(1);
          }}
          label={t('merchants.searchLabel')}
          placeholder={t('merchants.searchPlaceholder')}
        />

        <div className="ip-merchant-filter-row">
          <FormField
            label={t('merchants.categoryAll')}
            htmlFor="merchant-category-filter"
            className="ip-merchant-filter-field"
          >
            <Select
              id="merchant-category-filter"
              value={categoryFilter}
              onChange={(e) => handleCategoryChange(e.target.value)}
            >
              <option value="">{t('merchants.categoryAll')}</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.code}>
                  {cat.name}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label={t('merchants.statusAll')}
            htmlFor="merchant-status-filter"
            className="ip-merchant-filter-field"
          >
            <Select
              id="merchant-status-filter"
              value={statusFilter}
              onChange={(e) =>
                handleStatusChange(
                  e.target.value as 'all' | 'online' | 'offline',
                )
              }
            >
              <option value="all">{t('merchants.statusAll')}</option>
              <option value="online">{t('merchants.statusOnline')}</option>
              <option value="offline">{t('merchants.statusOffline')}</option>
            </Select>
          </FormField>
        </div>

        {fetchState === 'success' && (
          <p className="ip-merchant-result-count">
            {searchQuery || categoryFilter || statusFilter !== 'all'
              ? t('merchants.resultCountFiltered', {
                  count: merchants.length,
                  total,
                })
              : t('merchants.resultCount', { count: total })}
          </p>
        )}
      </div>

      {/* Loading state */}
      {fetchState === 'loading' && (
        <div className="ip-merchant-list">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="ip-merchant-card-skeleton">
              <div className="ip-merchant-card-skeleton__content">
                <Skeleton width="80%" height="20px" />
                <Skeleton width="60%" height="16px" />
                <Skeleton width="40%" height="14px" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Error state */}
      {fetchState === 'error' && (
        <Alert tone="error" title={t('merchants.loadError')}>
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={handleRetry}>
            {t('merchants.retryLoad')}
          </Button>
        </Alert>
      )}

      {/* Empty state */}
      {fetchState === 'success' && merchants.length === 0 && (
        <EmptyState
          icon={<Store size={48} />}
          title={t('merchants.notFound')}
          description={t('merchants.notFoundDescription')}
        />
      )}

      {/* Merchant list */}
      {fetchState === 'success' && merchants.length > 0 && (
        <div className="ip-merchant-list">
          {merchants.map((merchant) => (
            <Card
              key={merchant.merchantId}
              interactive
              className="ip-merchant-card"
              onClick={() => handleMerchantClick(merchant.merchantId)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleMerchantClick(merchant.merchantId);
                }
              }}
              role="button"
              aria-label={`${merchant.displayName}${merchant.branchName ? ` - ${merchant.branchName}` : ''}`}
            >
              <div className="ip-merchant-card__info">
                <strong className="ip-merchant-card__name">
                  {merchant.displayName}
                </strong>
                {merchant.branchName && (
                  <span className="ip-merchant-card__branch">
                    {merchant.branchName}
                  </span>
                )}
                <div className="ip-merchant-card__meta">
                  {merchant.category && (
                    <Badge tone="neutral">{merchant.category.name}</Badge>
                  )}
                  {merchant.isOnline && !merchant.isOffline && (
                    <Badge tone="success">{t('merchants.statusOnline')}</Badge>
                  )}
                  {!merchant.isOnline && merchant.isOffline && (
                    <Badge tone="neutral">{t('merchants.statusOffline')}</Badge>
                  )}
                  {merchant.isOnline && merchant.isOffline && (
                    <Badge tone="brand">{t('merchants.statusOnline')}</Badge>
                  )}
                  {openNowBadge(merchant.openNow)}
                </div>
                <div className="ip-merchant-card__distance">
                  {merchant.distance !== undefined && (
                    <span>
                      <MapPin size={12} aria-hidden="true" />
                      {t('merchants.distanceKm', {
                        distance: merchant.distance.toFixed(1),
                      })}
                    </span>
                  )}
                </div>
              </div>
              <div className="ip-merchant-card__action">
                <ChevronRight size={18} aria-hidden="true" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Load more */}
      {fetchState === 'success' && page < totalPages && (
        <div className="ip-merchant-load-more">
          {pageLoading ? (
            <Skeleton width="100%" height="48px" />
          ) : (
            <Button
              variant="secondary"
              fullWidth
              onClick={handleLoadMore}
              loadingLabel={t('merchants.loading')}
            >
              {t('merchants.loadMore')}
            </Button>
          )}
        </div>
      )}

      {/* Loading more indicator */}
      {pageLoading && (
        <div className="ip-merchant-loading-more">
          <Skeleton width="100%" height="24px" />
        </div>
      )}
    </>
  );
}

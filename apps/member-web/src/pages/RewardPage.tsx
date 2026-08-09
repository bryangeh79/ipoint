import { useCallback, useEffect, useState } from 'react';
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
import { Gift, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  describeApiError,
  type MemberRewardPlanDto,
  type MemberRewardPlanStatus,
  type MemberRewardPlansPageDto,
} from '@ipoint/api-client';
import { memberRewardApi } from '../api/client';
import { useAbortController } from '../hooks/useAbortController';
import { trimAmount } from '../utils/amount';

type FetchState = 'idle' | 'loading' | 'error' | 'success';

const PAGE_SIZE = 20;

const PLAN_STATUSES: MemberRewardPlanStatus[] = [
  'SCHEDULED',
  'ACTIVE',
  'CAPPED',
  'SUSPENDED',
  'REVERSED',
  'COMPLETED',
];

function statusTone(
  status: MemberRewardPlanStatus,
): 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'SCHEDULED':
    case 'CAPPED':
      return 'warning';
    case 'REVERSED':
      return 'error';
    default:
      return 'neutral';
  }
}

function formatDate(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

export function RewardPage() {
  const { t } = useTranslation();
  const abortController = useAbortController();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<
    'all' | MemberRewardPlanStatus
  >('all');
  const [data, setData] = useState<MemberRewardPlansPageDto | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isMarketGate, setIsMarketGate] = useState(false);

  const fetchPlans = useCallback(
    async (pageNum: number, status: 'all' | MemberRewardPlanStatus) => {
      setFetchState('loading');
      setFetchError(null);
      setIsMarketGate(false);
      try {
        const result = await memberRewardApi.plans({
          page: pageNum,
          pageSize: PAGE_SIZE,
          ...(status === 'all' ? {} : { status }),
        });
        if (abortController.signal.aborted) return;
        setData(result);
        setPage(result.page);
        setFetchState('success');
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const description = describeApiError(err);
        setIsMarketGate(description.kind === 'market');
        setFetchError(description.detail);
        setFetchState('error');
      }
    },
    [abortController],
  );

  useEffect(() => {
    void fetchPlans(1, statusFilter);
  }, [fetchPlans, statusFilter]);

  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value as 'all' | MemberRewardPlanStatus);
  }, []);

  const handlePreviousPage = useCallback(() => {
    if (page > 1) void fetchPlans(page - 1, statusFilter);
  }, [page, statusFilter, fetchPlans]);

  const handleNextPage = useCallback(() => {
    if (data && page < data.totalPages) void fetchPlans(page + 1, statusFilter);
  }, [page, data, statusFilter, fetchPlans]);

  const handleRetry = useCallback(() => {
    void fetchPlans(page, statusFilter);
  }, [page, statusFilter, fetchPlans]);

  if (fetchState === 'idle' || (fetchState === 'loading' && !data)) {
    return (
      <>
        <PageHeader
          title={t('reward.title')}
          description={t('reward.subtitle')}
        />
        <div className="ip-reward-skeleton" aria-label={t('common.loading')}>
          <Skeleton width="100%" height="88px" />
          <Skeleton width="100%" height="88px" />
          <Skeleton width="100%" height="88px" />
        </div>
      </>
    );
  }

  if (fetchState === 'error' && !data) {
    return (
      <>
        <PageHeader
          title={t('reward.title')}
          description={t('reward.subtitle')}
        />
        {isMarketGate ? (
          <Alert tone="warning" title={t('errors.marketAccess')}>
            <p>{t('errors.marketAccessDescription')}</p>
          </Alert>
        ) : null}
        <Alert tone="error" title={t('reward.loadError')}>
          <p>{fetchError}</p>
          <Button variant="secondary" size="sm" onClick={handleRetry}>
            {t('common.retry')}
          </Button>
        </Alert>
      </>
    );
  }

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t('reward.title')}
        description={t('reward.subtitle')}
      />

      {fetchState === 'error' ? (
        <Alert tone="error" title={t('reward.loadError')}>
          <p>{fetchError}</p>
          <Button variant="secondary" size="sm" onClick={handleRetry}>
            {t('common.retry')}
          </Button>
        </Alert>
      ) : null}

      {/* Status filter */}
      <FormField
        label={t('reward.statusFilterLabel')}
        htmlFor="reward-status-filter"
      >
        <Select
          id="reward-status-filter"
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
        >
          <option value="all">{t('reward.statusFilterAll')}</option>
          {PLAN_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`reward.status.${status}`)}
            </option>
          ))}
        </Select>
      </FormField>

      {/* Loading (refresh) */}
      {fetchState === 'loading' && data ? (
        <div aria-label={t('common.loading')}>
          <Skeleton width="100%" height="88px" />
          <Skeleton width="100%" height="88px" />
        </div>
      ) : null}

      {/* Empty state */}
      {fetchState === 'success' && items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Gift size={48} />}
            title={t('reward.noPlans')}
            description={t('reward.noPlansDescription')}
          />
        </Card>
      ) : null}

      {/* Plan list */}
      {items.length > 0 ? (
        <div className="ip-reward-list">
          {items.map((plan: MemberRewardPlanDto) => (
            <Card
              key={plan.id}
              className="ip-reward-card"
              data-testid="reward-plan-row"
            >
              <div className="ip-reward-card__header">
                <Badge tone={statusTone(plan.status)}>
                  {t(`reward.status.${plan.status}`)}
                </Badge>
                <Badge tone="neutral">{plan.sourceType}</Badge>
              </div>
              <div className="ip-reward-card__body">
                <span className="ip-text-sm ip-text-muted">
                  {t('reward.totalEarned')}
                </span>
                <strong className="ip-reward-card__amount">
                  {trimAmount(plan.totalEarned)}
                </strong>
                {plan.capAmount !== null ? (
                  <span className="ip-text-sm ip-text-muted">
                    {t('reward.capAmount')}: {trimAmount(plan.capAmount)}
                  </span>
                ) : null}
              </div>
              <div className="ip-reward-card__meta">
                <span className="ip-text-sm ip-text-muted">
                  {t('reward.createdAt')}: {formatDate(plan.createdAt)}
                </span>
                {plan.activatedAt ? (
                  <span className="ip-text-sm ip-text-muted">
                    {t('reward.activatedAt')}: {formatDate(plan.activatedAt)}
                  </span>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Pagination */}
      {data && data.totalPages > 1 ? (
        <div className="ip-reward-pagination">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePreviousPage}
            disabled={page <= 1}
            aria-label={t('reward.previous')}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            {t('reward.previous')}
          </Button>
          <span className="ip-text-sm ip-text-muted">
            {t('reward.pageOf', { page, total: data.totalPages })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNextPage}
            disabled={page >= data.totalPages}
            aria-label={t('reward.next')}
          >
            {t('reward.next')}
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </>
  );
}

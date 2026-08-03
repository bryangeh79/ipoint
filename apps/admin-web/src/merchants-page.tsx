import {
  type AdminMerchantApplicationQueueItemDto,
  type AdminMerchantApplicationQueueStatus,
  type AdminMerchantListItemDto,
  type AdminMerchantListStatus,
} from '@ipoint/api-client';
import {
  Badge,
  Button,
  Card,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  Table,
  Tabs,
} from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminMerchantApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import {
  formatMerchantTimestamp,
  merchantApplicationQueueStatusFilterOptions,
  merchantApplicationStatusLabel,
  merchantListStatusFilterOptions,
  merchantOperationalStatusLabel,
  describeMerchantReadError,
} from './merchant-model.js';
import {
  MerchantEmptyState,
  MerchantErrorState,
  MerchantListSkeleton,
} from './merchant-states.js';
import { routePath } from './route-manifest.js';

/**
 * P7-S5B selected-market merchant operations page.
 *
 * Two views over the accepted Phase 1 owner surfaces (market-scoped by the
 * server-owned Current Admin Market): the merchant application queue and the
 * merchant list. Deterministic offset paging, explicit loading/empty/error
 * states, and links to the branch detail route. No writes here; approved
 * status actions live on the branch detail page.
 */

const PAGE_SIZE = 25;

type QueueLoad =
  | { status: 'loading' }
  | {
      status: 'ready';
      items: AdminMerchantApplicationQueueItemDto[];
      hasMore: boolean;
    }
  | { status: 'error'; title: string; description: string };

type ListLoad =
  | { status: 'loading' }
  | { status: 'ready'; items: AdminMerchantListItemDto[]; hasMore: boolean }
  | { status: 'error'; title: string; description: string };

export function useMerchantApplications(
  marketId: string | undefined,
  status: AdminMerchantApplicationQueueStatus | '',
): { load: QueueLoad; retry: () => void } {
  const [load, setLoad] = useState<QueueLoad>({ status: 'loading' });
  const [page, setPage] = useState(0);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!marketId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    adminMerchantApi
      .merchantApplications(marketId, {
        ...(status ? { status } : {}),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then((items) => {
        if (!cancelled)
          setLoad({
            status: 'ready',
            items,
            hasMore: items.length === PAGE_SIZE,
          });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const described = describeMerchantReadError(error);
          setLoad({
            status: 'error',
            title: described.title,
            description: described.description,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, status, page, retryKey]);

  const retry = useCallback(() => {
    setPage(0);
    setRetryKey((key) => key + 1);
  }, []);
  return { load, retry };
}

export function useMerchantList(
  marketId: string | undefined,
  query: string,
  status: AdminMerchantListStatus | '',
): { load: ListLoad; retry: () => void } {
  const [load, setLoad] = useState<ListLoad>({ status: 'loading' });
  const [page, setPage] = useState(0);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!marketId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    adminMerchantApi
      .merchantList(marketId, {
        ...(query.trim() ? { query: query.trim() } : {}),
        ...(status ? { status } : {}),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then((result) => {
        if (!cancelled)
          setLoad({
            status: 'ready',
            items: result.items,
            hasMore: result.items.length === PAGE_SIZE,
          });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const described = describeMerchantReadError(error);
          setLoad({
            status: 'error',
            title: described.title,
            description: described.description,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, query, status, page, retryKey]);

  const retry = useCallback(() => {
    setPage(0);
    setRetryKey((key) => key + 1);
  }, []);
  return { load, retry };
}

export function MerchantsPage() {
  const session = useAdminSession();
  const marketId = session.bootstrap?.currentMarket?.id;
  const [activeTab, setActiveTab] = useState<'applications' | 'merchants'>(
    'applications',
  );
  const [queueStatus, setQueueStatus] = useState<
    AdminMerchantApplicationQueueStatus | ''
  >('');
  const [listStatus, setListStatus] = useState<AdminMerchantListStatus | ''>(
    '',
  );
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [queuePage, setQueuePage] = useState(0);
  const [listPage, setListPage] = useState(0);

  const applications = useMerchantApplications(marketId, queueStatus);
  const merchants = useMerchantList(marketId, submittedSearch, listStatus);

  const queueReset = useCallback(() => {
    setQueuePage(0);
  }, []);
  const listReset = useCallback(() => {
    setListPage(0);
  }, []);

  return (
    <section
      aria-labelledby="admin-merchants-title"
      className="admin-merchants"
    >
      <PageHeader
        eyebrow="Commerce"
        title={<span id="admin-merchants-title">Merchants</span>}
        description={`Selected-market merchant application queue and merchant list for ${
          session.bootstrap?.currentMarket?.name ?? 'the current market'
        }. All rows are server-scoped owner reads.`}
      />

      <Tabs
        label="Merchant operations views"
        activeId={activeTab}
        onChange={(id) =>
          setActiveTab(id === 'merchants' ? 'merchants' : 'applications')
        }
        tabs={[
          { id: 'applications', label: 'Applications' },
          { id: 'merchants', label: 'Merchants' },
        ]}
      />

      {activeTab === 'applications' ? (
        <div
          id="ip-panel-applications"
          role="tabpanel"
          aria-labelledby="ip-tab-applications"
          className="admin-merchants-panel"
        >
          <FilterBar
            filters={
              <Select
                aria-label="Filter applications by status"
                value={queueStatus}
                onChange={(event) => {
                  setQueueStatus(
                    event.target.value as
                      | AdminMerchantApplicationQueueStatus
                      | '',
                  );
                  queueReset();
                }}
              >
                {merchantApplicationQueueStatusFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            }
          />

          {applications.load.status === 'loading' ? (
            <MerchantListSkeleton rows={5} />
          ) : null}

          {applications.load.status === 'error' ? (
            <MerchantErrorState
              title={applications.load.title}
              description={applications.load.description}
              onRetry={applications.retry}
            />
          ) : null}

          {applications.load.status === 'ready' &&
          applications.load.items.length === 0 ? (
            <MerchantEmptyState
              title="No applications found"
              description="The server confirmed there are no merchant applications matching this filter in the selected market."
            />
          ) : null}

          {applications.load.status === 'ready' &&
          applications.load.items.length > 0 ? (
            <Card className="admin-merchants-table">
              <Table aria-label="Merchant applications pending review">
                <thead>
                  <tr>
                    <th scope="col">Merchant</th>
                    <th scope="col">Application</th>
                    <th scope="col">Operational</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.load.items.map((item) => (
                    <tr key={item.application_id}>
                      <td>
                        <Link
                          to={routePath('merchant-detail', {
                            marketId: marketId ?? '',
                            branchId: item.branch_id,
                          })}
                        >
                          {item.display_name}
                        </Link>
                        <small className="admin-merchants-id">
                          {item.merchant_id}
                        </small>
                      </td>
                      <td>
                        <Badge tone="info">
                          {merchantApplicationStatusLabel(
                            item.application_status,
                          )}
                        </Badge>
                      </td>
                      <td>
                        <Badge
                          tone={operationalBadgeTone(item.operational_status)}
                        >
                          {merchantOperationalStatusLabel(
                            item.operational_status,
                          )}
                        </Badge>
                      </td>
                      <td>{formatMerchantTimestamp(item.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {applications.load.hasMore ? (
                <div className="admin-merchants-more">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setQueuePage((page) => page + 1)}
                  >
                    Load more applications
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'merchants' ? (
        <div
          id="ip-panel-merchants"
          role="tabpanel"
          aria-labelledby="ip-tab-merchants"
          className="admin-merchants-panel"
        >
          <FilterBar
            search={
              <SearchField
                aria-label="Search merchants by name or merchant id"
                placeholder="Search name or merchant id"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setSubmittedSearch(search);
                    listReset();
                  }
                }}
              />
            }
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSubmittedSearch(search);
                  listReset();
                }}
              >
                Search
              </Button>
            }
            filters={
              <Select
                aria-label="Filter merchants by status"
                value={listStatus}
                onChange={(event) => {
                  setListStatus(
                    event.target.value as AdminMerchantListStatus | '',
                  );
                  listReset();
                }}
              >
                {merchantListStatusFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            }
          />

          {merchants.load.status === 'loading' ? (
            <MerchantListSkeleton rows={5} />
          ) : null}

          {merchants.load.status === 'error' ? (
            <MerchantErrorState
              title={merchants.load.title}
              description={merchants.load.description}
              onRetry={merchants.retry}
            />
          ) : null}

          {merchants.load.status === 'ready' &&
          merchants.load.items.length === 0 ? (
            <MerchantEmptyState
              title="No merchants found"
              description="The server confirmed there are no merchants matching this filter in the selected market."
            />
          ) : null}

          {merchants.load.status === 'ready' &&
          merchants.load.items.length > 0 ? (
            <Card className="admin-merchants-table">
              <Table aria-label="Selected-market merchant list">
                <thead>
                  <tr>
                    <th scope="col">Merchant</th>
                    <th scope="col">Operational</th>
                    <th scope="col">Application</th>
                    <th scope="col">KYC</th>
                    <th scope="col">MCP balance</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {merchants.load.items.map((item) => (
                    <tr key={item.branch_id}>
                      <td>
                        <Link
                          to={routePath('merchant-detail', {
                            marketId: marketId ?? '',
                            branchId: item.branch_id,
                          })}
                        >
                          {item.name}
                        </Link>
                        <small className="admin-merchants-id">
                          {item.merchant_id}
                        </small>
                      </td>
                      <td>
                        <Badge tone={operationalBadgeTone(item.status)}>
                          {merchantOperationalStatusLabel(item.status)}
                        </Badge>
                      </td>
                      <td>
                        {item.application_status
                          ? merchantApplicationStatusLabel(
                              item.application_status,
                            )
                          : '—'}
                      </td>
                      <td>
                        {item.kyc_status
                          ? merchantApplicationStatusLabel(item.kyc_status)
                          : '—'}
                      </td>
                      <td>
                        {item.available_balance !== null &&
                        item.available_balance !== undefined
                          ? item.available_balance
                          : '—'}
                      </td>
                      <td>{formatMerchantTimestamp(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {merchants.load.hasMore ? (
                <div className="admin-merchants-more">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setListPage((page) => page + 1)}
                  >
                    Load more merchants
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function operationalBadgeTone(
  status: string,
): 'success' | 'warning' | 'error' | 'info' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'SUSPENDED' || status === 'CLOSED') return 'error';
  if (status === 'CLOSURE_PENDING') return 'warning';
  return 'info';
}

import {
  type AdminKycOpsMerchantQueueQuery,
  type AdminKycOpsMerchantQueueStatus,
} from '@ipoint/api-client';
import {
  Button,
  FilterBar,
  FormField,
  PageHeader,
  Pagination,
  Select,
  Table,
} from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminSession } from './admin-session.js';
import { adminKycOpsApi } from './admin-api.js';
import { formatTimestamp } from './dashboard-model.js';
import { kycErrorCopy, merchantKycCaseHref } from './kyc-model.js';
import { KycQueueSkeleton, MerchantKycStatusBadge } from './kyc-states.js';
import { ShellState } from './shell-states.js';

/**
 * P7-S5C selected-market merchant KYC submissions queue.
 *
 * Server-bound Current Admin Market; status filter and offset paging pass
 * through to the adapter (the owner queue read). Queue rows are masked
 * summaries — no submission payload is ever included.
 */

type ListLoad =
  | { status: 'loading' }
  | {
      status: 'ready';
      queue: Awaited<ReturnType<typeof adminKycOpsApi.merchantKycList>>;
    }
  | { status: 'error'; title: string; description: string };

const PAGE_SIZE = 50;

const STATUS_FILTERS: ReadonlyArray<{
  value: '' | AdminKycOpsMerchantQueueStatus;
  label: string;
}> = [
  { value: '', label: 'All statuses' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'RESUBMISSION_REQUIRED', label: 'Resubmission required' },
];

function describeError(error: unknown): { title: string; description: string } {
  const copy = kycErrorCopy(error);
  if (copy.title === 'KYC review unavailable') {
    return {
      title: 'Merchant KYC queue unavailable',
      description: copy.description,
    };
  }
  return copy;
}

function listErrorKind(
  title: string,
): 'error' | 'permission-denied' | 'conflict' | 'disabled' {
  if (title.includes('Permission denied')) return 'permission-denied';
  if (title.includes('outside the selected market')) return 'conflict';
  if (title.includes('No Current Admin Market')) return 'disabled';
  return 'error';
}

export function MerchantKycQueuePage() {
  const session = useAdminSession();
  const marketId = session.bootstrap?.currentMarket?.id;
  const [load, setLoad] = useState<ListLoad>({ status: 'loading' });
  const [requestKey, setRequestKey] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | AdminKycOpsMerchantQueueStatus>('');

  const fetchList = useCallback(() => {
    if (!marketId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    const query: AdminKycOpsMerchantQueueQuery = {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    };
    if (status) query.status = status;
    adminKycOpsApi
      .merchantKycList(query)
      .then((queue) => {
        if (!cancelled) setLoad({ status: 'ready', queue });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const described = describeError(error);
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
  }, [marketId, page, status]);

  useEffect(() => {
    return fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId, page, status, requestKey]);

  const retry = useCallback(() => setRequestKey((key) => key + 1), []);

  // The owner queue has no total; a page shorter than the page size is the
  // last page. Show the next page whenever a full page was returned.
  const hasMore =
    load.status === 'ready' && load.queue.items.length === PAGE_SIZE;

  return (
    <section
      aria-labelledby="admin-kyc-merchants-title"
      className="admin-kyc-merchants"
    >
      <PageHeader
        eyebrow="Reviews"
        title={<span id="admin-kyc-merchants-title">Merchant KYC queue</span>}
        description={`Selected-market merchant KYC submissions for ${
          session.bootstrap?.currentMarket?.name ?? 'the current market'
        }. Submission payloads are masked; raw evidence requires a dedicated permission, a recorded reason, and MFA step-up.`}
      />

      <FilterBar
        filters={
          <FormField label="Status" htmlFor="admin-kyc-merchant-status-filter">
            <Select
              id="admin-kyc-merchant-status-filter"
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(
                  event.target.value as '' | AdminKycOpsMerchantQueueStatus,
                );
              }}
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormField>
        }
        actions={
          <Button variant="secondary" onClick={retry}>
            Refresh queue
          </Button>
        }
        resultSummary={
          load.status === 'ready' ? (
            <p className="admin-kyc-summary" role="status">
              {load.queue.items.length} submission
              {load.queue.items.length === 1 ? '' : 's'} on this page
              {status ? ` (${status})` : ''} in the selected market.
            </p>
          ) : null
        }
      />

      {load.status === 'loading' ? <KycQueueSkeleton /> : null}

      {load.status === 'error' ? (
        <ShellState
          kind={listErrorKind(load.title)}
          title={load.title}
          description={load.description}
          action={<Button onClick={retry}>Retry merchant KYC queue</Button>}
        />
      ) : null}

      {load.status === 'ready' && load.queue.items.length === 0 ? (
        <ShellState
          kind="empty"
          title="No merchant KYC submissions found"
          description="The server confirmed that this selected-market queue has no matching submissions. Adjust the status filter."
        />
      ) : null}

      {load.status === 'ready' && load.queue.items.length > 0 ? (
        <>
          <Table aria-label="Merchant KYC submissions in the selected market">
            <thead>
              <tr>
                <th scope="col">Merchant</th>
                <th scope="col">Status</th>
                <th scope="col">Version</th>
                <th scope="col">Submitted</th>
                <th scope="col">Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {load.queue.items.map((item) => (
                <tr key={item.submission_id}>
                  <td>
                    <Link
                      to={merchantKycCaseHref(marketId ?? '', item.branch_id)}
                      className="admin-kyc-link"
                    >
                      {item.display_name}
                    </Link>
                    <small>{item.merchant_id}</small>
                  </td>
                  <td>
                    <MerchantKycStatusBadge status={item.status} />
                  </td>
                  <td>v{item.submission_version}</td>
                  <td>
                    <time dateTime={item.submitted_at ?? ''}>
                      {item.submitted_at
                        ? formatTimestamp(item.submitted_at)
                        : '—'}
                    </time>
                  </td>
                  <td>
                    <time dateTime={item.reviewed_at ?? ''}>
                      {item.reviewed_at
                        ? formatTimestamp(item.reviewed_at)
                        : '—'}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={page}
            totalPages={Math.max(1, page + (hasMore ? 1 : 0))}
            onPageChange={setPage}
            label="Merchant KYC queue pagination"
          />
        </>
      ) : null}
    </section>
  );
}

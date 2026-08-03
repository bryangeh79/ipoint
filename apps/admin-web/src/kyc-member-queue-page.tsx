import {
  type AdminKycOpsListQuery,
  type AdminKycOpsStatus,
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
import { kycErrorCopy, memberKycCaseHref } from './kyc-model.js';
import { KycQueueSkeleton, KycStatusBadge } from './kyc-states.js';
import { ShellState } from './shell-states.js';

/**
 * P7-S5C selected-market member KYC queue.
 *
 * The market is the server-bound Current Admin Market (never client-supplied);
 * status filter and paging are passed through to the adapter which forces the
 * market filter server-side. Masked summaries only — emails are masked by the
 * owner service.
 */

type ListLoad =
  | { status: 'loading' }
  | {
      status: 'ready';
      page: Awaited<ReturnType<typeof adminKycOpsApi.memberKycList>>;
    }
  | { status: 'error'; title: string; description: string };

const STATUS_FILTERS: ReadonlyArray<{
  value: '' | AdminKycOpsStatus;
  label: string;
}> = [
  { value: '', label: 'All statuses' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'MORE_INFO_REQUIRED', label: 'More info required' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'REVERIFICATION_REQUIRED', label: 'Reverification required' },
];

function describeError(error: unknown): { title: string; description: string } {
  const copy = kycErrorCopy(error);
  if (copy.title === 'KYC review unavailable') {
    return {
      title: 'Member KYC queue unavailable',
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

export function MemberKycQueuePage() {
  const session = useAdminSession();
  const marketId = session.bootstrap?.currentMarket?.id;
  const [load, setLoad] = useState<ListLoad>({ status: 'loading' });
  const [requestKey, setRequestKey] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | AdminKycOpsStatus>('');

  const fetchList = useCallback(() => {
    if (!marketId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    const query: AdminKycOpsListQuery = { page, pageSize: 20 };
    if (status) query.status = status;
    adminKycOpsApi
      .memberKycList(query)
      .then((result) => {
        if (!cancelled) setLoad({ status: 'ready', page: result });
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

  const totalPages =
    load.status === 'ready'
      ? Math.max(1, Math.ceil(load.page.total / load.page.pageSize))
      : 1;

  return (
    <section
      aria-labelledby="admin-kyc-members-title"
      className="admin-kyc-members"
    >
      <PageHeader
        eyebrow="Reviews"
        title={<span id="admin-kyc-members-title">Member KYC queue</span>}
        description={`Selected-market member KYC cases for ${
          session.bootstrap?.currentMarket?.name ?? 'the current market'
        }. Email and identity fields are masked; raw evidence requires a dedicated permission, a recorded reason, and MFA step-up.`}
      />

      <FilterBar
        filters={
          <FormField label="Status" htmlFor="admin-kyc-member-status-filter">
            <Select
              id="admin-kyc-member-status-filter"
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value as '' | AdminKycOpsStatus);
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
              {load.page.total} member KYC case
              {load.page.total === 1 ? '' : 's'} in the selected market.
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
          action={<Button onClick={retry}>Retry member KYC queue</Button>}
        />
      ) : null}

      {load.status === 'ready' && load.page.items.length === 0 ? (
        <ShellState
          kind="empty"
          title="No member KYC cases found"
          description="The server confirmed that this selected-market queue has no matching cases. Adjust the status filter."
        />
      ) : null}

      {load.status === 'ready' && load.page.items.length > 0 ? (
        <>
          <Table aria-label="Member KYC cases in the selected market">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Status</th>
                <th scope="col">Level</th>
                <th scope="col">Country</th>
                <th scope="col">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {load.page.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link
                      to={memberKycCaseHref(marketId ?? '', item.id)}
                      className="admin-kyc-link"
                    >
                      {item.member.publicMemberId}
                    </Link>
                    <small>
                      {item.member.displayName ?? 'No display name'} ·{' '}
                      {item.member.email}
                    </small>
                  </td>
                  <td>
                    <KycStatusBadge status={item.status} />
                  </td>
                  <td>{item.levelRequested}</td>
                  <td>{item.member.accountCountry}</td>
                  <td>
                    <time dateTime={item.submittedAt ?? ''}>
                      {item.submittedAt
                        ? formatTimestamp(item.submittedAt)
                        : '—'}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            label="Member KYC queue pagination"
          />
        </>
      ) : null}
    </section>
  );
}

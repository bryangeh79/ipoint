import {
  type AdminMemberOpsListPageDto,
  type AdminMemberOpsListQuery,
  type AdminMemberOpsStatus,
} from '@ipoint/api-client';
import {
  Button,
  FilterBar,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  FormField,
  Table,
} from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from './admin-api.js';
import { formatTimestamp } from './dashboard-model.js';
import { MemberListSkeleton, MemberStatusBadge } from './member-ops-states.js';
import { memberDetailHref, memberOpsErrorCopy } from './member-ops-model.js';
import { ApiErrorState, ShellState } from './shell-states.js';
import { useAdminSession } from './admin-session.js';

/**
 * P7-S5A selected-market member list.
 *
 * The market is the server-bound Current Admin Market (never client-supplied);
 * search/filter/paging are passed through to the adapter which forces the
 * market filter server-side. Loading, empty, error, and denied states are
 * explicit; masked summaries only.
 */

type ListLoad =
  | { status: 'loading' }
  | { status: 'ready'; page: AdminMemberOpsListPageDto }
  | { status: 'error'; title: string; description: string };

const STATUS_FILTERS: ReadonlyArray<{
  value: '' | AdminMemberOpsStatus;
  label: string;
}> = [
  { value: '', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'PENDING_EMAIL_VERIFICATION', label: 'Pending email verification' },
];

function describeError(error: unknown): { title: string; description: string } {
  const copy = memberOpsErrorCopy(error);
  if (copy.title === 'Member operations unavailable') {
    return { title: 'Members unavailable', description: copy.description };
  }
  return copy;
}

function listErrorKind(
  title: string,
): 'error' | 'permission-denied' | 'conflict' | 'offline' | 'disabled' {
  if (title.includes('Permission denied')) return 'permission-denied';
  if (title.includes('outside the selected market')) return 'conflict';
  if (title.includes('No Current Admin Market')) return 'disabled';
  if (title.toLowerCase().includes('offline')) return 'offline';
  return 'error';
}

export function MemberListPage() {
  const session = useAdminSession();
  const marketId = session.bootstrap?.currentMarket?.id;
  const [load, setLoad] = useState<ListLoad>({ status: 'loading' });
  const [requestKey, setRequestKey] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | AdminMemberOpsStatus>('');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');

  const fetchList = useCallback(
    (filters: AdminMemberOpsListQuery) => {
      if (!marketId) return;
      let cancelled = false;
      setLoad({ status: 'loading' });
      adminApi
        .memberOpsList(filters)
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
    },
    [marketId],
  );

  useEffect(() => {
    const filters: AdminMemberOpsListQuery = {
      page,
      pageSize: 20,
      sort: 'createdAt:desc',
    };
    if (status) filters.status = status;
    if (submittedQuery) filters.query = submittedQuery;
    return fetchList(filters);
  }, [marketId, page, status, submittedQuery, requestKey, fetchList]);

  const retry = useCallback(() => setRequestKey((key) => key + 1), []);

  const totalPages =
    load.status === 'ready'
      ? Math.max(1, Math.ceil(load.page.total / load.page.pageSize))
      : 1;

  return (
    <section aria-labelledby="admin-members-title" className="admin-members">
      <PageHeader
        eyebrow="People"
        title={<span id="admin-members-title">Members</span>}
        description={`Selected-market member list for ${session.bootstrap?.currentMarket?.name ?? 'the current market'}. Email and identity fields are masked server-side.`}
      />

      <FilterBar
        search={
          <SearchField
            label="Search members"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setPage(1);
                setSubmittedQuery(query.trim());
              }
            }}
            onClear={() => {
              setQuery('');
              setPage(1);
              setSubmittedQuery('');
            }}
            placeholder="Public id, email, or referral code"
          />
        }
        filters={
          <FormField label="Status" htmlFor="member-status-filter">
            <Select
              id="member-status-filter"
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value as '' | AdminMemberOpsStatus);
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
            Refresh list
          </Button>
        }
        resultSummary={
          load.status === 'ready' ? (
            <p className="admin-members-summary" role="status">
              {load.page.total} member{load.page.total === 1 ? '' : 's'} in the
              selected market.
            </p>
          ) : null
        }
      />

      {load.status === 'loading' ? <MemberListSkeleton /> : null}

      {load.status === 'error' ? (
        <ShellState
          kind={listErrorKind(load.title)}
          title={load.title}
          description={load.description}
          action={<Button onClick={retry}>Retry member list</Button>}
        />
      ) : null}

      {load.status === 'ready' && load.page.members.length === 0 ? (
        <ShellState
          kind="empty"
          title="No members found"
          description="The server confirmed that this selected-market view has no matching members. Adjust the filters or search query."
        />
      ) : null}

      {load.status === 'ready' && load.page.members.length > 0 ? (
        <>
          <Table aria-label="Members in the selected market">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Status</th>
                <th scope="col">KYC</th>
                <th scope="col">Country</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {load.page.members.map((member) => (
                <tr key={member.publicMemberId}>
                  <td>
                    <Link
                      to={memberDetailHref(
                        marketId ?? '',
                        member.publicMemberId,
                      )}
                      className="admin-members-link"
                    >
                      {member.publicMemberId}
                    </Link>
                    <small>
                      {member.displayName ?? 'No display name'} · {member.email}
                    </small>
                  </td>
                  <td>
                    <MemberStatusBadge status={member.status} />
                  </td>
                  <td>
                    <span className="admin-members-kyc">{member.kycLevel}</span>
                  </td>
                  <td>{member.accountCountry}</td>
                  <td>
                    <time dateTime={member.createdAt}>
                      {formatTimestamp(member.createdAt)}
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
            label="Members pagination"
          />
        </>
      ) : null}
    </section>
  );
}

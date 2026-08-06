import { AdminIpointAdjustmentQueueDto } from '@ipoint/api-client';
import { Card, PageHeader, Table, Select } from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminIpointAdjustOpsApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import {
  describeIpointAdjustmentReadError,
  formatIpointUtc,
  orderIpointAdjustments,
  type IpointAdjustmentPageErrorCopy,
} from './ipoint-adjust-model.js';
import {
  IpointAdjustmentEmptyState,
  IpointAdjustmentErrorState,
  IpointAdjustmentSkeleton,
  IpointAdjustmentStateBadge,
} from './ipoint-adjust-states.js';

/**
 * P7-S7B Manual iPoint Adjustment Finance queue (SEC-01 §6 / P7-S1 §17).
 *
 * Read-only, selected-market, state-filterable queue of durable iPoint
 * adjustment requests (newest first). Every row links to the request
 * detail where the maker submits and the checker decides/executes. The
 * queue read requires `wallet.ipoint.read` (Finance roles + Super Admin,
 * marketScoped); the server Current Admin Market is enforced by the
 * canonical RbacGuard.
 */

type QueueLoad =
  | { status: 'loading' }
  | { status: 'ready'; queue: AdminIpointAdjustmentQueueDto }
  | ({ status: 'error' } & IpointAdjustmentPageErrorCopy);

const STATE_OPTIONS = [
  'ALL',
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
] as const;

export function IpointAdjustQueuePage() {
  const { marketId } = useParams<{ marketId: string }>();
  const session = useAdminSession();
  const [load, setLoad] = useState<QueueLoad>({ status: 'loading' });
  const [stateFilter, setStateFilter] = useState<string>('ALL');
  const [retryKey, setRetryKey] = useState(0);

  const loadQueue = useCallback(async () => {
    if (!marketId) return;
    setLoad({ status: 'loading' });
    try {
      const queue = await adminIpointAdjustOpsApi.listAdjustments(marketId, {
        ...(stateFilter !== 'ALL' ? { state: stateFilter } : {}),
        limit: 100,
      });
      setLoad({ status: 'ready', queue });
    } catch (error: unknown) {
      setLoad({ status: 'error', ...describeIpointAdjustmentReadError(error) });
    }
  }, [marketId, stateFilter]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue, retryKey]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  const items =
    load.status === 'ready' ? orderIpointAdjustments(load.queue.items) : [];

  return (
    <div className="admin-page">
      <PageHeader
        title="Manual iPoint adjustment queue"
        description="Selected-market durable iPoint adjustment requests (Maker → Checker → execute). Requests are created by a Finance Operator, submitted for review, decided by a Finance Approver (never the maker), and executed only after approval. Amounts are exact decimals; the frozen SEC-01 owner enforces caps, evidence, Maker≠Checker inequality and atomic ledger execution server-side."
      />

      <section aria-label="Adjustment queue">
        <h2 className="admin-reward-section">Adjustment requests</h2>
        <Card>
          <div className="admin-reward-form">
            <label className="admin-reward-muted" htmlFor="ipoint-state-filter">
              State filter
            </label>
            <Select
              id="ipoint-state-filter"
              aria-label="State filter"
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value)}
            >
              {STATE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 'ALL' ? 'All states' : option}
                </option>
              ))}
            </Select>
          </div>

          {load.status === 'loading' ? <IpointAdjustmentSkeleton /> : null}
          {load.status === 'error' ? (
            <IpointAdjustmentErrorState
              title={load.title}
              description={load.description}
              onRetry={retry}
            />
          ) : null}
          {load.status === 'ready' && items.length === 0 ? (
            <IpointAdjustmentEmptyState />
          ) : null}
          {load.status === 'ready' && items.length > 0 ? (
            <Table aria-label="iPoint adjustment requests">
              <thead>
                <tr>
                  <th scope="col">State</th>
                  <th scope="col">Direction</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Reason code</th>
                  <th scope="col">Case reference</th>
                  <th scope="col">Created (UTC)</th>
                  <th scope="col">Maker</th>
                  <th scope="col">Checker</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    data-testid={`ipoint-adjustment-${item.id}`}
                  >
                    <td>
                      <IpointAdjustmentStateBadge state={item.state} />
                    </td>
                    <td>
                      <span
                        data-testid={`ipoint-direction-${item.id}`}
                        className={
                          item.direction === 'DEBIT'
                            ? 'admin-reward-muted'
                            : undefined
                        }
                      >
                        {item.direction}
                      </span>
                    </td>
                    <td data-testid={`ipoint-amount-${item.id}`}>
                      {item.amount}
                    </td>
                    <td>{item.reasonCode}</td>
                    <td>{item.caseReference}</td>
                    <td>
                      <span className="admin-reward-muted">
                        {formatIpointUtc(item.createdAt)}
                      </span>
                    </td>
                    <td>
                      <span className="admin-reward-muted">
                        {item.makerAdminUserId.slice(0, 8)}
                      </span>
                    </td>
                    <td>
                      <span className="admin-reward-muted">
                        {item.checkerAdminUserId
                          ? item.checkerAdminUserId.slice(0, 8)
                          : '—'}
                      </span>
                    </td>
                    <td>
                      {marketId ? (
                        <Link
                          to={`/admin/${encodeURIComponent(marketId)}/ipoint-adjustments/${encodeURIComponent(item.id)}`}
                        >
                          Open
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </Card>
      </section>
    </div>
  );
}

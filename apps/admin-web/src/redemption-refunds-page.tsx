import type { AdminRefundQueueDto } from '@ipoint/api-client';
import { Button, Card, PageHeader, Select, Table } from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminRedemptionFulfilmentOpsApi } from './admin-api.js';
import {
  describeRedemptionReadError,
  formatRedemptionUtc,
  refundStatusLabel,
  type RedemptionOpsPageErrorCopy,
} from './redemption-fulfilment-ops-model.js';
import {
  RedemptionOpsEmptyState,
  RedemptionOpsSkeleton,
  RefundStatusBadge,
} from './redemption-fulfilment-ops-states.js';

/**
 * P7-S8 Refund queue page (Command Center 2026-08-07 §6.2 refund views).
 *
 * Selected-market refund request queue (status-filterable) over the
 * FROZEN SEC-02 owner read face. Read-only: refund creation/approval stay
 * exclusively on the frozen Phase 6 routes; this surface exposes no
 * refund write. Rows link to the refund detail with the REFUND_* status
 * history.
 */

type RefundLoad =
  | { status: 'loading' }
  | { status: 'ready'; data: AdminRefundQueueDto }
  | ({ status: 'error' } & RedemptionOpsPageErrorCopy);

const REFUND_STATUS_OPTIONS = [
  'ALL',
  'PENDING_CHECKER',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
] as const;

export function RedemptionRefundsPage() {
  const { marketId } = useParams<{ marketId: string }>();
  const [load, setLoad] = useState<RefundLoad>({ status: 'loading' });
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [retryKey, setRetryKey] = useState(0);

  const loadRefunds = useCallback(async () => {
    if (!marketId) return;
    setLoad({ status: 'loading' });
    try {
      const data = await adminRedemptionFulfilmentOpsApi.refundQueue(marketId, {
        ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
        limit: 100,
      });
      setLoad({ status: 'ready', data });
    } catch (error: unknown) {
      setLoad({ status: 'error', ...describeRedemptionReadError(error) });
    }
  }, [marketId, statusFilter]);

  useEffect(() => {
    void loadRefunds();
  }, [loadRefunds, retryKey]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  const items = load.status === 'ready' ? load.data.items : [];

  return (
    <div className="admin-page">
      <PageHeader
        title="Refund queue"
        description="Selected-market refund requests over the frozen SEC-02 owner (read face): queue, detail and the immutable REFUND_* status history. Creation and approval stay exclusively on the frozen Phase 6 routes; this surface performs no refund write."
      />

      <section aria-label="Refund queue">
        <h2 className="admin-reward-section">Refund requests</h2>
        <Card>
          <div className="admin-reward-form">
            <label
              className="admin-reward-muted"
              htmlFor="refund-status-filter"
            >
              Status filter
            </label>
            <Select
              id="refund-status-filter"
              aria-label="Refund status filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {REFUND_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 'ALL'
                    ? 'All statuses'
                    : refundStatusLabel(option)}
                </option>
              ))}
            </Select>
          </div>

          {load.status === 'loading' ? <RedemptionOpsSkeleton /> : null}
          {load.status === 'error' ? (
            <div className="admin-state" role="alert">
              <p className="admin-state__title">{load.title}</p>
              <p className="admin-state__body">{load.description}</p>
              <Button onClick={retry}>Try again safely</Button>
            </div>
          ) : null}
          {load.status === 'ready' && items.length === 0 ? (
            <RedemptionOpsEmptyState
              title="No refund requests"
              description="No refund requests exist for this market in the selected status."
            />
          ) : null}
          {load.status === 'ready' && items.length > 0 ? (
            <Table>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Status</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Requested</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.refund_request_id}>
                    <td>{item.order_reference}</td>
                    <td>
                      <RefundStatusBadge status={item.status} />
                    </td>
                    <td data-testid={`refund-amount-${item.refund_request_id}`}>
                      {item.refund_amount}
                    </td>
                    <td>{item.reason}</td>
                    <td>{formatRedemptionUtc(item.created_at)}</td>
                    <td>
                      <Link
                        to={`/admin/${marketId}/redemptions/refunds/${item.refund_request_id}`}
                        className="admin-link"
                      >
                        Open
                      </Link>
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

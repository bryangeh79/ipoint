import type { AdminRefundDetailDto } from '@ipoint/api-client';
import { Button, Card, PageHeader, Table } from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminRedemptionFulfilmentOpsApi } from './admin-api.js';
import {
  describeRedemptionReadError,
  formatRedemptionUtc,
  type RedemptionOpsPageErrorCopy,
} from './redemption-fulfilment-ops-model.js';
import {
  RedemptionOpsEmptyState,
  RedemptionOpsSkeleton,
  RefundStatusBadge,
} from './redemption-fulfilment-ops-states.js';

/**
 * P7-S8 Refund detail page (Command Center 2026-08-07 §6.2 refund views).
 *
 * Selected-market refund request detail with the immutable REFUND_* owner
 * audit history (REFUND_REQUESTED / REFUND_APPROVED / REFUND_EXECUTED /
 * REFUND_REJECTED / REFUND_EXECUTION_FAILED). Read-only: refund
 * decisions stay exclusively on the frozen Phase 6 routes (Maker/Checker
 * with step-up).
 */

type RefundLoad =
  | { status: 'loading' }
  | { status: 'ready'; data: AdminRefundDetailDto }
  | ({ status: 'error' } & RedemptionOpsPageErrorCopy);

export function RedemptionRefundDetailPage() {
  const { marketId, refundId } = useParams<{
    marketId: string;
    refundId: string;
  }>();
  const [load, setLoad] = useState<RefundLoad>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);

  const loadRefund = useCallback(async () => {
    if (!marketId || !refundId) return;
    setLoad({ status: 'loading' });
    try {
      const data = await adminRedemptionFulfilmentOpsApi.refundDetail(
        marketId,
        refundId,
      );
      setLoad({ status: 'ready', data });
    } catch (error: unknown) {
      setLoad({ status: 'error', ...describeRedemptionReadError(error) });
    }
  }, [marketId, refundId]);

  useEffect(() => {
    void loadRefund();
  }, [loadRefund, retryKey]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  const data = load.status === 'ready' ? load.data : null;

  return (
    <div className="admin-page">
      <PageHeader
        title="Refund detail"
        description="Selected-market refund request with the immutable REFUND_* owner audit history. This is a read face over the frozen SEC-02 owner: refund creation, approval and execution stay exclusively on the frozen Phase 6 routes (Maker/Checker, step-up)."
      />

      {load.status === 'loading' ? <RedemptionOpsSkeleton rows={6} /> : null}
      {load.status === 'error' ? (
        <div className="admin-state" role="alert">
          <p className="admin-state__title">{load.title}</p>
          <p className="admin-state__body">{load.description}</p>
          <Button onClick={retry}>Try again safely</Button>
        </div>
      ) : null}
      {load.status === 'ready' && data ? (
        <>
          <Card>
            <dl className="admin-detail-grid">
              <div>
                <dt>Order</dt>
                <dd data-testid="refund-order-reference">
                  {data.order_reference}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <RefundStatusBadge status={data.status} />
                </dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd data-testid="refund-amount">{data.refund_amount}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{data.reason}</dd>
              </div>
              <div>
                <dt>Maker</dt>
                <dd>{data.maker_id.slice(0, 8)}…</dd>
              </div>
              <div>
                <dt>Checker</dt>
                <dd>
                  {data.checker_id ? `${data.checker_id.slice(0, 8)}…` : '—'}
                </dd>
              </div>
              <div>
                <dt>Prior order status</dt>
                <dd>{data.prior_order_status ?? '—'}</dd>
              </div>
              <div>
                <dt>Decided / executed</dt>
                <dd>
                  {formatRedemptionUtc(data.decided_at)} /{' '}
                  {formatRedemptionUtc(data.executed_at)}
                </dd>
              </div>
            </dl>
            {data.failure_reason ? (
              <p className="admin-state__body" role="alert">
                Failure reason: {data.failure_reason}
              </p>
            ) : null}
          </Card>

          <Card>
            <h3 className="admin-reward-section">Status history</h3>
            {data.status_history.length === 0 ? (
              <RedemptionOpsEmptyState description="No REFUND_* events recorded for this request." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Result</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Actor</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.status_history.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.action}</td>
                      <td>{entry.result}</td>
                      <td>{entry.reason ?? '—'}</td>
                      <td>
                        {entry.actor_id
                          ? `${entry.actor_id.slice(0, 8)}…`
                          : '—'}
                      </td>
                      <td>{formatRedemptionUtc(entry.occurred_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

import type { AdminOrderDetailDto } from '@ipoint/api-client';
import { Button, Card, PageHeader, Table } from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminRedemptionFulfilmentOpsApi } from './admin-api.js';
import {
  describeRedemptionActionError,
  describeRedemptionReadError,
  formatRedemptionUtc,
  type RedemptionOpsPageErrorCopy,
} from './redemption-fulfilment-ops-model.js';
import {
  RedemptionOpsEmptyState,
  RedemptionOpsSkeleton,
} from './redemption-fulfilment-ops-states.js';

/**
 * P7-S8 Redemption order detail page (Command Center 2026-08-07 §6.2-§6.6).
 *
 * Selected-market order detail with the owner-owned immutable audit
 * history and the orchestrated actions (suspend / resume / retry —
 * `redemption.fulfilment.manage`). Every action delegates 1:1 to the
 * frozen Phase 6 owner commands with the server Current Admin Market;
 * the reason is mandatory for suspend. Failed actions surface the
 * design-system state (conflict / permission-denied), never a fabricated
 * success.
 */

type OrderLoad =
  | { status: 'loading' }
  | { status: 'ready'; data: AdminOrderDetailDto }
  | ({ status: 'error' } & RedemptionOpsPageErrorCopy);

type ActionState =
  | { status: 'idle' }
  | { status: 'working'; action: string }
  | ({ status: 'error' } & RedemptionOpsPageErrorCopy)
  | { status: 'success'; message: string };

export function RedemptionOrderDetailPage() {
  const { marketId, orderId } = useParams<{
    marketId: string;
    orderId: string;
  }>();
  const [load, setLoad] = useState<OrderLoad>({ status: 'loading' });
  const [action, setAction] = useState<ActionState>({ status: 'idle' });
  const [reason, setReason] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  const loadOrder = useCallback(async () => {
    if (!marketId || !orderId) return;
    setLoad({ status: 'loading' });
    try {
      const data = await adminRedemptionFulfilmentOpsApi.orderDetail(
        marketId,
        orderId,
      );
      setLoad({ status: 'ready', data });
    } catch (error: unknown) {
      setLoad({ status: 'error', ...describeRedemptionReadError(error) });
    }
  }, [marketId, orderId]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder, retryKey]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  const data = load.status === 'ready' ? load.data : null;

  const runAction = useCallback(
    async (kind: 'suspend' | 'resume' | 'retry') => {
      if (!marketId || !orderId) return;
      if (kind === 'suspend' && !reason.trim()) {
        setAction({
          status: 'error',
          kind: 'error',
          title: 'Reason required',
          description: 'Enter a reason to suspend this order.',
        });
        return;
      }
      setAction({ status: 'working', action: kind });
      try {
        if (kind === 'suspend') {
          const result = await adminRedemptionFulfilmentOpsApi.suspendOrder(
            marketId,
            orderId,
            reason.trim(),
          );
          setAction({
            status: 'success',
            message: `Order suspended — ${result.status}`,
          });
        } else if (kind === 'resume') {
          const result = await adminRedemptionFulfilmentOpsApi.resumeOrder(
            marketId,
            orderId,
          );
          setAction({
            status: 'success',
            message: `Order resumed — ${result.status}`,
          });
        } else {
          const result = await adminRedemptionFulfilmentOpsApi.retryFulfilment(
            marketId,
            data?.fulfilment?.fulfilment_id ?? '',
          );
          setAction({
            status: 'success',
            message: `Fulfilment retry queued — ${result.status}`,
          });
        }
        setReason('');
        await loadOrder();
      } catch (error: unknown) {
        setAction({ status: 'error', ...describeRedemptionActionError(error) });
      }
    },
    [marketId, orderId, reason, loadOrder, data],
  );

  return (
    <div className="admin-page">
      <PageHeader
        title="Redemption order detail"
        description="Selected-market order record with the linked fulfilment, refund request, shipping-payment recovery and the owner-owned immutable audit trail. Suspend / resume / retry delegate 1:1 to the frozen Phase 6 owner commands."
      />

      {load.status === 'loading' ? <RedemptionOpsSkeleton rows={8} /> : null}
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
                <dt>Order reference</dt>
                <dd data-testid="order-reference">
                  {data.order.order_reference}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd data-testid="order-status">{data.order.status}</dd>
              </div>
              <div>
                <dt>Member</dt>
                <dd>{data.order.public_member_id}</dd>
              </div>
              <div>
                <dt>Item</dt>
                <dd>{data.order.item_name}</dd>
              </div>
              <div>
                <dt>Total points</dt>
                <dd data-testid="order-points">{data.order.total_points}</dd>
              </div>
              <div>
                <dt>Quantity</dt>
                <dd>{data.order.quantity}</dd>
              </div>
              <div>
                <dt>Rate value</dt>
                <dd>{data.order.rate_value}</dd>
              </div>
              <div>
                <dt>Confirmed</dt>
                <dd>{formatRedemptionUtc(data.order.confirmed_at)}</dd>
              </div>
            </dl>
            {data.fulfilment ? (
              <div className="admin-reward-section">
                <h3 className="admin-reward-section">Fulfilment</h3>
                <p data-testid="fulfilment-status">
                  {data.fulfilment.fulfilment_status} (
                  {data.fulfilment.fulfilment_type})
                  {data.fulfilment.failure_reason
                    ? ` — ${data.fulfilment.failure_reason}`
                    : ''}
                </p>
              </div>
            ) : null}
            {data.refund ? (
              <div className="admin-reward-section">
                <h3 className="admin-reward-section">Refund request</h3>
                <p data-testid="refund-status">
                  {data.refund.refund_status} — {data.refund.refund_amount}{' '}
                  (maker: {data.refund.maker_id.slice(0, 8)}…)
                </p>
              </div>
            ) : null}
            {data.shipping_recovery ? (
              <div className="admin-reward-section">
                <h3 className="admin-reward-section">
                  Shipping payment recovery
                </h3>
                <p>
                  {data.shipping_recovery.recovery_status} —{' '}
                  {data.shipping_recovery.amount}{' '}
                  {data.shipping_recovery.currency}
                </p>
              </div>
            ) : null}
          </Card>

          {action.status === 'success' ? (
            <div className="admin-state" role="status">
              <p className="admin-state__title">{action.message}</p>
              <p className="admin-state__body">
                The server confirmed the operation.
              </p>
            </div>
          ) : null}
          {action.status === 'error' ? (
            <div className="admin-state" role="alert">
              <p className="admin-state__title">{action.title}</p>
              <p className="admin-state__body">{action.description}</p>
            </div>
          ) : null}

          <Card>
            <h3 className="admin-reward-section">Fulfilment actions</h3>
            <div className="admin-reward-form">
              <label
                className="admin-reward-muted"
                htmlFor="order-action-reason"
              >
                Reason (required for suspend)
              </label>
              <input
                id="order-action-reason"
                className="admin-input"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Mandatory durable reason"
              />
              <div className="admin-action-row">
                <Button
                  onClick={() => void runAction('suspend')}
                  disabled={
                    action.status === 'working' ||
                    [
                      'FULFILMENT_SUSPENDED',
                      'REFUNDED',
                      'REFUND_PENDING',
                      'FULFILLED',
                    ].includes(data.order.status)
                  }
                  data-testid="order-suspend"
                >
                  Suspend
                </Button>
                <Button
                  onClick={() => void runAction('resume')}
                  disabled={
                    action.status === 'working' ||
                    data.order.status !== 'FULFILMENT_SUSPENDED'
                  }
                  data-testid="order-resume"
                >
                  Resume
                </Button>
                <Button
                  onClick={() => void runAction('retry')}
                  disabled={
                    action.status === 'working' ||
                    data.fulfilment?.fulfilment_status !== 'FAILED'
                  }
                  data-testid="fulfilment-retry"
                >
                  Retry fulfilment
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="admin-reward-section">Audit history</h3>
            {data.audit.length === 0 ? (
              <RedemptionOpsEmptyState description="No audit events recorded for this order." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Reason / summary</th>
                    <th scope="col">Result</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.action}</td>
                      <td>
                        {entry.actor_type}
                        {entry.actor_id
                          ? ` (${entry.actor_id.slice(0, 8)}…)`
                          : ''}
                      </td>
                      <td>{entry.reason ?? '—'}</td>
                      <td>{entry.result}</td>
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

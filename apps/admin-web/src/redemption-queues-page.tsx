import type {
  AdminFulfilmentQueueDto,
  AdminFulfilmentQueueOverviewDto,
  AdminFulfilmentQueueStatus,
} from '@ipoint/api-client';
import { Button, Card, PageHeader, Table } from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminRedemptionFulfilmentOpsApi } from './admin-api.js';
import {
  describeRedemptionReadError,
  formatRedemptionUtc,
  fulfilmentQueueLabel,
  type RedemptionOpsPageErrorCopy,
} from './redemption-fulfilment-ops-model.js';
import {
  FulfilmentQueueBadge,
  RateCapabilityBanner,
  RedemptionOpsEmptyState,
  RedemptionOpsSkeleton,
} from './redemption-fulfilment-ops-states.js';

/**
 * P7-S8 Fulfilment queue page (Command Center 2026-08-07 §6.2).
 *
 * Selected-market six-status queue overview with per-status tabs
 * (READY_FOR_PICKUP / BACKORDERED / FULFILMENT_SUSPENDED /
 * FULFILMENT_EXCEPTION / REFUND_PENDING / REFUNDED) over the frozen Phase
 * 6 owner read projection. The rate-capability banner shows the explicit
 * blocked state for markets without an active redemption rate rule (no
 * fallback). Rows link to the order detail where suspend/resume/retry
 * live.
 */

export const FULFILMENT_QUEUE_TABS: AdminFulfilmentQueueStatus[] = [
  'READY_FOR_PICKUP',
  'BACKORDERED',
  'FULFILMENT_SUSPENDED',
  'FULFILMENT_EXCEPTION',
  'REFUND_PENDING',
  'REFUNDED',
];

type QueueLoad =
  | { status: 'loading' }
  | { status: 'ready'; overview: AdminFulfilmentQueueOverviewDto }
  | ({ status: 'error' } & RedemptionOpsPageErrorCopy);

type QueueItemsLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: AdminFulfilmentQueueDto }
  | ({ status: 'error' } & RedemptionOpsPageErrorCopy);

export function RedemptionQueuesPage({
  initialStatus = 'FULFILMENT_EXCEPTION',
}: {
  initialStatus?: AdminFulfilmentQueueStatus;
}) {
  const { marketId } = useParams<{ marketId: string }>();
  const [overview, setOverview] = useState<QueueLoad>({ status: 'loading' });
  const [status, setStatus] =
    useState<AdminFulfilmentQueueStatus>(initialStatus);
  const [items, setItems] = useState<QueueItemsLoad>({ status: 'idle' });
  const [retryKey, setRetryKey] = useState(0);

  const loadOverview = useCallback(async () => {
    if (!marketId) return;
    setOverview({ status: 'loading' });
    try {
      const data =
        await adminRedemptionFulfilmentOpsApi.queueOverview(marketId);
      setOverview({ status: 'ready', overview: data });
    } catch (error: unknown) {
      setOverview({ status: 'error', ...describeRedemptionReadError(error) });
    }
  }, [marketId]);

  const loadQueue = useCallback(async () => {
    if (!marketId) return;
    setItems({ status: 'loading' });
    try {
      const data = await adminRedemptionFulfilmentOpsApi.queue(
        marketId,
        status,
        {
          limit: 100,
        },
      );
      setItems({ status: 'ready', data });
    } catch (error: unknown) {
      setItems({ status: 'error', ...describeRedemptionReadError(error) });
    }
  }, [marketId, status]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, retryKey]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue, retryKey]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  const rows = items.status === 'ready' ? items.data.items : [];

  return (
    <div className="admin-page">
      <PageHeader
        title="Fulfilment queues"
        description="Selected-market operational status queues over the frozen Phase 6 owner (read projection): ready for pickup, backordered, fulfilment suspended, fulfilment exception, refund pending and refunded. Suspend / resume / retry actions live on the order detail and delegate 1:1 to the owner commands."
      />

      {overview.status === 'ready' ? (
        <RateCapabilityBanner
          rateConfigured={overview.overview.rate_configured}
          marketCode={overview.overview.market_code}
        />
      ) : null}

      {overview.status === 'loading' ? (
        <RedemptionOpsSkeleton rows={3} />
      ) : null}
      {overview.status === 'error' ? (
        <div className="admin-state" role="alert">
          <p className="admin-state__title">{overview.title}</p>
          <p className="admin-state__body">{overview.description}</p>
          <Button onClick={retry}>Try again safely</Button>
        </div>
      ) : null}

      {overview.status === 'ready' ? (
        <nav
          className="admin-queue-tabs"
          aria-label="Fulfilment queue status"
          data-testid="queue-tabs"
        >
          {FULFILMENT_QUEUE_TABS.map((tab) => {
            const count = overview.overview.counts[tab];
            const selected = tab === status;
            return (
              <button
                key={tab}
                type="button"
                className={`admin-queue-tab${selected ? ' admin-queue-tab--selected' : ''}`}
                aria-pressed={selected}
                onClick={() => setStatus(tab)}
                data-testid={`queue-tab-${tab}`}
              >
                {fulfilmentQueueLabel(tab)} ({count})
              </button>
            );
          })}
        </nav>
      ) : null}

      <section aria-label={`${fulfilmentQueueLabel(status)} queue`}>
        <h2 className="admin-reward-section">{fulfilmentQueueLabel(status)}</h2>
        <Card>
          {items.status === 'loading' ? <RedemptionOpsSkeleton /> : null}
          {items.status === 'error' ? (
            <div className="admin-state" role="alert">
              <p className="admin-state__title">{items.title}</p>
              <p className="admin-state__body">{items.description}</p>
              <Button onClick={retry}>Try again safely</Button>
            </div>
          ) : null}
          {items.status === 'ready' && rows.length === 0 ? (
            <RedemptionOpsEmptyState
              title="Queue empty"
              description="No orders are currently in this status for the selected market."
            />
          ) : null}
          {items.status === 'ready' && rows.length > 0 ? (
            <Table>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Member</th>
                  <th scope="col">Item</th>
                  <th scope="col">Points</th>
                  <th scope="col">Fulfilment</th>
                  <th scope="col">Refund</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.order_id}>
                    <td>{row.order_reference}</td>
                    <td>{row.public_member_id}</td>
                    <td>
                      {row.item_name}
                      {row.item_sku ? (
                        <span className="admin-reward-muted">
                          {' '}
                          ({row.item_sku})
                        </span>
                      ) : null}
                    </td>
                    <td data-testid={`queue-points-${row.order_id}`}>
                      {row.total_points}
                    </td>
                    <td>
                      {row.fulfilment
                        ? `${row.fulfilment.fulfilment_status}${row.fulfilment.failure_reason ? ` — ${row.fulfilment.failure_reason}` : ''}`
                        : '—'}
                    </td>
                    <td>
                      {row.refund ? (
                        <RefundStatusInline status={row.refund.refund_status} />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{formatRedemptionUtc(row.updated_at)}</td>
                    <td>
                      <Link
                        to={`/admin/${marketId}/redemptions/orders/${row.order_id}`}
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

function RefundStatusInline({ status }: { status: string }) {
  return <span data-testid={`queue-refund-${status}`}>{status}</span>;
}

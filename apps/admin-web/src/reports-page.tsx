import type {
  AdminReportCatalogDto,
  AdminReportStateDto,
} from '@ipoint/api-client';
import { Card, PageHeader, Table } from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminReportOpsApi } from './admin-api.js';
import {
  describeReportReadError,
  formatReportAmount,
  formatReportAsOf,
  type ReportPageErrorCopy,
} from './reports-model.js';
import {
  ReportErrorState,
  ReportFreshnessBadge,
  ReportFreshnessLine,
  ReportSkeleton,
} from './reports-states.js';

/**
 * P7-S9 Basic Reports page (Command Center 2026-08-07 §7.2) extended with
 * the P8-S4 advanced on-screen views R05–R19 (G-04, D-062): all 19
 * reports (R01–R19) render here.
 *
 * On-screen, market-scoped, bounded operational reports (`report.read`).
 * Every report card discloses its definition, canonical source, freshness
 * class, asOf, freshness state and the explicit stale/unavailable markers.
 * An UNAVAILABLE report shows its reason — never a fabricated zero. There
 * is no CSV/download export anywhere on this page (explicitly prohibited
 * by Command Center §7).
 *
 * Amount rendering rule (P8-S4): advanced-report amounts arrive as
 * exact-decimal strings ('187.0000000000'). They are displayed as-is via
 * formatReportAmount (trailing zeros trimmed only when lossless) —
 * Number()/parseFloat are NEVER used for amount display because they
 * round exact decimals.
 */

type ReportLoad =
  | { status: 'loading' }
  | { status: 'ready'; data: AdminReportCatalogDto }
  | ({ status: 'error' } & ReportPageErrorCopy);

export function ReportsPage() {
  const { marketId } = useParams<{ marketId: string }>();
  const [load, setLoad] = useState<ReportLoad>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);

  const loadReports = useCallback(async () => {
    if (!marketId) return;
    setLoad({ status: 'loading' });
    try {
      const data = await adminReportOpsApi.listReports(marketId);
      setLoad({ status: 'ready', data });
    } catch (error: unknown) {
      setLoad({ status: 'error', ...describeReportReadError(error) });
    }
  }, [marketId]);

  useEffect(() => {
    void loadReports();
  }, [loadReports, retryKey]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  const items = load.status === 'ready' ? load.data.items : [];

  return (
    <div className="admin-page">
      <PageHeader
        title="Basic reports"
        description="Selected-market, on-screen, bounded operational reports aggregated from existing canonical tables. All 19 reports render here — basic (R01–R04) and advanced (R05–R19). Each report shows its definition, source, as-of timestamp and freshness state — an unavailable source is explicitly marked (never a fabricated zero) and stale snapshots are flagged. On-screen bounded only: no CSV or download export exists on this surface."
      />

      {load.status === 'loading' ? <ReportSkeleton /> : null}
      {load.status === 'error' ? (
        <ReportErrorState
          title={load.title}
          description={load.description}
          onRetry={retry}
        />
      ) : null}

      {load.status === 'ready' ? (
        <section aria-label="Report list">
          {items.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
          <p className="admin-reward-muted" data-testid="reports-asof">
            Report catalog as of {formatReportAsOf(load.data.asOf)} · freshness
            SLA: queues ≤ 60s, KPIs ≤ 5m (P7-OD-16)
          </p>
        </section>
      ) : null}
    </div>
  );
}

function ReportCard({ report }: { report: AdminReportStateDto }) {
  return (
    <Card data-testid={`report-${report.id}`}>
      <h2 className="admin-reward-section">
        {report.name} <ReportFreshnessBadge state={report.state} />
      </h2>
      <p className="admin-reward-muted">{report.definition}</p>
      <ReportFreshnessLine report={report} />
      {report.value ? <ReportValueTable report={report} /> : null}
    </Card>
  );
}

/**
 * Read-side cast of `AdminReportStateDto.value` (a `Record<string,
 * unknown>`) mirroring the P8-S4 `ReportValue` union in
 * `apps/api/src/admin-report-ops/admin-report-ops.types.ts`. Every field
 * is optional because the wire value is opaque; each kind branch renders
 * only what the authoritative shape carries. No display here ever invents
 * a row, a count or a zero for an absent source.
 */
type StatusCountsShape = { total?: number; counts?: Record<string, number> };
type VolumeGroupsShape = Record<string, { count: number; totalAmount: string }>;
type PointsGroupsShape = Record<string, { count: number; totalPoints: string }>;
type TransactionValueGroupsShape = Record<
  string,
  {
    count: number;
    totalPurchaseAmount: string;
    totalServiceFeeAmount: string;
  }
>;
type ReportValueShape =
  | {
      kind: 'STATUS_COUNTS';
      windowDays?: number;
      total?: number;
      counts?: Record<string, number>;
    }
  | {
      kind: 'ADJUSTMENT_SUMMARY';
      windowDays?: number;
      mcp?: StatusCountsShape;
      ipoint?: StatusCountsShape;
    }
  | {
      kind: 'QUEUE_OVERVIEW';
      orders?: Record<string, number>;
      fulfilments?: Record<string, number>;
    }
  | {
      kind: 'TREND';
      windowDays?: number;
      days?: Array<{
        date: string;
        registrations: number;
        activations: number;
      }>;
      totals?: { registrations?: number; activations?: number };
    }
  // ─── P8-S4 advanced views (G-04) ──────────────────────────────
  | {
      kind: 'OPERATIONS_OVERVIEW';
      windowDays?: number;
      kyc?: StatusCountsShape;
      merchantApplications?: StatusCountsShape;
    }
  | {
      kind: 'RECONCILIATION_OVERVIEW';
      runs?: StatusCountsShape;
      runItems?: StatusCountsShape;
    }
  | {
      kind: 'MARKET_PROFILE';
      market?: {
        code?: string;
        status?: string;
        currencyCode?: string;
        timezone?: string;
      };
      counts?: {
        members?: number;
        merchantBranches?: number;
        mcpAccounts?: number;
        activeAgents?: number;
        activeCatalogItems?: number;
      };
    }
  | { kind: 'LEDGER_VOLUME'; windowDays?: number; groups?: VolumeGroupsShape }
  | {
      kind: 'TRANSACTION_VALUE';
      windowDays?: number;
      byCurrency?: TransactionValueGroupsShape;
      totals?: {
        count?: number;
        totalPurchaseAmount?: string;
        totalServiceFeeAmount?: string;
      };
    }
  | {
      kind: 'MCP_OVERVIEW';
      accounts?: StatusCountsShape;
      ledger?: { windowDays?: number; groups?: VolumeGroupsShape };
    }
  | {
      kind: 'COMMISSION_OVERVIEW';
      windowDays?: number;
      ledger?: { groups?: VolumeGroupsShape };
      adjustments?: StatusCountsShape;
    }
  | {
      kind: 'REWARD_ACCRUAL';
      windowDays?: number;
      accruals?: { groups?: VolumeGroupsShape };
      plans?: StatusCountsShape;
    }
  | {
      kind: 'REDEMPTION_VOLUME';
      windowDays?: number;
      orders?: PointsGroupsShape;
      items?: StatusCountsShape;
    }
  | {
      kind: 'FULFILMENT_OVERVIEW';
      exceptions?: { total?: number; resolved?: number; unresolved?: number };
      shippingPayments?: StatusCountsShape;
    }
  | {
      kind: 'REFUND_OVERVIEW';
      windowDays?: number;
      mcp?: StatusCountsShape;
      redemption?: StatusCountsShape;
    }
  | {
      kind: 'RISK_EXCEPTION_OVERVIEW';
      riskEvents?: StatusCountsShape;
      riskQueue?: StatusCountsShape;
      reconciliationExceptions?: StatusCountsShape;
    };

function ReportValueTable({ report }: { report: AdminReportStateDto }) {
  const value = report.value as ReportValueShape;

  if (value.kind === 'TREND') {
    const days = value.days ?? [];
    return (
      <>
        <Table aria-label={`${report.name} trend`}>
          <thead>
            <tr>
              <th scope="col">Day (UTC)</th>
              <th scope="col">Registrations</th>
              <th scope="col">Agent activations</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td>{day.registrations}</td>
                <td>{day.activations}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="admin-reward-muted">
          Totals: {value.totals?.registrations ?? 0} registrations ·{' '}
          {value.totals?.activations ?? 0} activations (trailing{' '}
          {value.windowDays ?? 14} days; days without rows are real zeros from
          the authoritative query result)
        </p>
      </>
    );
  }

  if (value.kind === 'ADJUSTMENT_SUMMARY') {
    return (
      <div className="admin-audit-detail">
        <h3>MCP adjustments ({value.windowDays ?? 90} days)</h3>
        <CountsTable
          counts={value.mcp?.counts ?? {}}
          total={value.mcp?.total ?? 0}
        />
        <h3>iPoint adjustments ({value.windowDays ?? 90} days)</h3>
        <CountsTable
          counts={value.ipoint?.counts ?? {}}
          total={value.ipoint?.total ?? 0}
        />
      </div>
    );
  }

  if (value.kind === 'QUEUE_OVERVIEW') {
    return (
      <div className="admin-audit-detail">
        <h3>Orders by status</h3>
        <CountsTable counts={value.orders ?? {}} />
        <h3>Fulfilments by status</h3>
        <CountsTable counts={value.fulfilments ?? {}} />
      </div>
    );
  }

  // ─── P8-S4 advanced views (G-04) ──────────────────────────────

  if (value.kind === 'OPERATIONS_OVERVIEW') {
    return (
      <div className="admin-audit-detail">
        <h3>Member KYC cases ({value.windowDays ?? 90} days)</h3>
        <CountsTable
          counts={value.kyc?.counts ?? {}}
          total={value.kyc?.total}
        />
        <h3>Merchant applications ({value.windowDays ?? 90} days)</h3>
        <CountsTable
          counts={value.merchantApplications?.counts ?? {}}
          total={value.merchantApplications?.total}
        />
      </div>
    );
  }

  if (value.kind === 'RECONCILIATION_OVERVIEW') {
    return (
      <div className="admin-audit-detail">
        <h3>Detection runs</h3>
        <CountsTable
          counts={value.runs?.counts ?? {}}
          total={value.runs?.total}
        />
        <h3>Run items</h3>
        <CountsTable
          counts={value.runItems?.counts ?? {}}
          total={value.runItems?.total}
        />
      </div>
    );
  }

  if (value.kind === 'MARKET_PROFILE') {
    return (
      <MarketProfileTable
        market={value.market ?? {}}
        counts={value.counts ?? {}}
      />
    );
  }

  if (value.kind === 'LEDGER_VOLUME') {
    return (
      <div className="admin-audit-detail">
        <h3>Wallet ledger entries ({value.windowDays ?? 90} days)</h3>
        <VolumeGroupsTable
          groups={value.groups ?? {}}
          windowDays={value.windowDays}
        />
      </div>
    );
  }

  if (value.kind === 'TRANSACTION_VALUE') {
    return (
      <TransactionValueTable
        byCurrency={value.byCurrency ?? {}}
        totals={value.totals}
        windowDays={value.windowDays}
      />
    );
  }

  if (value.kind === 'MCP_OVERVIEW') {
    return (
      <div className="admin-audit-detail">
        <h3>Accounts by status</h3>
        <CountsTable
          counts={value.accounts?.counts ?? {}}
          total={value.accounts?.total}
        />
        <h3>Ledger entries ({value.ledger?.windowDays ?? 90} days)</h3>
        <VolumeGroupsTable
          groups={value.ledger?.groups ?? {}}
          windowDays={value.ledger?.windowDays}
        />
      </div>
    );
  }

  if (value.kind === 'COMMISSION_OVERVIEW') {
    return (
      <div className="admin-audit-detail">
        <h3>Commission ledger ({value.windowDays ?? 90} days)</h3>
        <VolumeGroupsTable
          groups={value.ledger?.groups ?? {}}
          windowDays={value.windowDays}
        />
        <h3>Adjustment requests ({value.windowDays ?? 90} days)</h3>
        <CountsTable
          counts={value.adjustments?.counts ?? {}}
          total={value.adjustments?.total}
        />
      </div>
    );
  }

  if (value.kind === 'REWARD_ACCRUAL') {
    return (
      <div className="admin-audit-detail">
        <h3>Daily accrual entries ({value.windowDays ?? 90} days)</h3>
        <VolumeGroupsTable
          groups={value.accruals?.groups ?? {}}
          windowDays={value.windowDays}
        />
        <h3>Reward plans by status</h3>
        <CountsTable
          counts={value.plans?.counts ?? {}}
          total={value.plans?.total}
        />
      </div>
    );
  }

  if (value.kind === 'REDEMPTION_VOLUME') {
    return (
      <div className="admin-audit-detail">
        <h3>Orders by status ({value.windowDays ?? 90} days)</h3>
        <PointsGroupsTable
          groups={value.orders ?? {}}
          windowDays={value.windowDays}
        />
        <h3>Catalog items by status</h3>
        <CountsTable
          counts={value.items?.counts ?? {}}
          total={value.items?.total}
        />
      </div>
    );
  }

  if (value.kind === 'FULFILMENT_OVERVIEW') {
    return (
      <div className="admin-audit-detail">
        <h3>Fulfilment exceptions</h3>
        <ExceptionsTable exceptions={value.exceptions ?? {}} />
        <h3>Shipping payments by status</h3>
        <CountsTable
          counts={value.shippingPayments?.counts ?? {}}
          total={value.shippingPayments?.total}
        />
      </div>
    );
  }

  if (value.kind === 'REFUND_OVERVIEW') {
    return (
      <div className="admin-audit-detail">
        <h3>MCP refund requests ({value.windowDays ?? 90} days)</h3>
        <CountsTable
          counts={value.mcp?.counts ?? {}}
          total={value.mcp?.total}
        />
        <h3>Redemption refund requests ({value.windowDays ?? 90} days)</h3>
        <CountsTable
          counts={value.redemption?.counts ?? {}}
          total={value.redemption?.total}
        />
      </div>
    );
  }

  if (value.kind === 'RISK_EXCEPTION_OVERVIEW') {
    return (
      <div className="admin-audit-detail">
        <h3>Risk events by severity</h3>
        <CountsTable
          counts={value.riskEvents?.counts ?? {}}
          total={value.riskEvents?.total}
        />
        <h3>Risk review queue by status</h3>
        <CountsTable
          counts={value.riskQueue?.counts ?? {}}
          total={value.riskQueue?.total}
        />
        <h3>Reconciliation exceptions by status</h3>
        <CountsTable
          counts={value.reconciliationExceptions?.counts ?? {}}
          total={value.reconciliationExceptions?.total}
        />
      </div>
    );
  }

  // STATUS_COUNTS (R01, R09, R10, R11) and any future kind fall back to
  // the plain counts table; an absent `counts` map renders the bounded-
  // window empty state (never a fabricated zero).
  return (
    <CountsTable
      counts={value.counts ?? {}}
      total={value.total}
      windowDays={value.windowDays}
    />
  );
}

function CountsTable({
  counts,
  total,
  windowDays,
}: {
  counts: Record<string, number>;
  total?: number;
  windowDays?: number;
}) {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return (
      <p className="admin-reward-muted">
        No rows in the bounded window{windowDays ? ` (${windowDays} days)` : ''}
        .
      </p>
    );
  }
  return (
    <Table aria-label="Counts by status">
      <thead>
        <tr>
          <th scope="col">Status</th>
          <th scope="col">Count</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([status, count]) => (
          <tr key={status}>
            <td>{status}</td>
            <td data-testid={`count-${status}`}>{count}</td>
          </tr>
        ))}
        {typeof total === 'number' ? (
          <tr>
            <td>
              <strong>Total</strong>
            </td>
            <td>
              <strong data-testid="count-total">{total}</strong>
            </td>
          </tr>
        ) : null}
      </tbody>
    </Table>
  );
}

/** Shared bounded-window empty-state copy for group/currency tables. */
function boundedWindowEmptyCopy(windowDays?: number) {
  return `No rows in the bounded window${windowDays ? ` (${windowDays} days)` : ''}.`;
}

/**
 * P8-S4 `LEDGER_VOLUME`-style group table ({count, totalAmount}). Amounts
 * are exact-decimal strings rendered via formatReportAmount — never
 * Number()/parseFloat (they would round exact decimals).
 */
function VolumeGroupsTable({
  groups,
  windowDays,
}: {
  groups: VolumeGroupsShape;
  windowDays?: number;
}) {
  const entries = Object.entries(groups);
  if (entries.length === 0) {
    return (
      <p className="admin-reward-muted">{boundedWindowEmptyCopy(windowDays)}</p>
    );
  }
  return (
    <Table aria-label="Volume by entry type">
      <thead>
        <tr>
          <th scope="col">Entry type</th>
          <th scope="col">Count</th>
          <th scope="col">Total amount</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([entryType, group]) => (
          <tr key={entryType}>
            <td>{entryType}</td>
            <td data-testid={`count-${entryType}`}>{group.count}</td>
            <td data-testid={`amount-${entryType}`}>
              {formatReportAmount(group.totalAmount)}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * P8-S4 `REDEMPTION_VOLUME` orders table ({count, totalPoints}). Points
 * are exact-decimal strings (sum(total_points)::text) rendered losslessly.
 */
function PointsGroupsTable({
  groups,
  windowDays,
}: {
  groups: PointsGroupsShape;
  windowDays?: number;
}) {
  const entries = Object.entries(groups);
  if (entries.length === 0) {
    return (
      <p className="admin-reward-muted">{boundedWindowEmptyCopy(windowDays)}</p>
    );
  }
  return (
    <Table aria-label="Orders by status">
      <thead>
        <tr>
          <th scope="col">Status</th>
          <th scope="col">Count</th>
          <th scope="col">Total points</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([status, group]) => (
          <tr key={status}>
            <td>{status}</td>
            <td data-testid={`count-${status}`}>{group.count}</td>
            <td data-testid={`points-${status}`}>
              {formatReportAmount(group.totalPoints)}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * P8-S4 `TRANSACTION_VALUE` by-currency table + market totals. Purchase
 * and service-fee amounts are exact-decimal strings rendered losslessly.
 */
function TransactionValueTable({
  byCurrency,
  totals,
  windowDays,
}: {
  byCurrency: TransactionValueGroupsShape;
  totals?: {
    count?: number;
    totalPurchaseAmount?: string;
    totalServiceFeeAmount?: string;
  };
  windowDays?: number;
}) {
  const entries = Object.entries(byCurrency);
  if (entries.length === 0) {
    return (
      <p className="admin-reward-muted">{boundedWindowEmptyCopy(windowDays)}</p>
    );
  }
  return (
    <>
      <Table aria-label="Transaction value by currency">
        <thead>
          <tr>
            <th scope="col">Currency</th>
            <th scope="col">Count</th>
            <th scope="col">Total purchase amount</th>
            <th scope="col">Total service-fee amount</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([currency, group]) => (
            <tr key={currency}>
              <td>{currency}</td>
              <td data-testid={`count-${currency}`}>{group.count}</td>
              <td data-testid={`purchase-${currency}`}>
                {formatReportAmount(group.totalPurchaseAmount)}
              </td>
              <td data-testid={`service-fee-${currency}`}>
                {formatReportAmount(group.totalServiceFeeAmount)}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="admin-reward-muted" data-testid="transaction-totals">
        Totals: {totals?.count ?? 0} confirmed transactions ·{' '}
        {formatReportAmount(totals?.totalPurchaseAmount)} total purchase ·{' '}
        {formatReportAmount(totals?.totalServiceFeeAmount)} total service fee
        (trailing {windowDays ?? 90} days)
      </p>
    </>
  );
}

/**
 * P8-S4 `MARKET_PROFILE` identity + real entity counts. Counts are real
 * COUNT results — a 0 in an authoritative row IS a real zero (zero rows
 * exist) and must render as 0.
 */
function MarketProfileTable({
  market,
  counts,
}: {
  market: {
    code?: string;
    status?: string;
    currencyCode?: string;
    timezone?: string;
  };
  counts: {
    members?: number;
    merchantBranches?: number;
    mcpAccounts?: number;
    activeAgents?: number;
    activeCatalogItems?: number;
  };
}) {
  return (
    <Table aria-label="Market profile">
      <tbody>
        <tr>
          <th scope="row">Market code</th>
          <td data-testid="profile-code">{market.code}</td>
        </tr>
        <tr>
          <th scope="row">Market status</th>
          <td data-testid="profile-status">{market.status}</td>
        </tr>
        <tr>
          <th scope="row">Currency</th>
          <td data-testid="profile-currency">{market.currencyCode}</td>
        </tr>
        <tr>
          <th scope="row">Timezone</th>
          <td data-testid="profile-timezone">{market.timezone}</td>
        </tr>
        <tr>
          <th scope="row">Members (enabled presence)</th>
          <td data-testid="profile-members">{counts.members}</td>
        </tr>
        <tr>
          <th scope="row">Merchant branches</th>
          <td data-testid="profile-branches">{counts.merchantBranches}</td>
        </tr>
        <tr>
          <th scope="row">MCP accounts</th>
          <td data-testid="profile-mcp-accounts">{counts.mcpAccounts}</td>
        </tr>
        <tr>
          <th scope="row">Active agents</th>
          <td data-testid="profile-agents">{counts.activeAgents}</td>
        </tr>
        <tr>
          <th scope="row">Active catalog items</th>
          <td data-testid="profile-catalog-items">
            {counts.activeCatalogItems}
          </td>
        </tr>
      </tbody>
    </Table>
  );
}

/**
 * P8-S4 `FULFILMENT_OVERVIEW` exception summary (total / resolved /
 * unresolved). Counts are real count(*) FILTER results — 0 is a real
 * zero, never fabricated.
 */
function ExceptionsTable({
  exceptions,
}: {
  exceptions: { total?: number; resolved?: number; unresolved?: number };
}) {
  return (
    <Table aria-label="Fulfilment exceptions">
      <tbody>
        <tr>
          <th scope="row">Total</th>
          <td data-testid="exceptions-total">{exceptions.total}</td>
        </tr>
        <tr>
          <th scope="row">Resolved</th>
          <td data-testid="exceptions-resolved">{exceptions.resolved}</td>
        </tr>
        <tr>
          <th scope="row">Unresolved</th>
          <td data-testid="exceptions-unresolved">{exceptions.unresolved}</td>
        </tr>
      </tbody>
    </Table>
  );
}

import type { AdminReportCatalogDto, AdminReportStateDto } from '@ipoint/api-client';
import { Card, PageHeader, Table } from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminReportOpsApi } from './admin-api.js';
import {
  describeReportReadError,
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
 * P7-S9 Basic Reports page (Command Center 2026-08-07 §7.2).
 *
 * On-screen, market-scoped, bounded operational reports (`report.read`).
 * Every report card discloses its definition, canonical source, freshness
 * class, asOf, freshness state and the explicit stale/unavailable markers.
 * An UNAVAILABLE report shows its reason — never a fabricated zero. There
 * is no CSV/download export anywhere on this page (explicitly prohibited
 * by Command Center §7).
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
        description="Selected-market, on-screen, bounded operational reports aggregated from existing canonical tables. Each report shows its definition, source, as-of timestamp and freshness state — an unavailable source is explicitly marked (never a fabricated zero) and stale snapshots are flagged. On-screen bounded only: no CSV or download export exists on this surface."
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

function ReportValueTable({ report }: { report: AdminReportStateDto }) {
  const value = report.value as {
    kind?: string;
    total?: number;
    counts?: Record<string, number>;
    windowDays?: number;
    mcp?: { total: number; counts: Record<string, number> };
    ipoint?: { total: number; counts: Record<string, number> };
    orders?: Record<string, number>;
    fulfilments?: Record<string, number>;
    days?: Array<{
      date: string;
      registrations: number;
      activations: number;
    }>;
    totals?: { registrations: number; activations: number };
  };

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
        <CountsTable counts={value.mcp?.counts ?? {}} total={value.mcp?.total ?? 0} />
        <h3>iPoint adjustments ({value.windowDays ?? 90} days)</h3>
        <CountsTable counts={value.ipoint?.counts ?? {}} total={value.ipoint?.total ?? 0} />
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
        No rows in the bounded window{windowDays ? ` (${windowDays} days)` : ''}.
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

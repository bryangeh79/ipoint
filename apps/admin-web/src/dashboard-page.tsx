import {
  ApiError,
  type AdminDashboardCatalogDto,
  type AdminDashboardDrillDownReference,
  type AdminDashboardMetricId,
  type AdminDashboardMetricState,
} from '@ipoint/api-client';
import { PageHeader } from '@ipoint/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import { MetricCard } from './dashboard-cards.js';
import {
  allDashboardMetricIds,
  dashboardSections,
  formatTimestamp,
} from './dashboard-model.js';
import {
  DashboardCardSkeleton,
  DashboardEmptyState,
  DashboardErrorState,
} from './dashboard-states.js';

/**
 * P7-S4B Dashboard page.
 *
 * Read-only selected-market surface on the P7-S4A read models. The market is
 * the server-bound Current Admin Market (never client-supplied); when the
 * session market changes the catalog is fetched again. Loading, empty, error,
 * stale, unavailable, and denied states are explicit; UNAVAILABLE is never
 * rendered as zero.
 */

type CatalogLoad =
  | { status: 'loading' }
  | { status: 'ready'; catalog: AdminDashboardCatalogDto }
  | { status: 'error'; title: string; description: string };

interface DrillDownEntry {
  state: 'loading' | 'ready' | 'failed';
  reference?: AdminDashboardDrillDownReference;
  description?: string;
}

function describeCatalogError(error: unknown): {
  title: string;
  description: string;
} {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'MARKET_SELECTION_REQUIRED':
        return {
          title: 'No Current Admin Market selected',
          description:
            'Select an authorized market from the top bar to load the dashboard.',
        };
      case 'MARKET_CONTEXT_MISMATCH':
        return {
          title: 'Market context mismatch',
          description:
            'The server-bound Current Admin Market changed. Refresh the dashboard.',
        };
      case 'PERMISSION_DENIED':
        return {
          title: 'Permission denied',
          description:
            'Your server permissions do not include dashboard.view for this market.',
        };
      default:
        return {
          title: 'Dashboard unavailable',
          description: `${error.body.message ?? error.message} (${error.body.code ?? 'unknown'})`,
        };
    }
  }
  return {
    title: 'Dashboard unavailable',
    description: error instanceof Error ? error.message : String(error),
  };
}

function isStaleDetailError(error: unknown): boolean {
  return (
    error instanceof ApiError && error.body.code === 'DASHBOARD_DATA_STALE'
  );
}

export function useDashboardCatalog(marketId: string | undefined): {
  load: CatalogLoad;
  retry: () => void;
} {
  const [load, setLoad] = useState<CatalogLoad>({ status: 'loading' });
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    if (!marketId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    adminApi
      .dashboardMetrics()
      .then((catalog) => {
        if (!cancelled) setLoad({ status: 'ready', catalog });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const described = describeCatalogError(error);
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
  }, [marketId, requestKey]);

  const retry = useCallback(() => setRequestKey((key) => key + 1), []);
  return { load, retry };
}

export function useDashboardDrillDowns(
  metricStates: readonly AdminDashboardMetricState[] | undefined,
  marketId: string | undefined,
  requestKey: number,
): {
  entries: Readonly<Record<string, DrillDownEntry>>;
  retryMetric: (metricId: AdminDashboardMetricId) => void;
} {
  const [entries, setEntries] = useState<Record<string, DrillDownEntry>>({});

  useEffect(() => {
    if (!metricStates || !marketId) return;
    const freshIds = metricStates
      .filter((metric) => metric.state === 'FRESH')
      .map((metric) => metric.id);
    const initial: Record<string, DrillDownEntry> = Object.fromEntries(
      freshIds.map((id) => [id, { state: 'loading' }]),
    );
    setEntries(initial);

    let cancelled = false;
    const results = new Map<string, DrillDownEntry>();
    const pending = freshIds.map((metricId) =>
      adminApi
        .dashboardMetricDetail(metricId)
        .then((detail) => {
          results.set(metricId, {
            state: 'ready',
            reference: detail.drillDown,
          });
        })
        .catch((error: unknown) => {
          if (isStaleDetailError(error)) {
            // The detail endpoint re-evaluates freshness at its own instant;
            // a boundary STALE detail means drill-down is not current.
            results.set(metricId, {
              state: 'failed',
              description:
                'The drill-down reference is not current; refresh the metric.',
            });
            return;
          }
          const described = describeCatalogError(error);
          results.set(metricId, {
            state: 'failed',
            description: described.description,
          });
        }),
    );
    void Promise.allSettled(pending).then(() => {
      if (cancelled) return;
      setEntries(Object.fromEntries(results));
    });
    return () => {
      cancelled = true;
    };
  }, [metricStates, marketId, requestKey]);

  const retryMetric = useCallback((metricId: AdminDashboardMetricId) => {
    setEntries((current) => ({
      ...current,
      [metricId]: { state: 'loading' },
    }));
    void adminApi.dashboardMetricDetail(metricId).then(
      (detail) => {
        setEntries((current) => ({
          ...current,
          [metricId]: { state: 'ready', reference: detail.drillDown },
        }));
      },
      (error: unknown) => {
        setEntries((current) => ({
          ...current,
          [metricId]: {
            state: 'failed',
            description: isStaleDetailError(error)
              ? 'The drill-down reference is not current; refresh the metric.'
              : describeCatalogError(error).description,
          },
        }));
      },
    );
  }, []);

  return { entries, retryMetric };
}

export function DashboardPage() {
  const session = useAdminSession();
  const marketId = session.bootstrap?.currentMarket?.id;
  const { load, retry } = useDashboardCatalog(marketId);
  const [drillDownKey, setDrillDownKey] = useState(0);

  const metricStates = useMemo(
    () => (load.status === 'ready' ? load.catalog.items : undefined),
    [load],
  );

  const { entries, retryMetric } = useDashboardDrillDowns(
    metricStates,
    marketId,
    drillDownKey,
  );

  const refreshAll = useCallback(() => {
    setDrillDownKey((key) => key + 1);
    retry();
  }, [retry]);

  const metricById = useMemo(() => {
    const map = new Map<AdminDashboardMetricId, AdminDashboardMetricState>();
    for (const item of metricStates ?? []) map.set(item.id, item);
    return map;
  }, [metricStates]);

  const summary = useMemo(() => {
    if (!metricStates) return null;
    const counts = { fresh: 0, stale: 0, unavailable: 0 };
    for (const item of metricStates)
      counts[item.state.toLowerCase() as 'fresh' | 'stale' | 'unavailable'] +=
        1;
    return counts;
  }, [metricStates]);

  return (
    <section
      aria-labelledby="admin-dashboard-title"
      className="admin-dashboard"
    >
      <PageHeader
        eyebrow="Overview"
        title={<span id="admin-dashboard-title">Dashboard</span>}
        description={`Selected-market operational summary for ${
          session.bootstrap?.currentMarket?.name ?? 'the current market'
        }. All values are server-owned read models; unavailable is never shown as zero.`}
      />

      <p className="admin-dashboard-live" role="status" aria-live="polite">
        {load.status === 'loading'
          ? 'Loading dashboard metrics.'
          : load.status === 'error'
            ? 'Dashboard failed to load.'
            : summary
              ? `Dashboard as of ${formatTimestamp(
                  load.catalog.asOf,
                )}: ${summary.fresh} fresh, ${summary.stale} stale, ${summary.unavailable} unavailable.`
              : ''}
      </p>

      {load.status === 'loading' ? (
        <div className="admin-dashboard-grid" aria-busy="true">
          {allDashboardMetricIds.map((metricId) => (
            <DashboardCardSkeleton key={metricId} label={metricId} />
          ))}
        </div>
      ) : null}

      {load.status === 'error' ? (
        <DashboardErrorState
          title={load.title}
          description={load.description}
          onRetry={retry}
        />
      ) : null}

      {load.status === 'ready' && metricStates?.length === 0 ? (
        <DashboardEmptyState onRetry={retry} />
      ) : null}

      {load.status === 'ready' && metricStates && metricStates.length > 0 ? (
        <>
          {dashboardSections.map((section) => {
            const present = section.metricIds.filter((metricId) =>
              metricById.has(metricId),
            );
            if (present.length === 0) return null;
            return (
              <section
                key={section.id}
                className="admin-dashboard-section"
                aria-labelledby={`admin-dashboard-section-${section.id}`}
              >
                <h2 id={`admin-dashboard-section-${section.id}`}>
                  {section.title}
                </h2>
                <p className="admin-dashboard-section__description">
                  {section.description}
                </p>
                <div className="admin-dashboard-grid">
                  {present.map((metricId) => {
                    const metric = metricById.get(metricId);
                    if (!metric) return null;
                    const entry = entries[metricId];
                    return (
                      <MetricCard
                        key={metricId}
                        metric={metric}
                        drillDown={entry?.reference}
                        detailState={
                          entry?.state === 'failed'
                            ? { failed: true, description: entry.description }
                            : undefined
                        }
                        onRetry={() => {
                          if (metric.state === 'FRESH') {
                            retryMetric(metric.id);
                          } else {
                            refreshAll();
                          }
                        }}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      ) : null}
    </section>
  );
}

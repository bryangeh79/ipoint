import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { RbacService } from '../platform-access/rbac.service.js';
import { DashboardMetricCache } from './admin-dashboard.cache.js';
import { dashboardMetricCatalog } from './admin-dashboard.catalog.js';
import {
  dashboardDataUnavailableError,
  dashboardDataStaleError,
  dashboardMetricUndefinedError,
} from './admin-dashboard.errors.js';
import type {
  DashboardActor,
  DashboardCatalogResponse,
  DashboardJobRunStatus,
  DashboardMetricDefinition,
  DashboardMetricDetail,
  DashboardMetricId,
  DashboardMetricState,
  DashboardMetricValue,
  DashboardUnavailableReason,
} from './admin-dashboard.types.js';
import {
  DASHBOARD_FRESHNESS_BOUND_MS,
  evaluateFreshness,
  isDashboardMetricId,
} from './admin-dashboard.types.js';

interface MarketRow {
  id: string;
  code: string;
  currencyCode: string;
  timezone: string;
}

/** Trailing window used by the M12 reward-job status counts. */
const M12_STATUS_WINDOW_DAYS = 30;

const QUEUE_PENDING_AGENT_STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_CONFIRMED',
  'COURSE_PENDING',
  'COURSE_COMPLETED',
  'PENDING_APPROVAL',
] as const;

@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Optional()
    @Inject(DashboardMetricCache)
    private readonly cache?: DashboardMetricCache,
    @Optional()
    @Inject('DASHBOARD_NOW_PROVIDER')
    private readonly nowProvider?: () => Date,
  ) {}

  now(): Date {
    return this.nowProvider ? this.nowProvider() : new Date();
  }

  /** Catalog list: every definition with per-metric state. Never fails whole-request for a single metric failure. */
  async catalog(
    actor: DashboardActor,
    marketId: string,
  ): Promise<DashboardCatalogResponse> {
    let market: MarketRow | null = null;
    try {
      market = await this.loadMarket(marketId);
    } catch (error) {
      this.logger.warn(
        `dashboard market lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const now = this.now();
    const items: DashboardMetricState[] = [];
    for (const definition of dashboardMetricCatalog) {
      items.push(await this.resolveMetricState(actor, definition, market, now));
    }
    return { asOf: now.toISOString(), marketId, items };
  }

  /** Single metric detail with drill-down reference. Throws registered codes on undefined/stale/unavailable. */
  async metric(
    actor: DashboardActor,
    metricId: string,
    marketId: string,
  ): Promise<DashboardMetricDetail> {
    if (!isDashboardMetricId(metricId)) {
      throw dashboardMetricUndefinedError(metricId);
    }
    const definition = dashboardMetricCatalog.find(
      (entry) => entry.id === metricId,
    );
    if (!definition) throw dashboardMetricUndefinedError(metricId);

    let market: MarketRow | null = null;
    try {
      market = await this.loadMarket(marketId);
    } catch (error) {
      this.logger.warn(
        `dashboard market lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const now = this.now();
    const state = await this.resolveMetricState(actor, definition, market, now);

    if (state.state === 'UNAVAILABLE') {
      throw dashboardDataUnavailableError(
        metricId,
        state.unavailableReason ?? 'SOURCE_QUERY_FAILED',
      );
    }
    if (state.state === 'STALE') {
      throw dashboardDataStaleError(metricId, state.asOf);
    }

    const drillDown = this.drillDown(definition, marketId, now, market);
    return {
      id: definition.id,
      name: definition.name,
      definition: definition.definition,
      definitionVersion: definition.definitionVersion,
      freshnessClass: definition.freshnessClass,
      currencyDimension: definition.currencyDimension,
      permission: definition.permission,
      source: definition.source,
      state: state.state,
      asOf: state.asOf,
      marketId,
      value: state.value,
      drillDown,
    };
  }

  // ─── Metric resolution ─────────────────────────────────────────────

  private async resolveMetricState(
    actor: DashboardActor,
    definition: DashboardMetricDefinition,
    market: MarketRow | null,
    now: Date,
  ): Promise<DashboardMetricState> {
    const base = {
      id: definition.id,
      name: definition.name,
      definition: definition.definition,
      definitionVersion: definition.definitionVersion,
      freshnessClass: definition.freshnessClass,
      currencyDimension: definition.currencyDimension,
      permission: definition.permission,
      source: definition.source,
    };

    if (definition.availability === 'NO_DURABLE_SOURCE') {
      return {
        ...base,
        state: 'UNAVAILABLE',
        unavailableReason: definition.unavailableReason ?? 'NO_DURABLE_SOURCE',
        asOf: now.toISOString(),
      };
    }

    if (definition.sourcePermission) {
      const allowed = await this.rbac.isAllowed({
        adminUserId: actor.adminUserId,
        permission: definition.sourcePermission,
        marketId: market?.id,
      });
      if (!allowed) {
        return {
          ...base,
          state: 'UNAVAILABLE',
          unavailableReason: 'SOURCE_PERMISSION_DENIED',
          asOf: now.toISOString(),
        };
      }
    }

    const cached = this.cache?.get(
      definition.id,
      market?.id ?? 'NO_MARKET',
      definition.freshnessClass,
    );
    if (cached) {
      return {
        ...base,
        state: evaluateFreshness(
          new Date(cached.asOf),
          now,
          definition.freshnessClass,
        ),
        asOf: cached.asOf,
        value: cached.value as DashboardMetricValue,
      };
    }

    try {
      if (!market) {
        throw new Error('Selected market could not be resolved.');
      }
      const value = await this.computeMetricValue(definition.id, market, now);
      const asOf = now.toISOString();
      this.cache?.set(definition.id, market.id, {
        value,
        asOf,
        computedAt: now.getTime(),
      });
      return { ...base, state: 'FRESH', asOf, value };
    } catch (error) {
      const reason: DashboardUnavailableReason = 'SOURCE_QUERY_FAILED';
      this.logger.warn(
        `dashboard metric ${definition.id} source query failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        ...base,
        state: 'UNAVAILABLE',
        unavailableReason: reason,
        asOf: now.toISOString(),
      };
    }
  }

  private async computeMetricValue(
    metricId: DashboardMetricId,
    market: MarketRow,
    now: Date,
  ): Promise<DashboardMetricValue> {
    switch (metricId) {
      case 'M01':
        return { kind: 'COUNT', count: await this.countMembers(market.id) };
      case 'M02':
        return {
          kind: 'COUNT',
          count: await this.countMembers(market.id, ['ACTIVE']),
        };
      case 'M03':
        return {
          kind: 'COUNT',
          count: await this.countMembers(market.id, ['SUSPENDED', 'CLOSED']),
        };
      case 'M04':
        return this.merchantTotals(market.id);
      case 'M05':
        return {
          kind: 'COUNT',
          count: await this.scalarCount(
            `SELECT count(DISTINCT a.id)::int AS count
             FROM merchant_applications a
             JOIN merchant_branches b ON b.id = a.merchant_branch_id
             WHERE b.market_id = $1
               AND a.status IN ('SUBMITTED', 'UNDER_REVIEW')`,
            [market.id],
          ),
        };
      case 'M06':
        return {
          kind: 'COUNT',
          count: await this.scalarCount(
            `SELECT count(DISTINCT k.merchant_branch_id)::int AS count
             FROM merchant_kyc_submissions k
             JOIN merchant_branches b ON b.id = k.merchant_branch_id
             WHERE b.market_id = $1
               AND k.status IN ('SUBMITTED', 'UNDER_REVIEW')`,
            [market.id],
          ),
        };
      case 'M07':
        return {
          kind: 'COUNT',
          count: await this.scalarCount(
            `SELECT count(*)::int AS count
             FROM member_kyc_cases
             WHERE market_id = $1
               AND status IN ('SUBMITTED', 'UNDER_REVIEW')`,
            [market.id],
          ),
        };
      case 'M08':
        return this.agentTotals(market.code);
      case 'M09':
        return {
          kind: 'COUNT',
          count: await this.scalarCount(
            `SELECT count(*)::int AS count
             FROM mcp_adjustment_requests
             WHERE market_id = $1 AND status = 'PENDING_APPROVAL'`,
            [market.id],
          ),
        };
      case 'M10':
        // No durable source (SEC-01): never reached for REAL metrics.
        return { kind: 'COUNT', count: 0 };
      case 'M11':
        return this.redemptionPending(market.id);
      case 'M12':
        return this.rewardJobStatus(market.id, market.timezone, now);
      case 'M13':
        return this.todayTransactions(market.id, market.timezone, now);
      case 'M14':
        return this.mcpAvailableBalance(market.id, market.currencyCode);
    }
  }

  // ─── Bounded source queries (read-only; never reimplement owner truth) ─

  private async loadMarket(marketId: string): Promise<MarketRow | null> {
    const result = await this.database.pool.query<{
      id: string;
      code: string;
      currency_code: string;
      timezone: string;
    }>(
      `SELECT id, code, currency_code, timezone FROM markets WHERE id = $1 AND archived_at IS NULL`,
      [marketId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      currencyCode: row.currency_code,
      timezone: row.timezone,
    };
  }

  private async countMembers(
    marketId: string,
    statuses?: readonly string[],
  ): Promise<number> {
    const statusFilter =
      statuses && statuses.length > 0
        ? `AND m.status::text = ANY($2::text[])`
        : '';
    const params: unknown[] = [marketId];
    if (statuses && statuses.length > 0) params.push([...statuses]);
    return this.scalarCount(
      `SELECT count(*)::int AS count
       FROM member_market_preferences p
       JOIN members m ON m.id = p.member_id
       WHERE p.market_id = $1 AND p.is_enabled = true ${statusFilter}`,
      params,
    );
  }

  private async merchantTotals(
    marketId: string,
  ): Promise<DashboardMetricValue> {
    const result = await this.database.pool.query<{
      status: string;
      count: string;
    }>(
      `SELECT status, count(*)::int AS count
       FROM merchant_branches
       WHERE market_id = $1
       GROUP BY status`,
      [marketId],
    );
    const total = result.rows.reduce((sum, row) => sum + Number(row.count), 0);
    const active =
      result.rows.find((row) => row.status === 'ACTIVE')?.count ?? '0';
    return { kind: 'BREAKDOWN', breakdown: { total, active: Number(active) } };
  }

  private async agentTotals(marketCode: string): Promise<DashboardMetricValue> {
    const pending = QUEUE_PENDING_AGENT_STATUSES.map((s) => `'${s}'`).join(
      ', ',
    );
    const result = await this.database.pool.query<{
      total: string;
      pending: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE status <> 'NOT_APPLIED')::int AS total,
         count(*) FILTER (WHERE status IN (${pending}))::int AS pending
       FROM agent_activation
       WHERE market = $1`,
      [marketCode],
    );
    const row = result.rows[0];
    return {
      kind: 'BREAKDOWN',
      breakdown: {
        total: Number(row?.total ?? 0),
        pendingActivation: Number(row?.pending ?? 0),
      },
    };
  }

  private async redemptionPending(
    marketId: string,
  ): Promise<DashboardMetricValue> {
    const exceptions = await this.scalarCount(
      `SELECT count(DISTINCT e.id)::int AS count
       FROM redemption_fulfilment_exceptions e
       JOIN redemption_orders o ON o.id = e.order_id
       WHERE o.market_id = $1 AND e.resolved = false`,
      [marketId],
    );
    const refunds = await this.scalarCount(
      `SELECT count(DISTINCT r.id)::int AS count
       FROM redemption_refund_requests r
       JOIN redemption_orders o ON o.id = r.order_id
       WHERE o.market_id = $1 AND r.status = 'PENDING_CHECKER'`,
      [marketId],
    );
    return {
      kind: 'QUEUE_SUMMARY',
      counts: { fulfilmentExceptions: exceptions, refundRequests: refunds },
    };
  }

  private async rewardJobStatus(
    marketId: string,
    timezone: string,
    now: Date,
  ): Promise<DashboardMetricValue> {
    const windowStart = marketLocalDayStart(
      new Date(now.getTime() - M12_STATUS_WINDOW_DAYS * 86_400_000),
      timezone,
    );
    const latest = await this.database.pool.query<{
      job_type: string;
      local_business_date: string;
      status: string;
      started_at: Date | null;
      completed_at: Date | null;
      total_entitlements: string;
      processed_count: string;
      failed_count: string;
    }>(
      `SELECT job_type, local_business_date, status, started_at, completed_at,
              total_entitlements, processed_count, failed_count
       FROM daily_job_runs
       WHERE market_id = $1
       ORDER BY local_business_date DESC, created_at DESC
       LIMIT 1`,
      [marketId],
    );
    const counts = await this.database.pool.query<{
      status: string;
      count: string;
    }>(
      `SELECT status, count(*)::int AS count
       FROM daily_job_runs
       WHERE market_id = $1 AND local_business_date >= $2::date
       GROUP BY status`,
      [marketId, windowStart.toISOString().slice(0, 10)],
    );
    const statusCounts: Record<string, number> = {};
    for (const row of counts.rows) statusCounts[row.status] = Number(row.count);

    const run = latest.rows[0];
    return {
      kind: 'JOB_STATUS',
      latestRun: run
        ? {
            jobType: run.job_type,
            localBusinessDate: run.local_business_date,
            status: run.status as DashboardJobRunStatus,
            startedAt: run.started_at?.toISOString() ?? null,
            completedAt: run.completed_at?.toISOString() ?? null,
            totalEntitlements: Number(run.total_entitlements),
            processedCount: Number(run.processed_count),
            failedCount: Number(run.failed_count),
          }
        : null,
      statusCounts,
    };
  }

  private async todayTransactions(
    marketId: string,
    timezone: string,
    now: Date,
  ): Promise<DashboardMetricValue> {
    const dayStart = marketLocalDayStart(now, timezone);
    const result = await this.database.pool.query<{
      currency: string;
      count: string;
      total_amount: string;
    }>(
      `SELECT currency, count(*)::int AS count,
              sum(purchase_amount)::text AS total_amount
       FROM transactions
       WHERE market_id = $1
         AND status = 'CONFIRMED'
         AND confirmed_at >= $2
       GROUP BY currency
       ORDER BY currency`,
      [marketId, dayStart],
    );
    return {
      kind: 'CURRENCY_TOTALS',
      totals: result.rows.map((row) => ({
        currency: row.currency,
        count: Number(row.count),
        totalAmount: row.total_amount ?? '0',
      })),
    };
  }

  private async mcpAvailableBalance(
    marketId: string,
    currencyCode: string,
  ): Promise<DashboardMetricValue> {
    const result = await this.database.pool.query<{ total: string | null }>(
      `SELECT sum(available_balance)::text AS total
       FROM mcp_accounts
       WHERE market_id = $1`,
      [marketId],
    );
    return {
      kind: 'BALANCE',
      currency: currencyCode,
      totalAvailableBalance: result.rows[0]?.total ?? '0',
    };
  }

  private async scalarCount(sql: string, params: unknown[]): Promise<number> {
    const result = await this.database.pool.query<{ count: string }>(
      sql,
      params,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  // ─── Drill-down reference ───────────────────────────────────────────

  private drillDown(
    definition: DashboardMetricDefinition,
    marketId: string,
    now: Date,
    market: MarketRow | null,
  ): DashboardMetricDetail['drillDown'] {
    let timeBoundary: DashboardMetricDetail['drillDown']['timeBoundary'] = null;
    if (definition.id === 'M13' && market) {
      timeBoundary = {
        from: marketLocalDayStart(now, market.timezone).toISOString(),
        to: now.toISOString(),
      };
    } else if (definition.id === 'M12' && market) {
      timeBoundary = {
        from: marketLocalDayStart(
          new Date(now.getTime() - M12_STATUS_WINDOW_DAYS * 86_400_000),
          market.timezone,
        ).toISOString(),
        to: now.toISOString(),
      };
    }
    return {
      metricId: definition.id,
      marketId,
      marketScope: 'SELECTED',
      permission: definition.permission,
      masking: definition.sensitive,
      metricFilter: null,
      timeBoundary,
    };
  }
}

/**
 * UTC instant of market-local midnight for `at` in the given IANA timezone.
 * Deterministic projection helper using Intl; a bounded correction loop
 * resolves DST offset changes. Used only to bound the M13/M12 read windows
 * server-side.
 */
export function marketLocalDayStart(at: Date, timezone: string): Date {
  const parts = localParts(at, timezone);
  const localMidnightAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  let guess = localMidnightAsUtc;
  for (let i = 0; i < 4; i += 1) {
    const offset = tzOffsetMs(guess, timezone);
    const candidate = localMidnightAsUtc - offset;
    if (candidate === guess) return new Date(guess);
    guess = candidate;
  }
  return new Date(guess);
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
}

function localParts(at: Date, timezone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = new Map(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(map.get('year')),
    month: Number(map.get('month')),
    day: Number(map.get('day')),
  };
}

/** Milliseconds the wall clock at `at` is ahead of UTC in `timezone`. */
function tzOffsetMs(at: number, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = new Map(
    formatter
      .formatToParts(new Date(at))
      .map((part) => [part.type, part.value]),
  );
  const wallAsUtc = Date.UTC(
    Number(map.get('year')),
    Number(map.get('month')) - 1,
    Number(map.get('day')),
    Number(map.get('hour')),
    Number(map.get('minute')),
    Number(map.get('second')),
  );
  return wallAsUtc - at;
}

// Re-export for tests that need the freshness bounds directly.
export { DASHBOARD_FRESHNESS_BOUND_MS };

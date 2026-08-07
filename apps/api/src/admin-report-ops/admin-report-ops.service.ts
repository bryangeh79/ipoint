import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import { reportDefinition, reportCatalog } from './admin-report-ops.catalog.js';
import { ReportSnapshotCache } from './admin-report-ops.cache.js';
import {
  reportDataStaleError,
  reportDataUnavailableError,
  reportMarketNotFoundError,
  reportUndefinedError,
} from './admin-report-ops.errors.js';
import type {
  ReportCatalogResponse,
  ReportDefinition,
  ReportDetailResponse,
  ReportFreshnessState,
  ReportId,
  ReportState,
  ReportValue,
} from './admin-report-ops.types.js';
import {
  buildDaySeries,
  evaluateReportFreshness,
  isReportId,
} from './admin-report-ops.types.js';

/** Empty public interface used to anchor the report actor contract. */
export interface ReportActor {
  adminUserId: string;
  requestId?: string;
}

interface MarketRow {
  id: string;
  code: string;
}

interface CountRow {
  [column: string]: unknown;
}

/**
 * P7-S9 Basic Reports service.
 *
 * Market-scoped, on-screen, bounded operational reports (Command Center
 * 2026-08-07 §7.2). Every report aggregates EXISTING canonical owner
 * tables with a bounded trailing window — no new business rules, no
 * unbounded scans, no export surface. Freshness is honest: `asOf` is the
 * source-query time, snapshots within the class SLA are served FRESH from
 * the short-lived cache, a failed re-query serves the previous snapshot
 * only explicitly marked STALE, and a missing/failed source with no
 * snapshot is UNAVAILABLE — a zero is NEVER fabricated in place of an
 * unavailable source. Query durations are measured and returned
 * (`queryDurationMs`) to evidence the frozen performance targets
 * (QUEUE ≤ 60s, KPI ≤ 5m).
 */
@Injectable()
export class AdminReportOpsService {
  private readonly logger = new Logger(AdminReportOpsService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ReportSnapshotCache) private readonly cache: ReportSnapshotCache,
    @Optional()
    @Inject('REPORT_NOW_PROVIDER')
    private readonly nowProvider?: () => Date,
  ) {}

  now(): Date {
    return this.nowProvider ? this.nowProvider() : new Date();
  }

  /** Report catalog: every definition with per-report state. A single report failure never fails the whole catalog. */
  async catalog(
    _actor: ReportActor,
    marketId: string,
  ): Promise<ReportCatalogResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw reportMarketNotFoundError();
    const now = this.now();
    const items: ReportState[] = [];
    for (const definition of reportCatalog) {
      items.push(await this.resolveState(definition, market, now));
    }
    return { asOf: now.toISOString(), marketId, items };
  }

  /** Single report detail. Throws registered codes on undefined/stale/unavailable. */
  async report(
    _actor: ReportActor,
    reportId: string,
    marketId: string,
  ): Promise<ReportDetailResponse> {
    if (!isReportId(reportId)) throw reportUndefinedError(reportId);
    const definition = reportDefinition(reportId);
    if (!definition) throw reportUndefinedError(reportId);
    const market = await this.marketRow(marketId);
    if (!market) throw reportMarketNotFoundError();
    const now = this.now();
    const state = await this.resolveState(definition, market, now);
    if (state.state === 'UNAVAILABLE') {
      throw reportDataUnavailableError(
        reportId,
        state.unavailableReason ?? 'SOURCE_QUERY_FAILED',
      );
    }
    if (state.state === 'STALE') {
      throw reportDataStaleError(reportId, state.asOf);
    }
    return { ...state, marketId };
  }

  // ─── Report resolution ─────────────────────────────────────────────

  private async resolveState(
    definition: ReportDefinition,
    market: MarketRow,
    now: Date,
  ): Promise<ReportState> {
    const base = {
      id: definition.id,
      key: definition.key,
      name: definition.name,
      definition: definition.definition,
      definitionVersion: definition.definitionVersion,
      freshnessClass: definition.freshnessClass,
      permission: definition.permission,
      source: definition.source,
    };

    if (definition.availability === 'NO_DURABLE_SOURCE') {
      return {
        ...base,
        state: 'UNAVAILABLE' as const,
        unavailableReason: 'NO_DURABLE_SOURCE' as const,
        stale: false,
        unavailable: true,
        asOf: now.toISOString(),
      };
    }

    const cached = this.cache.get(
      definition.id,
      market.id,
      definition.freshnessClass,
    );
    if (cached) {
      const freshness = evaluateReportFreshness(
        new Date(cached.asOf),
        now,
        definition.freshnessClass,
      );
      return {
        ...base,
        state: freshness,
        stale: freshness === 'STALE',
        unavailable: false,
        asOf: cached.asOf,
        value: cached.value,
      };
    }

    const startedAt = performance.now();
    try {
      const value = await this.queryValue(definition, market);
      const asOf = this.now().toISOString();
      this.cache.set(definition.id, market.id, {
        value,
        asOf,
        computedAt: Date.now(),
      });
      return {
        ...base,
        state: 'FRESH' as const,
        stale: false,
        unavailable: false,
        asOf,
        queryDurationMs: roundMs(performance.now() - startedAt),
        value,
      };
    } catch (error) {
      this.logger.warn(
        `report ${definition.id} source query failed for market ${market.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      const previous = this.cache.peek(definition.id, market.id);
      if (previous) {
        return {
          ...base,
          state: 'STALE' as const,
          stale: true,
          unavailable: false,
          asOf: previous.asOf,
          queryDurationMs: roundMs(performance.now() - startedAt),
          value: previous.value,
        };
      }
      return {
        ...base,
        state: 'UNAVAILABLE' as const,
        unavailableReason: 'SOURCE_QUERY_FAILED' as const,
        stale: false,
        unavailable: true,
        asOf: this.now().toISOString(),
        queryDurationMs: roundMs(performance.now() - startedAt),
      };
    }
  }

  // ─── Bounded source queries ────────────────────────────────────────

  private async queryValue(
    definition: ReportDefinition,
    market: MarketRow,
  ): Promise<ReportValue> {
    switch (definition.id) {
      case 'R01':
        return this.transactionCounts(market.id, definition.windowDays);
      case 'R02':
        return this.adjustmentSummary(market.id, definition.windowDays);
      case 'R03':
        return this.redemptionQueueOverview(market.id);
      case 'R04':
        return this.registrationActivationTrend(market, definition.windowDays);
    }
  }

  private async transactionCounts(
    marketId: string,
    windowDays: number,
  ): Promise<ReportValue> {
    const rows = await this.queryRows(
      `SELECT status::text AS key, count(*)::int AS count
         FROM transactions
        WHERE market_id = $1 AND created_at >= now() - make_interval(days => $2)
        GROUP BY status`,
      [marketId, windowDays],
    );
    return {
      kind: 'STATUS_COUNTS',
      windowDays,
      ...this.toCounts(rows),
    };
  }

  private async adjustmentSummary(
    marketId: string,
    windowDays: number,
  ): Promise<ReportValue> {
    const [mcpRows, ipointRows] = await Promise.all([
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count
           FROM mcp_adjustment_requests
          WHERE market_id = $1 AND created_at >= now() - make_interval(days => $2)
          GROUP BY status`,
        [marketId, windowDays],
      ),
      this.queryRows(
        `SELECT state::text AS key, count(*)::int AS count
           FROM ipoint_adjustment_requests
          WHERE market_id = $1 AND created_at >= now() - make_interval(days => $2)
          GROUP BY state`,
        [marketId, windowDays],
      ),
    ]);
    return {
      kind: 'ADJUSTMENT_SUMMARY',
      windowDays,
      mcp: this.toCounts(mcpRows),
      ipoint: this.toCounts(ipointRows),
    };
  }

  private async redemptionQueueOverview(
    marketId: string,
  ): Promise<ReportValue> {
    const [orderRows, fulfilmentRows] = await Promise.all([
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count
           FROM redemption_orders
          WHERE market_id = $1
          GROUP BY status`,
        [marketId],
      ),
      this.queryRows(
        `SELECT f.status::text AS key, count(*)::int AS count
           FROM redemption_fulfilments f
           JOIN redemption_orders o ON o.id = f.order_id
          WHERE o.market_id = $1
          GROUP BY f.status`,
        [marketId],
      ),
    ]);
    return {
      kind: 'QUEUE_OVERVIEW',
      orders: toRecord(orderRows),
      fulfilments: toRecord(fulfilmentRows),
    };
  }

  private async registrationActivationTrend(
    market: MarketRow,
    windowDays: number,
  ): Promise<ReportValue> {
    const [registrationRows, activationRows] = await Promise.all([
      this.queryRows(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                count(*)::int AS count
           FROM member_market_preferences
          WHERE market_id = $1
            AND created_at >= now() - make_interval(days => $2)
          GROUP BY 1`,
        [market.id, windowDays],
      ),
      this.queryRows(
        `SELECT to_char(date_trunc('day', activated_at), 'YYYY-MM-DD') AS day,
                count(*)::int AS count
           FROM agent_activation
          WHERE market = $1
            AND activated_at >= now() - make_interval(days => $2)
          GROUP BY 1`,
        [market.code, windowDays],
      ),
    ]);
    const today = new Date(this.now().toISOString().slice(0, 10));
    const registrations = buildDaySeries(
      windowDays,
      today,
      registrationRows.map((row) => ({
        day: String(row['day']),
        count: Number(row['count']),
      })),
    );
    const activations = buildDaySeries(
      windowDays,
      today,
      activationRows.map((row) => ({
        day: String(row['day']),
        count: Number(row['count']),
      })),
    );
    const days = registrations.map((entry, index) => ({
      date: entry.date,
      registrations: entry.count,
      activations: activations[index]?.count ?? 0,
    }));
    return {
      kind: 'TREND',
      windowDays,
      days,
      totals: {
        registrations: days.reduce(
          (sum, entry) => sum + entry.registrations,
          0,
        ),
        activations: days.reduce(
          (sum, entry) => sum + entry.activations,
          0,
        ),
      },
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private pool(): Pool {
    return this.database.pool;
  }

  private async marketRow(marketId: string): Promise<MarketRow | null> {
    const result = await this.pool().query<{ id: string; code: string }>(
      'SELECT id, code FROM markets WHERE id = $1 LIMIT 1',
      [marketId],
    );
    return result.rows[0] ?? null;
  }

  private async queryRows(
    sqlText: string,
    params: unknown[],
  ): Promise<CountRow[]> {
    const result = await this.pool().query<CountRow>(sqlText, params);
    return result.rows;
  }

  private toCounts(rows: CountRow[]): {
    total: number;
    counts: Record<string, number>;
  } {
    const counts = toRecord(rows);
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { total, counts };
  }
}

function toRecord(rows: CountRow[]): Record<string, number> {
  const record: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row['key']);
    record[key] = Number(row['count']);
  }
  return record;
}

function roundMs(milliseconds: number): number {
  return Math.round(milliseconds * 10) / 10;
}

export type { ReportId };

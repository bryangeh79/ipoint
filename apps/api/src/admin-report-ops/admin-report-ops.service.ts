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
  status: string;
  currencyCode: string;
  timezone: string;
}

interface CountRow {
  [column: string]: unknown;
}

/**
 * P7-S9 Basic Reports service, extended with P8-S4 advanced views
 * (R05–R19, G-04).
 *
 * Market-scoped, on-screen, bounded operational reports (Command Center
 * 2026-08-07 §7.2 + P8-S0 contract §4). Every report aggregates EXISTING
 * canonical owner tables with a bounded trailing window — no new business
 * rules, no unbounded scans, no export surface. Freshness is honest: `asOf`
 * is the source-query time, snapshots within the class SLA are served FRESH
 * from the short-lived cache, a failed re-query serves the previous snapshot
 * only explicitly marked STALE, and a missing/failed source with no
 * snapshot is UNAVAILABLE — a zero is NEVER fabricated in place of an
 * unavailable source. Query durations are measured and returned
 * (`queryDurationMs`) to evidence the frozen performance targets
 * (QUEUE ≤ 60s, KPI ≤ 5m).
 *
 * Values are aggregate-only masked projections (P7-S9 privacy masking):
 * counts and exact-decimal amount strings; raw identifiers, protected
 * member references, receipts, order/case references and voucher/token
 * values never appear (asserted via `containsRawIdentifier`). Amounts are
 * produced by PostgreSQL numeric(38,10) sums transported as strings — no
 * float arithmetic anywhere (E-04).
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
      case 'R05':
        return this.operationsOverview(market.id, definition.windowDays);
      case 'R06':
        return this.walletVolume(market.id, definition.windowDays);
      case 'R07':
        return this.reconciliationOverview(market.id);
      case 'R08':
        return this.marketProfile(market);
      case 'R09':
        return this.memberStatusDistribution(market.id);
      case 'R10':
        return this.merchantStatusDistribution(market.id);
      case 'R11':
        return this.agentStatusDistribution(market.code);
      case 'R12':
        return this.transactionValue(market.id, definition.windowDays);
      case 'R13':
        return this.mcpOverview(market.id, definition.windowDays);
      case 'R14':
        return this.rewardAccrual(market.id, definition.windowDays);
      case 'R15':
        return this.commissionOverview(market.code, definition.windowDays);
      case 'R16':
        return this.redemptionVolume(market.id, definition.windowDays);
      case 'R17':
        return this.fulfilmentExceptionOverview(market.id);
      case 'R18':
        return this.refundOverview(market.id, definition.windowDays);
      case 'R19':
        return this.riskExceptionOverview(market.id);
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
        activations: days.reduce((sum, entry) => sum + entry.activations, 0),
      },
    };
  }

  // ─── P8-S4 advanced report queries (G-04) ─────────────────────────

  private async operationsOverview(
    marketId: string,
    windowDays: number,
  ): Promise<ReportValue> {
    const [kycRows, applicationRows] = await Promise.all([
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count
           FROM member_kyc_cases
          WHERE market_id = $1
            AND created_at >= now() - make_interval(days => $2)
          GROUP BY status`,
        [marketId, windowDays],
      ),
      this.queryRows(
        `SELECT a.status::text AS key, count(*)::int AS count
           FROM merchant_applications a
           JOIN merchant_branches b ON b.id = a.merchant_branch_id
          WHERE b.market_id = $1
            AND a.created_at >= now() - make_interval(days => $2)
          GROUP BY a.status`,
        [marketId, windowDays],
      ),
    ]);
    return {
      kind: 'OPERATIONS_OVERVIEW',
      windowDays,
      kyc: this.toCounts(kycRows),
      merchantApplications: this.toCounts(applicationRows),
    };
  }

  private async walletVolume(
    marketId: string,
    windowDays: number,
  ): Promise<ReportValue> {
    const rows = await this.queryRows(
      `SELECT entry_type::text AS key, count(*)::int AS count,
              coalesce(sum(amount), 0)::text AS total_amount
         FROM member_wallet_entries
        WHERE market_id = $1
          AND created_at >= now() - make_interval(days => $2)
        GROUP BY entry_type`,
      [marketId, windowDays],
    );
    return {
      kind: 'LEDGER_VOLUME',
      windowDays,
      groups: toVolumeGroups(rows),
    };
  }

  private async reconciliationOverview(marketId: string): Promise<ReportValue> {
    const [runRows, itemRows] = await Promise.all([
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count
           FROM reconciliation_runs
          WHERE market_id = $1
          GROUP BY status`,
        [marketId],
      ),
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count
           FROM reconciliation_run_items
          WHERE market_id = $1
          GROUP BY status`,
        [marketId],
      ),
    ]);
    return {
      kind: 'RECONCILIATION_OVERVIEW',
      runs: this.toCounts(runRows),
      runItems: this.toCounts(itemRows),
    };
  }

  private async marketProfile(market: MarketRow): Promise<ReportValue> {
    const [members, merchantBranches, mcpAccounts, activeAgents, items] =
      await Promise.all([
        this.queryRows(
          `SELECT count(*)::int AS count
             FROM members m
             JOIN member_market_preferences p ON p.member_id = m.id
            WHERE p.market_id = $1 AND p.is_enabled = true`,
          [market.id],
        ),
        this.queryRows(
          `SELECT count(*)::int AS count
             FROM merchant_branches
            WHERE market_id = $1`,
          [market.id],
        ),
        this.queryRows(
          `SELECT count(*)::int AS count
             FROM mcp_accounts
            WHERE market_id = $1`,
          [market.id],
        ),
        this.queryRows(
          `SELECT count(*)::int AS count
             FROM agent_activation
            WHERE market = $1 AND status = 'ACTIVE'`,
          [market.code],
        ),
        this.queryRows(
          `SELECT count(*)::int AS count
             FROM redemption_catalog_items
            WHERE market_id = $1 AND status = 'ACTIVE'`,
          [market.id],
        ),
      ]);
    return {
      kind: 'MARKET_PROFILE',
      market: {
        code: market.code,
        status: market.status,
        currencyCode: market.currencyCode,
        timezone: market.timezone,
      },
      counts: {
        members: singleCount(members),
        merchantBranches: singleCount(merchantBranches),
        mcpAccounts: singleCount(mcpAccounts),
        activeAgents: singleCount(activeAgents),
        activeCatalogItems: singleCount(items),
      },
    };
  }

  private async memberStatusDistribution(
    marketId: string,
  ): Promise<ReportValue> {
    const rows = await this.queryRows(
      `SELECT m.status::text AS key, count(*)::int AS count
         FROM members m
         JOIN member_market_preferences p ON p.member_id = m.id
        WHERE p.market_id = $1 AND p.is_enabled = true
        GROUP BY m.status`,
      [marketId],
    );
    return {
      kind: 'STATUS_COUNTS',
      windowDays: 0,
      ...this.toCounts(rows),
    };
  }

  private async merchantStatusDistribution(
    marketId: string,
  ): Promise<ReportValue> {
    const rows = await this.queryRows(
      `SELECT status::text AS key, count(*)::int AS count
         FROM merchant_branches
        WHERE market_id = $1
        GROUP BY status`,
      [marketId],
    );
    return {
      kind: 'STATUS_COUNTS',
      windowDays: 0,
      ...this.toCounts(rows),
    };
  }

  private async agentStatusDistribution(
    marketCode: string,
  ): Promise<ReportValue> {
    const rows = await this.queryRows(
      `SELECT status::text AS key, count(*)::int AS count
         FROM agent_activation
        WHERE market = $1
        GROUP BY status`,
      [marketCode],
    );
    return {
      kind: 'STATUS_COUNTS',
      windowDays: 0,
      ...this.toCounts(rows),
    };
  }

  private async transactionValue(
    marketId: string,
    windowDays: number,
  ): Promise<ReportValue> {
    const [byCurrency, totals] = await Promise.all([
      this.queryRows(
        `SELECT t.currency AS key, count(*)::int AS count,
                coalesce(sum(t.purchase_amount), 0)::text AS total_purchase_amount,
                coalesce(sum(f.amount), 0)::text AS total_service_fee_amount
           FROM transactions t
           LEFT JOIN transaction_service_fees f ON f.transaction_id = t.id
          WHERE t.market_id = $1 AND t.status = 'CONFIRMED'
            AND t.confirmed_at >= now() - make_interval(days => $2)
          GROUP BY t.currency`,
        [marketId, windowDays],
      ),
      this.queryRows(
        `SELECT count(*)::int AS count,
                coalesce(sum(t.purchase_amount), 0)::text AS total_purchase_amount,
                coalesce(sum(f.amount), 0)::text AS total_service_fee_amount
           FROM transactions t
           LEFT JOIN transaction_service_fees f ON f.transaction_id = t.id
          WHERE t.market_id = $1 AND t.status = 'CONFIRMED'
            AND t.confirmed_at >= now() - make_interval(days => $2)`,
        [marketId, windowDays],
      ),
    ]);
    const totalRow = totals[0];
    return {
      kind: 'TRANSACTION_VALUE',
      windowDays,
      byCurrency: toTransactionValueGroups(byCurrency),
      totals: {
        count: totalRow ? Number(totalRow['count']) : 0,
        totalPurchaseAmount: totalRow
          ? String(totalRow['total_purchase_amount'])
          : '0',
        totalServiceFeeAmount: totalRow
          ? String(totalRow['total_service_fee_amount'])
          : '0',
      },
    };
  }

  private async mcpOverview(
    marketId: string,
    windowDays: number,
  ): Promise<ReportValue> {
    const [accountRows, ledgerRows] = await Promise.all([
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count
           FROM mcp_accounts
          WHERE market_id = $1
          GROUP BY status`,
        [marketId],
      ),
      this.queryRows(
        `SELECT l.entry_type::text AS key, count(*)::int AS count,
                coalesce(sum(l.amount), 0)::text AS total_amount
           FROM mcp_ledger_entries l
           JOIN mcp_accounts a ON a.id = l.mcp_account_id
          WHERE a.market_id = $1
            AND l.created_at >= now() - make_interval(days => $2)
          GROUP BY l.entry_type`,
        [marketId, windowDays],
      ),
    ]);
    return {
      kind: 'MCP_OVERVIEW',
      accounts: this.toCounts(accountRows),
      ledger: { windowDays, groups: toVolumeGroups(ledgerRows) },
    };
  }

  private async rewardAccrual(
    marketId: string,
    windowDays: number,
  ): Promise<ReportValue> {
    const [accrualRows, planRows] = await Promise.all([
      this.queryRows(
        `SELECT ledger_entry_type::text AS key, count(*)::int AS count,
                coalesce(sum(amount), 0)::text AS total_amount
           FROM reward_daily_accruals
          WHERE market_id = $1
            AND executed_at_utc >= now() - make_interval(days => $2)
          GROUP BY ledger_entry_type`,
        [marketId, windowDays],
      ),
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count
           FROM reward_plans
          WHERE market_id = $1
          GROUP BY status`,
        [marketId],
      ),
    ]);
    return {
      kind: 'REWARD_ACCRUAL',
      windowDays,
      accruals: { groups: toVolumeGroups(accrualRows) },
      plans: this.toCounts(planRows),
    };
  }

  private async commissionOverview(
    marketCode: string,
    windowDays: number,
  ): Promise<ReportValue> {
    const [ledgerRows, adjustmentRows] = await Promise.all([
      this.queryRows(
        `SELECT entry_type::text AS key, count(*)::int AS count,
                coalesce(sum(amount), 0)::text AS total_amount
           FROM commission_ledger
          WHERE market = $1
            AND created_at >= now() - make_interval(days => $2)
          GROUP BY entry_type`,
        [marketCode, windowDays],
      ),
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count
           FROM commission_adjustment_request
          WHERE market = $1
            AND created_at >= now() - make_interval(days => $2)
          GROUP BY status`,
        [marketCode, windowDays],
      ),
    ]);
    return {
      kind: 'COMMISSION_OVERVIEW',
      windowDays,
      ledger: { groups: toVolumeGroups(ledgerRows) },
      adjustments: this.toCounts(adjustmentRows),
    };
  }

  private async redemptionVolume(
    marketId: string,
    windowDays: number,
  ): Promise<ReportValue> {
    const [orderRows, itemRows] = await Promise.all([
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count,
                coalesce(sum(total_points), 0)::text AS total_points
           FROM redemption_orders
          WHERE market_id = $1
            AND created_at >= now() - make_interval(days => $2)
          GROUP BY status`,
        [marketId, windowDays],
      ),
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count
           FROM redemption_catalog_items
          WHERE market_id = $1
          GROUP BY status`,
        [marketId],
      ),
    ]);
    return {
      kind: 'REDEMPTION_VOLUME',
      windowDays,
      orders: toPointsGroups(orderRows),
      items: this.toCounts(itemRows),
    };
  }

  private async fulfilmentExceptionOverview(
    marketId: string,
  ): Promise<ReportValue> {
    const [exceptionRows, paymentRows] = await Promise.all([
      this.queryRows(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE e.resolved = true)::int AS resolved,
                count(*) FILTER (WHERE e.resolved = false)::int AS unresolved
           FROM redemption_fulfilment_exceptions e
           JOIN redemption_fulfilments f ON f.id = e.fulfilment_id
           JOIN redemption_orders o ON o.id = f.order_id
          WHERE o.market_id = $1`,
        [marketId],
      ),
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count
           FROM redemption_shipping_payments
          WHERE market_id = $1
          GROUP BY status`,
        [marketId],
      ),
    ]);
    const row = exceptionRows[0];
    return {
      kind: 'FULFILMENT_OVERVIEW',
      exceptions: {
        total: row ? Number(row['total']) : 0,
        resolved: row ? Number(row['resolved']) : 0,
        unresolved: row ? Number(row['unresolved']) : 0,
      },
      shippingPayments: this.toCounts(paymentRows),
    };
  }

  private async refundOverview(
    marketId: string,
    windowDays: number,
  ): Promise<ReportValue> {
    const [mcpRows, redemptionRows] = await Promise.all([
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count
           FROM mcp_refund_requests
          WHERE market_id = $1
            AND created_at >= now() - make_interval(days => $2)
          GROUP BY status`,
        [marketId, windowDays],
      ),
      this.queryRows(
        `SELECT r.status::text AS key, count(*)::int AS count
           FROM redemption_refund_requests r
           JOIN redemption_orders o ON o.id = r.order_id
          WHERE o.market_id = $1
            AND r.created_at >= now() - make_interval(days => $2)
          GROUP BY r.status`,
        [marketId, windowDays],
      ),
    ]);
    return {
      kind: 'REFUND_OVERVIEW',
      windowDays,
      mcp: this.toCounts(mcpRows),
      redemption: this.toCounts(redemptionRows),
    };
  }

  private async riskExceptionOverview(marketId: string): Promise<ReportValue> {
    const [eventRows, queueRows, exceptionRows] = await Promise.all([
      this.queryRows(
        `SELECT severity::text AS key, count(*)::int AS count
           FROM risk_events
          WHERE market_id = $1
          GROUP BY severity`,
        [marketId],
      ),
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count
           FROM risk_review_queue
          WHERE market_id = $1
          GROUP BY status`,
        [marketId],
      ),
      this.queryRows(
        `SELECT status::text AS key, count(*)::int AS count
           FROM reconciliation_exceptions
          WHERE market_id = $1
          GROUP BY status`,
        [marketId],
      ),
    ]);
    return {
      kind: 'RISK_EXCEPTION_OVERVIEW',
      riskEvents: this.toCounts(eventRows),
      riskQueue: this.toCounts(queueRows),
      reconciliationExceptions: this.toCounts(exceptionRows),
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private pool(): Pool {
    return this.database.pool;
  }

  private async marketRow(marketId: string): Promise<MarketRow | null> {
    const result = await this.pool().query<{
      id: string;
      code: string;
      status: string;
      currencyCode: string;
      timezone: string;
    }>(
      `SELECT id, code, status::text AS status,
              currency_code AS "currencyCode", timezone
         FROM markets
        WHERE id = $1
        LIMIT 1`,
      [marketId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      code: String(row.code),
      status: String(row.status),
      currencyCode: String(row.currencyCode),
      timezone: String(row.timezone),
    };
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

function toVolumeGroups(
  rows: CountRow[],
): Record<string, { count: number; totalAmount: string }> {
  const groups: Record<string, { count: number; totalAmount: string }> = {};
  for (const row of rows) {
    groups[String(row['key'])] = {
      count: Number(row['count']),
      totalAmount: String(row['total_amount']),
    };
  }
  return groups;
}

function toTransactionValueGroups(rows: CountRow[]): Record<
  string,
  {
    count: number;
    totalPurchaseAmount: string;
    totalServiceFeeAmount: string;
  }
> {
  const groups: Record<
    string,
    {
      count: number;
      totalPurchaseAmount: string;
      totalServiceFeeAmount: string;
    }
  > = {};
  for (const row of rows) {
    groups[String(row['key'])] = {
      count: Number(row['count']),
      totalPurchaseAmount: String(row['total_purchase_amount']),
      totalServiceFeeAmount: String(row['total_service_fee_amount']),
    };
  }
  return groups;
}

function toPointsGroups(
  rows: CountRow[],
): Record<string, { count: number; totalPoints: string }> {
  const groups: Record<string, { count: number; totalPoints: string }> = {};
  for (const row of rows) {
    groups[String(row['key'])] = {
      count: Number(row['count']),
      totalPoints: String(row['total_points']),
    };
  }
  return groups;
}

function singleCount(rows: CountRow[]): number {
  return rows[0] ? Number(rows[0]['count']) : 0;
}

function roundMs(milliseconds: number): number {
  return Math.round(milliseconds * 10) / 10;
}

export type { ReportId };

import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { AuditListQueryDto } from './admin-audit-ops.dto.js';
import { auditEntryNotFoundError } from './admin-audit-ops.errors.js';
import {
  maskAuditValue,
  type AuditEntryRawView,
  type AuditEntryView,
  type AuditListResponse,
  type AuditViewerActor,
} from './admin-audit-ops.types.js';

interface MarketRow {
  id: string;
  code: string;
}

interface AuditRow {
  id: string;
  occurred_at: Date;
  actor_type: string;
  actor_id: string | null;
  market_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  result: string;
  request_id: string | null;
  ip_address: string | null;
}

/**
 * P7-S9 Audit Viewer service.
 *
 * Market-scoped, READ-ONLY projections over the canonical append-only
 * `audit_logs` table (the `audit_logs_append_only` trigger blocks
 * UPDATE/DELETE; `audit_logs_market_time_idx` covers the market + time
 * filter). No write path exists on this surface: the viewer only SELECTs,
 * and every response is masked unless the actor holds the raw-evidence
 * permission (`audit.sensitive-diff.view`, step-up + recorded reason
 * enforced by the RbacGuard). The Support / read-only auditor template
 * holds `audit.read` but NOT `audit.sensitive-diff.view` — support never
 * reaches raw ledgers.
 */
@Injectable()
export class AdminAuditOpsService {
  private readonly logger = new Logger(AdminAuditOpsService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async listEntries(
    _actor: AuditViewerActor,
    marketId: string,
    query: AuditListQueryDto,
  ): Promise<AuditListResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw auditEntryNotFoundError(marketId);

    const { where, params } = this.buildWhere(marketId, query);
    const asOf = new Date();
    const [rowsResult, totalResult] = await Promise.all([
      this.database.pool.query<AuditRow>(
        `SELECT id, occurred_at, actor_type, actor_id, market_id, action,
                entity_type, entity_id, before, after, reason, result,
                request_id, ip_address
           FROM audit_logs
          WHERE ${where}
          ORDER BY occurred_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.limit, query.offset],
      ),
      this.database.pool.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM audit_logs WHERE ${where}`,
        params,
      ),
    ]);
    return {
      asOf: asOf.toISOString(),
      marketId,
      items: rowsResult.rows.map((row) => this.toMaskedView(row)),
      total: totalResult.rows[0]?.total ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /** Single entry, masked limited view. 404 when not in the market. */
  async getEntry(
    _actor: AuditViewerActor,
    marketId: string,
    entryId: string,
  ): Promise<AuditEntryView> {
    const market = await this.marketRow(marketId);
    if (!market) throw auditEntryNotFoundError(marketId);
    const row = await this.entryInMarket(marketId, entryId);
    if (!row) throw auditEntryNotFoundError(entryId);
    return this.toMaskedView(row);
  }

  /**
   * Raw evidence view (`audit.sensitive-diff.view` — the RbacGuard has
   * already enforced the recorded reason + fresh step-up grant and
   * excluded the Support template before this method runs). Returns the
   * stored before/after evidence, source IP and request id. Read-only.
   */
  async getRawEntry(
    _actor: AuditViewerActor,
    marketId: string,
    entryId: string,
  ): Promise<AuditEntryRawView> {
    const market = await this.marketRow(marketId);
    if (!market) throw auditEntryNotFoundError(marketId);
    const row = await this.entryInMarket(marketId, entryId);
    if (!row) throw auditEntryNotFoundError(entryId);
    return {
      id: row.id,
      occurredAt: row.occurred_at.toISOString(),
      actorType: row.actor_type,
      actorId: row.actor_id,
      marketId: row.market_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      result: row.result,
      reason: row.reason,
      requestId: row.request_id,
      ipAddress: row.ip_address,
      raw: true,
      before: row.before,
      after: row.after,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private buildWhere(
    marketId: string,
    query: AuditListQueryDto,
  ): { where: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    clauses.push(`market_id = ${bind(marketId)}`);
    if (query.actorType) clauses.push(`actor_type = ${bind(query.actorType)}`);
    if (query.action) {
      clauses.push(`action ILIKE ${bind(`%${escapeLike(query.action)}%`)}`);
    }
    if (query.entityType) {
      clauses.push(
        `entity_type ILIKE ${bind(`%${escapeLike(query.entityType)}%`)}`,
      );
    }
    if (query.result) clauses.push(`result = ${bind(query.result)}`);
    if (query.from)
      clauses.push(`occurred_at >= ${bind(new Date(query.from))}`);
    if (query.to) clauses.push(`occurred_at <= ${bind(new Date(query.to))}`);
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      clauses.push(
        `(action ILIKE ${bind(pattern)} OR entity_type ILIKE ${bind(pattern)}
          OR entity_id ILIKE ${bind(pattern)} OR actor_id::text ILIKE ${bind(pattern)})`,
      );
    }
    return { where: clauses.join(' AND '), params };
  }

  private async marketRow(marketId: string): Promise<MarketRow | null> {
    const result = await this.database.pool.query<MarketRow>(
      'SELECT id, code FROM markets WHERE id = $1 LIMIT 1',
      [marketId],
    );
    return result.rows[0] ?? null;
  }

  private async entryInMarket(
    marketId: string,
    entryId: string,
  ): Promise<AuditRow | null> {
    const result = await this.database.pool.query<AuditRow>(
      `SELECT id, occurred_at, actor_type, actor_id, market_id, action,
              entity_type, entity_id, before, after, reason, result,
              request_id, ip_address
         FROM audit_logs
        WHERE id = $1 AND market_id = $2
        LIMIT 1`,
      [entryId, marketId],
    );
    return result.rows[0] ?? null;
  }

  private toMaskedView(row: AuditRow): AuditEntryView {
    return {
      id: row.id,
      occurredAt: row.occurred_at.toISOString(),
      actorType: row.actor_type,
      actorId: row.actor_id,
      marketId: row.market_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      result: row.result,
      reason: row.reason,
      requestId: row.request_id,
      masked: true,
      beforeMasked: maskAuditValue(row.before),
      afterMasked: maskAuditValue(row.after),
    };
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

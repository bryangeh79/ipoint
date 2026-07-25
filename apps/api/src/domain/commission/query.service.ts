/**
 * Commission Ledger Query Service
 *
 * Provides read-only query access to the commission_ledger table with
 * member-facing ledger views, admin search, per-market summaries, and
 * audit log retrieval.
 *
 * ## Display Scale
 * - MYR / SGD: 2 decimal places (posting scale)
 * - All amounts returned as decimal strings with trailing zeros.
 *
 * @packageDocumentation
 */

import { Inject, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { and, eq, sql, gte, lte, count } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import {
  commissionLedger,
  commissionStatusEvents,
  commissionProcessing,
  members,
} from '@ipoint/database';
import type { PgColumn } from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** Default page size for paginated queries. */
const DEFAULT_LIMIT = 20;

/** Maximum page size to prevent abuse. */
const MAX_LIMIT = 100;

/** Display scale (2dp for MYR/SGD). */
const DISPLAY_SCALE = 2;

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

/**
 * A single commission ledger entry as returned to the caller.
 */
export interface LedgerEntryResponse {
  id: string;
  publicReference: string;
  beneficiaryId: string;
  sourceType: string;
  sourceReference: string;
  market: string;
  currency: string;
  amount: string;
  generation: number;
  entryType: string;
  postingStatus: string;
  effectiveTime: string;
  createdAt: string;
  reversalLinkage: string | null;
  auditLinkage: string | null;
  notes: string | null;
  /** Resolved member details (populated on admin search). */
  beneficiary?: {
    id: string;
    publicMemberId: string;
  } | null;
}

/**
 * Paginated LEDGER response wrapper.
 */
export interface PaginatedLedgerResponse {
  entries: LedgerEntryResponse[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Per-market totals for a member's commission summary.
 */
export interface MarketSummaryEntry {
  market: string;
  currency: string;
  totalEarned: string;
  entryCount: number;
}

/**
 * Commission summary grouped by market.
 */
export interface CommissionSummaryResponse {
  memberId: string;
  markets: MarketSummaryEntry[];
  grandTotal: string;
  currency: string;
}

/**
 * A single status audit event for a commission entry.
 */
export interface AuditEventResponse {
  eventId: string;
  entryId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string | null;
  changedByType: string;
  reason: string | null;
  changedAt: string;
  eventSequence: number;
}

/**
 * Options for getLedger.
 */
export interface GetLedgerOptions {
  market?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * Options for adminSearch.
 */
export interface AdminSearchOptions {
  beneficiaryId?: string;
  market?: string;
  sourceType?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/* ------------------------------------------------------------------ */
/*  Service                                                           */
/* ------------------------------------------------------------------ */

@Injectable()
export class CommissionQueryService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /* ================================================================ */
  /*  PUBLIC API                                                       */
  /* ================================================================ */

  /**
   * Get paginated commission ledger entries for a member.
   *
   * @param memberId - The beneficiary member UUID
   * @param options  - Optional filters and pagination
   * @returns Paginated ledger entries
   */
  async getLedger(
    memberId: string,
    options?: GetLedgerOptions,
  ): Promise<PaginatedLedgerResponse> {
    const limit = this.clampLimit(options?.limit);
    const offset = Math.max(0, options?.offset ?? 0);
    const db = this.database.db;

    // Build filter conditions
    const conditions: ReturnType<typeof eq>[] = [
      eq(commissionLedger.beneficiaryId, memberId),
    ];

    if (options?.market) {
      conditions.push(eq(commissionLedger.market, options.market.toUpperCase()));
    }

    if (options?.status) {
      conditions.push(eq(commissionLedger.postingStatus, options.status));
    }

    const where = and(...conditions);

    // Get total count
    const countResult = await db
      .select({ total: count() })
      .from(commissionLedger)
      .where(where);

    const total = Number(countResult[0]?.total ?? 0);

    // Get paginated rows
    const rows = await db
      .select()
      .from(commissionLedger)
      .where(where)
      .orderBy(commissionLedger.createdAt)
      .limit(limit)
      .offset(offset);

    return {
      entries: rows.map((row) => this.toEntryResponse(row)),
      total,
      limit,
      offset,
    };
  }

  /**
   * Get a single commission ledger entry with optional auth check.
   *
   * If `memberId` is provided, the service verifies that the entry
   * belongs to the specified member (authorization check).
   *
   * @param entryId  - The ledger entry UUID
   * @param memberId - (Optional) Require the entry to belong to this member
   * @returns The ledger entry
   * @throws NotFoundException if the entry does not exist
   * @throws ForbiddenException if memberId is provided and does not match
   */
  async getLedgerDetail(
    entryId: string,
    memberId?: string,
  ): Promise<LedgerEntryResponse> {
    const db = this.database.db;

    const rows = await db
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.id, entryId))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(
        `Commission ledger entry not found: ${entryId}`,
      );
    }

    const entry = rows[0]!;

    // Auth check: if memberId is specified, verify the entry belongs to them
    if (memberId && entry.beneficiaryId !== memberId) {
      throw new ForbiddenException(
        'You do not have access to this commission entry',
      );
    }

    return this.toEntryResponse(entry);
  }

  /**
   * Get a per-market commission summary for a member.
   *
   * Groups all EARNED entries by market and returns totals.
   *
   * @param memberId - The beneficiary member UUID
   * @returns Per-market commission totals
   */
  async getSummary(memberId: string): Promise<CommissionSummaryResponse> {
    const db = this.database.db;

    // Per-market aggregation
    const summaryRows = await db
      .select({
        market: commissionLedger.market,
        currency: commissionLedger.currency,
        totalEarned: sql<string>`SUM(CAST(${commissionLedger.amount} AS NUMERIC(38,10)))::TEXT`,
        entryCount: count(),
      })
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.beneficiaryId, memberId),
          eq(commissionLedger.postingStatus, 'EARNED'),
        ),
      )
      .groupBy(commissionLedger.market, commissionLedger.currency)
      .orderBy(commissionLedger.market);

    const markets: MarketSummaryEntry[] = summaryRows.map((row) => ({
      market: row.market,
      currency: row.currency,
      totalEarned: this.formatAmount(row.totalEarned ?? '0'),
      entryCount: Number(row.entryCount),
    }));

    // Grand total across all markets
    const grandTotalRow = await db
      .select({
        total: sql<string>`SUM(CAST(${commissionLedger.amount} AS NUMERIC(38,10)))::TEXT`,
      })
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.beneficiaryId, memberId),
          eq(commissionLedger.postingStatus, 'EARNED'),
        ),
      );

    const grandTotal = this.formatAmount(grandTotalRow[0]?.total ?? '0');

    // Derive currency from the most common entry, default to MYR
    const currency = markets.length > 0 ? markets[0]!.currency : 'MYR';

    return {
      memberId,
      markets,
      grandTotal,
      currency,
    };
  }

  /**
   * Admin search across commission ledger entries.
   *
   * Supports filtering by beneficiary, market, source type, status,
   * and effective time range.
   *
   * @param options - Search filters and pagination
   * @returns Paginated ledger entries with beneficiary details
   */
  async adminSearch(
    options?: AdminSearchOptions,
  ): Promise<PaginatedLedgerResponse> {
    const limit = this.clampLimit(options?.limit);
    const offset = Math.max(0, options?.offset ?? 0);
    const db = this.database.db;

    // Build conditions dynamically
    const conditions: ReturnType<typeof eq | typeof gte | typeof lte>[] = [];

    if (options?.beneficiaryId) {
      conditions.push(
        eq(commissionLedger.beneficiaryId, options.beneficiaryId),
      );
    }

    if (options?.market) {
      conditions.push(
        eq(commissionLedger.market, options.market.toUpperCase()),
      );
    }

    if (options?.sourceType) {
      conditions.push(
        eq(commissionLedger.sourceType, options.sourceType),
      );
    }

    if (options?.status) {
      conditions.push(
        eq(commissionLedger.postingStatus, options.status),
      );
    }

    if (options?.from) {
      conditions.push(
        gte(commissionLedger.effectiveTime, new Date(options.from)),
      );
    }

    if (options?.to) {
      conditions.push(
        lte(commissionLedger.effectiveTime, new Date(options.to)),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const countResult = await db
      .select({ total: count() })
      .from(commissionLedger)
      .where(where);

    const total = Number(countResult[0]?.total ?? 0);

    // Get paginated rows with beneficiary member info
    const rows = await db
      .select({
        entry: commissionLedger,
        beneficiaryPublicId: members.publicMemberId,
      })
      .from(commissionLedger)
      .leftJoin(members, eq(commissionLedger.beneficiaryId, members.id))
      .where(where)
      .orderBy(commissionLedger.createdAt)
      .limit(limit)
      .offset(offset);

    return {
      entries: rows.map((row) => ({
        ...this.toEntryResponse(row.entry),
        beneficiary: row.beneficiaryPublicId
          ? {
              id: row.entry.beneficiaryId,
              publicMemberId: row.beneficiaryPublicId,
            }
          : null,
      })),
      total,
      limit,
      offset,
    };
  }

  /**
   * Get the full status event history for a commission ledger entry.
   *
   * @param entryId - The ledger entry UUID
   * @returns Ordered list of status events
   * @throws NotFoundException if the entry does not exist
   */
  async getAuditLog(entryId: string): Promise<AuditEventResponse[]> {
    const db = this.database.db;

    // Verify the entry exists
    const entryExists = await db
      .select({ id: commissionLedger.id })
      .from(commissionLedger)
      .where(eq(commissionLedger.id, entryId))
      .limit(1);

    if (entryExists.length === 0) {
      throw new NotFoundException(
        `Commission ledger entry not found: ${entryId}`,
      );
    }

    // Fetch status events ordered by sequence
    const events = await db
      .select()
      .from(commissionStatusEvents)
      .where(eq(commissionStatusEvents.entryId, entryId))
      .orderBy(commissionStatusEvents.eventSequence);

    return events.map((event) => ({
      eventId: event.eventId,
      entryId: event.entryId,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      changedBy: event.changedBy,
      changedByType: event.changedByType,
      reason: event.reason,
      changedAt: event.changedAt.toISOString(),
      eventSequence: Number(event.eventSequence),
    }));
  }

  /* ================================================================ */
  /*  PRIVATE HELPERS                                                  */
  /* ================================================================ */

  /**
   * Convert a raw commission_ledger row into the API response shape.
   *
   * Amounts are returned as decimal strings formatted to display scale
   * (2dp for MYR / SGD).
   */
  private toEntryResponse(
    row: typeof commissionLedger.$inferSelect,
  ): LedgerEntryResponse {
    return {
      id: row.id,
      publicReference: row.publicReference,
      beneficiaryId: row.beneficiaryId,
      sourceType: row.sourceType,
      sourceReference: row.sourceReference,
      market: row.market,
      currency: row.currency,
      amount: this.formatAmount(row.amount),
      generation: row.generation,
      entryType: row.entryType,
      postingStatus: row.postingStatus,
      effectiveTime: row.effectiveTime.toISOString(),
      createdAt: row.createdAt.toISOString(),
      reversalLinkage: row.reversalLinkage,
      auditLinkage: row.auditLinkage,
      notes: row.notes,
      beneficiary: null,
    };
  }

  /**
   * Format a decimal string to the display scale with trailing zeros.
   *
   * Example: "88.0000000000" → "88.00"
   *          "-38.5000000000" → "-38.50"
   *          "0.0000000000" → "0.00"
   */
  private formatAmount(amount: string): string {
    // Trim existing value to display scale
    const num = Number(amount);
    if (Number.isNaN(num)) {
      return amount;
    }
    return num.toFixed(DISPLAY_SCALE);
  }

  /**
   * Clamp pagination limit within allowed bounds.
   */
  private clampLimit(limit?: number): number {
    if (limit === undefined || limit === null) {
      return DEFAULT_LIMIT;
    }
    return Math.max(1, Math.min(limit, MAX_LIMIT));
  }
}

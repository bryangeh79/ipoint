/**
 * Commission Rate Management Service
 *
 * Implements the Rate Versioning rules as specified in
 * P5-S0 Section 10 (Rate Versioning) and the commission_rate_version
 * DDL (Section 23.5), and the D-054 secured owner contract (CG-04 gate)
 * mirroring the accepted D-050 (reward rule) / D-053 (redemption rate)
 * owner patterns.
 *
 * ## Key Rules
 * - Rates are versioned and immutable after creation (no updates/deletes)
 * - New rates are prospective only (no retroactive changes)
 * - No overlapping effective periods for the same (commission_type, generation, market)
 * - Historical ledger entries are not recalculated when rates change
 * - Market isolation: rates are per-market
 * - Append-only hard guarantee: reject_update / reject_delete triggers
 *   (migration 0032) — the frozen gist EXCLUDE was replaced by the owner
 *   chain rule + transaction-scoped advisory lock (documented deviation,
 *   D-054 §9 / delivery report §5.1)
 *
 * ## D-054 Owner Controls (all inside createRateVersion)
 * 1. Identity: authenticated ADMIN_USER actor with a real adminUserId.
 * 2. Permission: `commission.rate.manage` re-checked server-side via
 *    RbacService.isAllowed (ACTIVE admin + ACTIVE account + grant).
 * 3. Selected-market: server Current Admin Market (actor.currentMarketId)
 *    required; active market grant asserted; body market code must equal
 *    the server current market's code (409 otherwise).
 * 4. Exact rate contract: non-negative decimal, ≤10 fractional digits,
 *    ≤38 total digits (BigInt math only — no JS float arithmetic);
 *    rate_type + generation must match the frozen commission-type
 *    contract; percentages ≤100%; no invented commercial caps.
 * 5. Activation: strictly future market-local 00:00 only (IANA
 *    multi-probe resolution; same-day/backdated/non-midnight and
 *    DST-skipped/ambiguous midnights rejected); resolved UTC + local
 *    wall time + timezone returned.
 * 6. Versioning: append-only half-open [effectiveFrom, effectiveUntil)
 *    windows; strictly increasing starts per commission type +
 *    generation + market; successor may start exactly at a predecessor's
 *    stored end; no UPDATE/DELETE of existing rows.
 * 7. Concurrency: transaction-scoped pg_advisory_xact_lock per market;
 *    exactly one winner.
 * 8. Idempotency: Idempotency-Key mandatory; mechanism row in
 *    merchant_api_idempotency_keys (scope
 *    commission.rate.owner.create:<marketId>:<adminUserId>); canonical
 *    payload hash (sorted keys + sha256); same-key/same-payload replays
 *    the original result; same-key/different-payload → 409.
 * 9. Reason: mandatory 1..500 chars, stored durably on the version row
 *    (migration 0032); legacy rows keep NULL.
 * 10. Audit: owner write + idempotency claim + immutable audit in ONE
 *     transaction (atomic rollback on any failure).
 *
 * ## Rate Type Rules
 * - AGENT_UPGRADE: rate_type = FIXED (fixed amount)
 * - MEMBER_CONSUMPTION: rate_type = PERCENTAGE
 * - MERCHANT_RECRUITMENT: rate_type = PERCENTAGE
 * - AGENT_ACTIVATION_FEE: rate_type = FIXED (versioned activation fee, P5-R1)
 *
 * ## Generation Values (P5-R1 reconciled with P5-S0 contract)
 * - 0: Single-generation types (MERCHANT_RECRUITMENT, AGENT_ACTIVATION_FEE)
 * - 1: Generation 1 (AGENT_UPGRADE / MEMBER_CONSUMPTION direct referrer)
 * - 2: Generation 2 (AGENT_UPGRADE / MEMBER_CONSUMPTION indirect referrer)
 *
 * ## Decimal Handling
 * - rate_value stored as NUMERIC(38,10) — decimal strings throughout
 * - No floating-point arithmetic
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import {
  adminUsers,
  commissionRateVersions,
  marketAccess,
  markets,
  type Database,
} from '@ipoint/database';
import { DatabaseService } from '../../database/database.service.js';
import { AuditService } from '../../platform-access/audit.service.js';
import { RbacService } from '../../platform-access/rbac.service.js';
import {
  RateManagementError,
  commissionRateActivationNotFutureError,
  commissionRateCreateFailedError,
  commissionRateIdempotencyConflictError,
  commissionRateIdempotencyKeyRequiredError,
  commissionRateMarketAccessDeniedError,
  commissionRateMarketContextMismatchError,
  commissionRateMarketNotFoundError,
  commissionRateMarketSelectionRequiredError,
  commissionRatePercentageLimitError,
  commissionRatePermissionDeniedError,
  commissionRatePrecisionError,
  commissionRateReasonRequiredError,
  commissionRateTimezoneMismatchError,
  invalidCommissionTypeError,
  invalidEffectiveRangeError,
  invalidGenerationError,
  invalidMarketError,
  invalidRateTypeError,
  invalidRateValueError,
  overlappingRatePeriodError,
  rateTypeMismatchError,
  rateVersionNotFoundError,
  COMMISSION_GENERATIONS,
  COMMISSION_TYPE_RATE_TYPE,
  VALID_COMMISSION_TYPES,
  VALID_RATE_TYPES,
} from './rate.errors.js';
import type {
  CommissionRateAdminActor,
  CreateRateVersionCommand,
  CreateRateVersionResponse,
} from './rate.types.js';

export {
  RateManagementError,
  VALID_COMMISSION_TYPES,
  VALID_RATE_TYPES,
  COMMISSION_GENERATIONS,
  COMMISSION_TYPE_RATE_TYPE,
} from './rate.errors.js';

/**
 * D-054 §7 technical precision: at most ten decimals.
 */
export const COMMISSION_RATE_SCALE = 10n ** 10n;

/**
 * Owner idempotency scope namespace (shared mechanism table
 * merchant_api_idempotency_keys, unique (scope, key)) — D-054 §10.
 */
const COMMISSION_RATE_OWNER_CREATE_SCOPE = 'commission.rate.owner.create';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DbExecutor = Database | DbTransaction;

/* ------------------------------------------------------------------ */
/*  Domain Types                                                      */
/* ------------------------------------------------------------------ */

/**
 * A single commission rate version as returned to callers.
 */
export interface RateVersionResponse {
  /** Unique version identifier. */
  id: string;
  /** Commission type: AGENT_UPGRADE, MEMBER_CONSUMPTION, MERCHANT_RECRUITMENT, AGENT_ACTIVATION_FEE. */
  commissionType: string;
  /** Generation: 0 (single-gen), 1 (G1), 2 (G2). */
  generation: number;
  /** Market code (e.g., 'MY', 'SG'). */
  market: string;
  /** The rate value as a decimal string (NUMERIC(38,10)). */
  rateValue: string;
  /** Rate type: PERCENTAGE or FIXED. */
  rateType: string;
  /** Start of validity (ISO 8601). */
  effectiveFrom: string;
  /** End of validity (ISO 8601, null = open-ended). */
  effectiveUntil: string | null;
  /** Admin UUID who created this rate version. */
  createdBy: string;
  /** When this version was created (ISO 8601). */
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

@Injectable()
export class RateManagementService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /* ================================================================ */
  /*  PUBLIC API                                                       */
  /* ================================================================ */

  /**
   * Get currently active rate versions.
   *
   * Returns the latest rate version effective at the current time per
   * (commission_type, generation, market) — i.e., effective_from <= NOW()
   * AND (effective_until IS NULL OR effective_until > NOW()), resolved
   * with the D-054 §9 logical half-open semantics: when a successor
   * supersedes an open-ended predecessor, the LATEST effective start
   * wins (a derived [start, next_start) window closes the predecessor).
   *
   * Filters by market and/or commission type when provided.
   *
   * @param market         - Optional market code filter (e.g., 'MY', 'SG')
   * @param commissionType - Optional commission type filter
   * @returns Array of currently active rate versions
   */
  async getActiveRates(
    market?: string,
    commissionType?: string,
  ): Promise<RateVersionResponse[]> {
    const db = this.database.db;
    const now = new Date();

    const conditions: ReturnType<
      typeof eq | typeof lte | typeof isNull | typeof sql
    >[] = [
      lte(commissionRateVersions.effectiveFrom, now),
      sql`(${commissionRateVersions.effectiveUntil} IS NULL OR ${commissionRateVersions.effectiveUntil} > ${now})`,
    ];

    if (market) {
      conditions.push(eq(commissionRateVersions.market, market.toUpperCase()));
    }

    if (commissionType) {
      this.assertValidCommissionType(commissionType);
      conditions.push(
        eq(commissionRateVersions.commissionType, commissionType),
      );
    }

    const rows = await db
      .select()
      .from(commissionRateVersions)
      .where(and(...conditions))
      .orderBy(
        commissionRateVersions.market,
        commissionRateVersions.commissionType,
        commissionRateVersions.generation,
        desc(commissionRateVersions.effectiveFrom),
      );

    // Logical half-open resolution: keep only the latest effective start
    // per (commission_type, generation, market). An open-ended
    // predecessor is superseded by its successor (its derived window ends
    // at the successor's start), so it must not appear as "active".
    const seen = new Set<string>();
    const active: RateVersionResponse[] = [];
    for (const row of rows) {
      const key = `${row.commissionType}:${row.generation}:${row.market}`;
      if (seen.has(key)) continue;
      seen.add(key);
      active.push(this.toRateVersionResponse(row));
    }

    return active;
  }

  /**
   * Get all versions (history) for a specific rate definition.
   *
   * Returns every version of the rate for the given (commission_type,
   * generation, market) combination, ordered by effective_from ascending.
   *
   * @param market         - Market code (e.g., 'MY', 'SG')
   * @param commissionType - Commission type
   * @param generation     - Generation value (0, 1, or 2)
   * @returns Array of all rate versions for this rate definition
   * @throws RateManagementError on invalid input
   */
  async getRateHistory(
    market: string,
    commissionType: string,
    generation: number,
  ): Promise<RateVersionResponse[]> {
    this.assertValidCommissionType(commissionType);
    this.assertValidGeneration(commissionType, generation);

    const db = this.database.db;
    const normalizedMarket = market.toUpperCase();

    const rows = await db
      .select()
      .from(commissionRateVersions)
      .where(
        and(
          eq(commissionRateVersions.commissionType, commissionType),
          eq(commissionRateVersions.generation, generation),
          eq(commissionRateVersions.market, normalizedMarket),
        ),
      )
      .orderBy(commissionRateVersions.effectiveFrom);

    return rows.map((r) => this.toRateVersionResponse(r));
  }

  /**
   * Get a single rate version by its UUID.
   *
   * @param id - The rate version UUID
   * @returns The rate version, or null if not found
   */
  async getRateById(id: string): Promise<RateVersionResponse | null> {
    const db = this.database.db;

    const rows = await db
      .select()
      .from(commissionRateVersions)
      .where(eq(commissionRateVersions.id, id))
      .limit(1);

    if (rows.length === 0) return null;

    return this.toRateVersionResponse(rows[0]!);
  }

  /**
   * Secured Phase 5 commission-rate owner create command (D-054, CG-04).
   *
   * Every control lives HERE — in the owner command layer — so the
   * canonical route AND any in-process caller get identical enforcement
   * and no unsecured raw-create path remains:
   *
   * 1. Identity: authenticated ADMIN_USER actor with a real adminUserId.
   * 2. Permission: `commission.rate.manage` re-checked server-side via
   *    RbacService.isAllowed (ACTIVE admin + ACTIVE account + grant).
   * 3. Selected-market: server Current Admin Market (actor.currentMarketId)
   *    required; active market grant asserted; body market code must equal
   *    the server current market's code (409 otherwise). Caller-supplied
   *    actors are never accepted — `createdBy` comes from the actor.
   * 4. Exact rate contract: non-negative decimal, ≤10 fractional digits,
   *    ≤38 total digits (BigInt math only — no JS float arithmetic);
   *    rate_type + generation must match the frozen commission-type
   *    contract; percentages ≤100% (no invented commercial caps);
   *    FIXED rates are denominated in the selected market's currency.
   * 5. Activation (§8): strictly future market-local 00:00 only (IANA
   *    multi-probe resolution; same-day/backdated/non-midnight and
   *    DST-skipped/ambiguous midnights rejected); resolved UTC + local
   *    wall time + timezone returned; optional payload timezone must
   *    equal the selected market's timezone.
   * 6. Versioning (§9): append-only half-open [start, end) windows;
   *    strictly increasing starts per commission type + generation +
   *    market; a successor may start exactly at its predecessor's stored
   *    end; no UPDATE/DELETE of existing rows (DB triggers).
   * 7. Concurrency (§9): transaction-scoped pg_advisory_xact_lock per
   *    market; exactly one winner.
   * 8. Idempotency (§10): Idempotency-Key mandatory; mechanism row in
   *    merchant_api_idempotency_keys (scope
   *    commission.rate.owner.create:<marketId>:<adminUserId>); canonical
   *    payload hash (sorted keys + sha256); same-key/same-payload
   *    replays the original result; same-key/different-payload → 409.
   * 9. Reason (§11): mandatory 1..500 chars, stored durably on the
   *    version row (migration 0032); legacy rows keep NULL.
   * 10. Audit (§11): owner write + idempotency claim + immutable audit in
   *     ONE transaction (atomic rollback on any failure).
   */
  async createRateVersion(
    actor: CommissionRateAdminActor,
    input: CreateRateVersionCommand,
  ): Promise<CreateRateVersionResponse> {
    // ── 1+2. Identity + permission (server-side, in-process-safe) ─────
    if (!actor?.adminUserId) throw commissionRatePermissionDeniedError();
    const allowed = await this.rbac.isAllowed({
      adminUserId: actor.adminUserId,
      permission: 'commission.rate.manage',
    });
    if (!allowed) throw commissionRatePermissionDeniedError();

    // ── 9. Mandatory reason (blank/overlength rejected) ──────────────
    const reason = input.reason?.trim() ?? '';
    if (!reason || reason.length > 500)
      throw commissionRateReasonRequiredError();

    // ── 8. Operation-scoped idempotency key (mandatory) ───────────────
    const idempotencyKey = input.idempotencyKey?.trim() ?? '';
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw commissionRateIdempotencyKeyRequiredError();
    }

    // ── 3. Selected-market + resource-market consistency ──────────────
    const marketCode = input.market?.trim().toUpperCase() ?? '';
    this.assertValidMarket(marketCode);
    if (!actor.currentMarketId) {
      throw commissionRateMarketSelectionRequiredError();
    }
    const marketId = actor.currentMarketId;
    const market = await this.marketRow(marketId);
    if (!market) throw commissionRateMarketNotFoundError();
    if (market.code !== marketCode) {
      throw commissionRateMarketContextMismatchError();
    }
    await this.assertMarketAccess(
      this.database.db,
      actor.adminUserId,
      marketId,
    );

    // ── 4. Exact rate grammar (BigInt only) ───────────────────────────
    const rateValue = input.rateValue?.trim() ?? '';
    const rateScaled = scaledRate(rateValue); // throws on grammar/precision

    // ── 4. Frozen taxonomy: commission type + generation + rate type ──
    this.assertValidCommissionType(input.commissionType);
    this.assertValidGeneration(input.commissionType, input.generation);
    this.assertValidRateType(input.rateType);
    const expectedRateType = COMMISSION_TYPE_RATE_TYPE[input.commissionType]!;
    if (input.rateType !== expectedRateType) {
      throw rateTypeMismatchError(
        input.commissionType,
        input.rateType,
        expectedRateType,
      );
    }

    // ── 4. Percentage cap (D-054 §7: ≤100%; no other invented caps) ──
    if (input.rateType === 'PERCENTAGE' && rateScaled > scaledRate('100')) {
      throw commissionRatePercentageLimitError({
        commissionType: input.commissionType,
        generation: input.generation,
        market: marketCode,
        rateValue,
      });
    }

    // ── 5. Future market-local 00:00 activation ONLY ──────────────────
    if (input.timezone?.trim() && input.timezone.trim() !== market.timezone) {
      throw commissionRateTimezoneMismatchError();
    }
    const effectiveFrom = this.parseTimestamp(input.effectiveFrom);
    if (
      !isMarketLocalMidnight(effectiveFrom, market.timezone) ||
      effectiveFrom.getTime() <= Date.now()
    ) {
      throw commissionRateActivationNotFutureError();
    }
    let effectiveUntil: Date | null = null;
    if (input.effectiveUntil) {
      effectiveUntil = this.parseTimestamp(input.effectiveUntil);
      if (effectiveUntil.getTime() <= effectiveFrom.getTime()) {
        throw invalidEffectiveRangeError(
          effectiveFrom.toISOString(),
          effectiveUntil.toISOString(),
        );
      }
    }

    // ── 8. Canonical payload hash (sorted keys + sha256) ──────────────
    const payloadHash = canonicalPayloadHash({
      operation: 'create',
      marketId,
      market: marketCode,
      commissionType: input.commissionType,
      generation: input.generation,
      rateType: input.rateType,
      rateValue,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveUntil: effectiveUntil ? effectiveUntil.toISOString() : null,
      timezone: market.timezone,
      reason,
      actorScope: `${COMMISSION_RATE_OWNER_CREATE_SCOPE}:${marketId}:${actor.adminUserId}`,
    });

    const scope = `${COMMISSION_RATE_OWNER_CREATE_SCOPE}:${marketId}:${actor.adminUserId}`;
    const lockKey = this.ownerLockKey(marketId);

    // ── 6/7/8/10: atomic create with lock, chain, idempotency, audit ──
    return this.database.runTransaction(async (tx) => {
      // 7. Serialize the whole operation per market scope. Transaction-
      // scoped lock: auto-releases at commit/rollback; a losing concurrent
      // command waits, then observes the winner's row and fails the chain
      // rule (deterministic result).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

      // 8. Claim the operation key. On conflict the row already exists
      // (replay path); on any later throw the claim rolls back with the
      // transaction so the same key can be retried after correction.
      const claimed = await tx.execute(
        sql`INSERT INTO merchant_api_idempotency_keys (scope, key, request_hash)
            VALUES (${scope}, ${idempotencyKey}, ${payloadHash})
            ON CONFLICT (scope, key) DO NOTHING
            RETURNING id`,
      );
      const claimRow = claimed.rows[0];

      if (!claimRow) {
        const existing = await tx.execute(
          sql`SELECT id, response, status_code, request_hash
              FROM merchant_api_idempotency_keys
              WHERE scope = ${scope} AND key = ${idempotencyKey}
              LIMIT 1`,
        );
        const row = existing.rows[0];
        // Same key + different payload → conflict; otherwise replay the
        // original result exactly.
        if (!row || row.response === null || row.request_hash !== payloadHash) {
          throw commissionRateIdempotencyConflictError();
        }
        return row.response as unknown as CreateRateVersionResponse;
      }

      // 6. Chain rule (proper overlap detection, D-050/D-053 pattern):
      // the new version must not fall inside any existing window. Windows
      // are half-open [start, end) — a legacy row with a stored
      // effective_until is respected (a successor may start exactly at
      // the predecessor's stored end); an open-ended predecessor yields
      // a derived [start, next_start) window, so the successor must start
      // strictly after the latest start.
      const latest = await tx.execute(
        sql`SELECT id, effective_from, effective_until
            FROM commission_rate_version
            WHERE commission_type = ${input.commissionType}
              AND generation = ${input.generation}
              AND market = ${marketCode}
            ORDER BY effective_from DESC
            LIMIT 1`,
      );
      const latestRow = latest.rows[0];
      if (latestRow) {
        const latestStart = new Date(
          latestRow.effective_from as string,
        ).getTime();
        const latestUntil = latestRow.effective_until
          ? new Date(latestRow.effective_until as string).getTime()
          : null;
        const overlaps =
          latestUntil === null
            ? effectiveFrom.getTime() <= latestStart
            : effectiveFrom.getTime() < latestUntil;
        if (overlaps) {
          throw overlappingRatePeriodError(
            input.commissionType,
            input.generation,
            marketCode,
            effectiveFrom.toISOString(),
            effectiveUntil ? effectiveUntil.toISOString() : null,
            { conflictingRateId: latestRow.id as string },
          );
        }
      }

      // 6/9. Append-only insert with the durable reason (migration 0032).
      const inserted = await tx.execute(
        sql`INSERT INTO commission_rate_version (
              commission_type, generation, market, rate_value, rate_type,
              effective_from, effective_until, created_by, reason
            ) VALUES (
              ${input.commissionType}, ${input.generation}, ${marketCode},
              ${rateValue}, ${input.rateType},
              ${effectiveFrom}, ${effectiveUntil}, ${actor.adminUserId},
              ${reason}
            ) RETURNING id, commission_type, generation, market, rate_value,
              rate_type, effective_from, effective_until, created_by,
              created_at, reason`,
      );
      const version = inserted.rows[0];
      if (!version) throw commissionRateCreateFailedError();

      // 10. Atomic immutable audit — same transaction as the insert.
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'commission.rate_version.create',
        entity: {
          type: 'commission_rate_version',
          id: version.id as string,
        },
        marketId,
        after: this.sanitizeForAudit({
          commissionType: String(version.commission_type),
          generation: Number(version.generation),
          rateType: String(version.rate_type),
          rateValue: String(version.rate_value),
          effectiveFrom: effectiveFrom.toISOString(),
          effectiveUntil: effectiveUntil ? effectiveUntil.toISOString() : null,
          timezone: market.timezone,
          // The canonical payload digest (sha256 hex). Stored under
          // idempotencyDigest so it survives the platform audit-redaction
          // layer, which scrubs *hash key names by design; the mechanism
          // table stores the same digest verbatim as request_hash.
          idempotencyDigest: payloadHash,
        }),
        reason,
        result: 'SUCCESS',
        requestId: actor.requestId ?? idempotencyKey,
        ipAddress: actor.ipAddress,
        summary: `Administrator scheduled commission rate ${String(version.rate_value)} ${String(version.rate_type)} for ${String(version.commission_type)} generation ${Number(version.generation)} in market ${marketCode} effective ${effectiveFrom.toISOString()} (${localWallString(effectiveFrom, market.timezone)} market-local).`,
      });

      const response: CreateRateVersionResponse = {
        id: version.id as string,
        commissionType: String(version.commission_type),
        generation: Number(version.generation),
        market: String(version.market),
        marketId,
        currency: market.currency,
        rateValue: String(version.rate_value),
        rateType: String(version.rate_type),
        effectiveFrom: effectiveFrom.toISOString(),
        effectiveFromLocal: localWallString(effectiveFrom, market.timezone),
        timezone: market.timezone,
        effectiveUntil: version.effective_until
          ? new Date(version.effective_until as string).toISOString()
          : null,
        reason: (version.reason as string | null) ?? '',
        createdBy: actor.adminUserId,
        createdAt: new Date(version.created_at as string).toISOString(),
      };

      // 8. Persist the original result for exact replay.
      await tx.execute(
        sql`UPDATE merchant_api_idempotency_keys
            SET response = ${JSON.stringify(response)}::jsonb,
                status_code = 201,
                updated_at = NOW()
            WHERE id = ${claimRow.id as string}`,
      );

      return response;
    });
  }

  /* ================================================================ */
  /*  PRIVATE VALIDATORS                                               */
  /* ================================================================ */

  /**
   * Assert the commission type is valid.
   *
   * @throws RateManagementError if invalid
   */
  private assertValidCommissionType(commissionType: string): void {
    if (!VALID_COMMISSION_TYPES.includes(commissionType)) {
      throw invalidCommissionTypeError(commissionType);
    }
  }

  /**
   * Assert the generation value is valid for the given commission type.
   *
   * @throws RateManagementError if invalid
   */
  private assertValidGeneration(
    commissionType: string,
    generation: number,
  ): void {
    const allowedGenerations = COMMISSION_GENERATIONS[commissionType] ?? [];
    if (!allowedGenerations.includes(generation)) {
      throw invalidGenerationError(commissionType, generation);
    }
  }

  /**
   * Assert the rate type is valid (PERCENTAGE or FIXED).
   *
   * @throws RateManagementError if invalid
   */
  private assertValidRateType(rateType: string): void {
    if (!VALID_RATE_TYPES.includes(rateType)) {
      throw invalidRateTypeError(rateType);
    }
  }

  /**
   * Assert the market code is a valid 2-letter uppercase code.
   *
   * @throws RateManagementError if invalid
   */
  private assertValidMarket(market: string): void {
    if (!/^[A-Z]{2}$/.test(market)) {
      throw invalidMarketError(market);
    }
  }

  /* ================================================================ */
  /*  PRIVATE HELPERS                                                  */
  /* ================================================================ */

  /**
   * Active market row by UUID (server Current Admin Market resolution).
   */
  private async marketRow(
    marketId: string,
  ): Promise<
    { id: string; code: string; timezone: string; currency: string } | undefined
  > {
    const rows = await this.database.db
      .select({
        id: markets.id,
        code: markets.code,
        timezone: markets.timezone,
        currency: markets.currencyCode,
      })
      .from(markets)
      .where(and(eq(markets.id, marketId), eq(markets.status, 'ACTIVE')))
      .limit(1);
    return rows[0];
  }

  /**
   * Active market grant assertion (D-054 §5): ACTIVE admin + ACTIVE
   * market + non-revoked market_access row. A revoked grant denies the
   * very next request.
   */
  private async assertMarketAccess(
    db: DbExecutor,
    adminUserId: string,
    marketId: string,
  ): Promise<void> {
    const rows = await db
      .select({ id: adminUsers.id })
      .from(marketAccess)
      .innerJoin(adminUsers, eq(adminUsers.id, marketAccess.adminUserId))
      .innerJoin(markets, eq(markets.id, marketAccess.marketId))
      .where(
        and(
          eq(marketAccess.adminUserId, adminUserId),
          eq(marketAccess.marketId, marketId),
          isNull(marketAccess.revokedAt),
          eq(adminUsers.status, 'ACTIVE'),
          eq(markets.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!rows[0]) throw commissionRateMarketAccessDeniedError();
  }

  /**
   * Market-scoped owner advisory-lock key (FNV-1a over the owner
   * namespace) so every owner mutation of a market's rate schedule
   * serializes together.
   */
  private ownerLockKey(marketId: string): bigint {
    const input = `p5d054:commission-rate-owner:${marketId}`;
    let hash = BigInt('0xcbf29ce484222325');
    for (let index = 0; index < input.length; index += 1) {
      hash ^= BigInt(input.charCodeAt(index));
      hash = (hash * BigInt(1099511628211)) & BigInt('0xFFFFFFFFFFFFFFFF');
    }
    return hash & BigInt('0x7FFFFFFFFFFFFFFF');
  }

  private sanitizeForAudit(
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
    );
  }

  /**
   * Convert a raw commission_rate_version row into the API response shape.
   */
  private toRateVersionResponse(
    row: typeof commissionRateVersions.$inferSelect,
  ): RateVersionResponse {
    return {
      id: row.id,
      commissionType: row.commissionType,
      generation: row.generation,
      market: row.market,
      rateValue: row.rateValue,
      rateType: row.rateType,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveUntil: row.effectiveUntil
        ? row.effectiveUntil.toISOString()
        : null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Parse an ISO 8601 timestamp string into a Date object.
   *
   * @param value - The timestamp string
   * @param fieldName - The field name for error messages
   * @returns Parsed Date object
   * @throws RateManagementError if the string is not a valid timestamp
   */
  private parseTimestamp(value: string, fieldName = 'effective_from'): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new RateManagementError(
        'INVALID_TIMESTAMP',
        `Invalid ${fieldName} timestamp: ${value}`,
        { field: fieldName, value },
      );
    }
    return parsed;
  }
}

/* ================================================================ */
/*  D-054 exact-decimal helpers (string only — never float)          */
/* ================================================================ */

/**
 * Scale a rate decimal string to 10^10 integer units (BigInt).
 * Rejects negative values, missing digits, or more than 10 decimals.
 * The 38-total-digit NUMERIC(38,10) bound is enforced separately
 * (`validateRateDigits`), preserving the frozen Phase 5 error surface.
 */
export function scaledRate(value: string): bigint {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d{1,10}))?$/u.exec(trimmed);
  if (!match) throw commissionRatePrecisionError();
  const whole = BigInt(match[1] ?? '0');
  const fraction = (match[2] ?? '').padEnd(10, '0') || '0';
  const scaled = whole * COMMISSION_RATE_SCALE + BigInt(fraction);
  // NUMERIC(38,10) compatibility: significant whole digits + fraction
  // digits must not exceed 38 (fraction is already ≤ 10).
  const significantWhole = (match[1] ?? '0').replace(/^0+/u, '');
  if (significantWhole.length + (match[2] ?? '').length > 38) {
    throw invalidRateValueError(
      trimmed,
      `Rate value total digits (${significantWhole.length + (match[2] ?? '').length}) exceeds maximum of 38`,
    );
  }
  return scaled;
}

/**
 * Trim a stored exact-decimal rate to its significant digits for display
 * (string-only formatting — no arithmetic). Storage keeps `numeric(38,10)`;
 * the display convention is at most six decimals (server-derived, never
 * changing the stored exact value).
 */
export function normalizeRateString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes('.')) return trimmed;
  const [whole = '0', fraction] = trimmed.split('.');
  const significant = (fraction ?? '').replace(/0+$/u, '');
  return significant === '' ? whole : `${whole}.${significant}`;
}

// ─── Market-local midnight resolution (IANA timezone, D-054 §8) ──────────

/**
 * Resolve the UTC instant of the market-local midnight of a calendar date
 * in the given IANA timezone. Returns `null` when no unambiguous 00:00:00
 * wall time exists for that date (skipped midnights such as
 * America/Havana spring-forward, or ambiguous repeated midnights such as
 * America/Santiago fall-back, or an invalid/unsupported timezone).
 *
 * Multiple probes across the UTC day are used so a transition that lands
 * between 00:00 and 12:00 local can never hide the pre-transition midnight:
 * the offset observed by at least one probe matches the offset in force at
 * the date's own 00:00.
 */
export function resolveLocalMidnight(
  dateStr: string,
  timeZone: string,
): Date | null {
  try {
    const dateParts = dateStr.split('-').map((value) => Number(value));
    const year = dateParts[0] ?? 0;
    const month = dateParts[1] ?? 0;
    const day = dateParts[2] ?? 0;
    const candidates: number[] = [];
    for (const hour of [0, 6, 12, 18]) {
      const probe = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0));
      const probeParts = localParts(probe, timeZone);
      const localAsUtc = Date.UTC(
        probeParts.year,
        probeParts.month - 1,
        probeParts.day,
        probeParts.hour,
        probeParts.minute,
        probeParts.second,
      );
      const offsetMs = localAsUtc - probe.getTime();
      const midnight = new Date(
        Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMs,
      );
      const wall = localParts(midnight, timeZone);
      if (
        wall.year === year &&
        wall.month === month &&
        wall.day === day &&
        wall.hour === 0 &&
        wall.minute === 0 &&
        wall.second === 0
      ) {
        candidates.push(midnight.getTime());
      }
    }
    if (candidates.length === 0) return null;
    const distinct = [...new Set(candidates)];
    if (distinct.length !== 1) return null;
    return new Date(distinct[0] ?? 0);
  } catch {
    // Invalid/unsupported IANA timezone (Intl throws RangeError).
    return null;
  }
}

/**
 * True when the given instant is exactly the market-local 00:00:00 of its
 * own local date in the market timezone (round-trip against
 * `resolveLocalMidnight` so DST edges — skipped or ambiguous midnights —
 * are rejected).
 */
export function isMarketLocalMidnight(at: Date, timeZone: string): boolean {
  if (Number.isNaN(at.getTime())) return false;
  const wall = localParts(at, timeZone);
  if (wall.hour !== 0 || wall.minute !== 0 || wall.second !== 0) return false;
  const dateStr = `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
  const resolved = resolveLocalMidnight(dateStr, timeZone);
  return resolved !== null && resolved.getTime() === at.getTime();
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(at: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
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
    year: Number(map.get('year') ?? '0'),
    month: Number(map.get('month') ?? '0'),
    day: Number(map.get('day') ?? '0'),
    hour: Number(map.get('hour') ?? '0'),
    minute: Number(map.get('minute') ?? '0'),
    second: Number(map.get('second') ?? '0'),
  };
}

/**
 * Market-local wall clock "YYYY-MM-DD HH:mm:ss" for display.
 */
export function localWallString(at: Date, timeZone: string): string {
  const parts = localParts(at, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`;
}

/**
 * Market-local calendar date "YYYY-MM-DD" (payload-hash component).
 */
export function localDateString(at: Date, timeZone: string): string {
  const parts = localParts(at, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

// ─── Canonical payload hash (sorted keys + sha256, D-054 §10) ────────────

/**
 * Canonical payload hash for idempotency correlation (owner pattern):
 * keys sorted recursively, then sha256 hex.
 */
export function canonicalPayloadHash(payload: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(sortJson(payload)))
    .digest('hex');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}

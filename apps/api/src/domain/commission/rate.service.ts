/**
 * Commission Rate Management Service
 *
 * Implements the Rate Versioning rules as specified in
 * P5-S0 Section 10 (Rate Versioning) and the commission_rate_version
 * DDL (Section 23.5).
 *
 * ## Key Rules
 * - Rates are versioned and immutable after creation (no updates/deletes)
 * - New rates are prospective only (no retroactive changes)
 * - No overlapping effective periods for the same (commission_type, generation, market)
 * - Historical ledger entries are not recalculated when rates change
 * - Market isolation: rates are per-market
 * - EXCLUDE constraint (uq_rate_period) enforced at DB level via btree_gist
 *
 * ## Rate Type Rules
 * - AGENT_UPGRADE: rate_type = FIXED (fixed amount)
 * - MEMBER_CONSUMPTION: rate_type = PERCENTAGE
 * - MERCHANT_RECRUITMENT: rate_type = PERCENTAGE
 *
 * ## Generation Values
 * - 0: Single-generation types (MEMBER_CONSUMPTION, MERCHANT_RECRUITMENT)
 * - 1: Generation 1 (AGENT_UPGRADE direct referrer)
 * - 2: Generation 2 (AGENT_UPGRADE indirect referrer)
 *
 * ## Decimal Handling
 * - rate_value stored as NUMERIC(38,10) — decimal strings throughout
 * - No floating-point arithmetic
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { and, eq, gte, lte, sql, isNull } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { commissionRateVersions } from '@ipoint/database';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** Supported commission types and their required rate_type per D-25 frozen. */
const COMMISSION_TYPE_RATE_TYPE: Record<string, string> = {
  AGENT_UPGRADE: 'FIXED',
  MEMBER_CONSUMPTION: 'PERCENTAGE',
  MERCHANT_RECRUITMENT: 'PERCENTAGE',
} as const;

/** Valid commission type values. */
const VALID_COMMISSION_TYPES = Object.keys(COMMISSION_TYPE_RATE_TYPE);

/** Valid rate type values. */
const VALID_RATE_TYPES = ['PERCENTAGE', 'FIXED'];

/** Valid generation values. */
const VALID_GENERATIONS = [0, 1, 2];

/** Commission types mapped to their permitted generation sets. */
const COMMISSION_GENERATIONS: Record<string, number[]> = {
  AGENT_UPGRADE: [1, 2],
  MEMBER_CONSUMPTION: [0],
  MERCHANT_RECRUITMENT: [0],
} as const;

/* ------------------------------------------------------------------ */
/*  Database Type                                                     */
/* ------------------------------------------------------------------ */

/**
 * Queryable database handle — works for both the non-transactional
 * NodePgDatabase and PgTransaction callback types since they share
 * the same query builder interface.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = any;

/* ------------------------------------------------------------------ */
/*  Domain Types                                                      */
/* ------------------------------------------------------------------ */

/**
 * A single commission rate version as returned to callers.
 */
export interface RateVersionResponse {
  /** Unique version identifier. */
  id: string;
  /** Commission type: AGENT_UPGRADE, MEMBER_CONSUMPTION, MERCHANT_RECRUITMENT. */
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

/**
 * Result returned when creating a new rate version.
 */
export interface CreateRateVersionResult {
  /** The created rate version UUID. */
  id: string;
  /** Commission type. */
  commissionType: string;
  /** Generation. */
  generation: number;
  /** Market code. */
  market: string;
  /** The rate value as a decimal string. */
  rateValue: string;
  /** Rate type: PERCENTAGE or FIXED. */
  rateType: string;
  /** Start of validity (ISO 8601). */
  effectiveFrom: string;
  /** End of validity (ISO 8601, null = open-ended). */
  effectiveUntil: string | null;
}

/* ------------------------------------------------------------------ */
/*  Error Class                                                       */
/* ------------------------------------------------------------------ */

/**
 * Domain error for rate management operations.
 */
export class RateManagementError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RateManagementError';
  }
}

/** Factory: invalid commission type. */
function invalidCommissionTypeError(
  commissionType: string,
): RateManagementError {
  return new RateManagementError(
    'INVALID_COMMISSION_TYPE',
    `Invalid commission type: ${commissionType}. Valid values: ${VALID_COMMISSION_TYPES.join(', ')}`,
    { commissionType, validTypes: VALID_COMMISSION_TYPES },
  );
}

/** Factory: invalid generation for commission type. */
function invalidGenerationError(
  commissionType: string,
  generation: number,
): RateManagementError {
  const allowedGenerations = COMMISSION_GENERATIONS[commissionType] ?? [];
  return new RateManagementError(
    'INVALID_GENERATION',
    `Invalid generation ${generation} for commission type ${commissionType}. Allowed: ${allowedGenerations.join(', ')}`,
    { commissionType, generation, allowedGenerations },
  );
}

/** Factory: invalid rate type. */
function invalidRateTypeError(rateType: string): RateManagementError {
  return new RateManagementError(
    'INVALID_RATE_TYPE',
    `Invalid rate type: ${rateType}. Valid values: ${VALID_RATE_TYPES.join(', ')}`,
    { rateType, validTypes: VALID_RATE_TYPES },
  );
}

/** Factory: rate type mismatch for commission type. */
function rateTypeMismatchError(
  commissionType: string,
  providedRateType: string,
  expectedRateType: string,
): RateManagementError {
  return new RateManagementError(
    'RATE_TYPE_MISMATCH',
    `Commission type ${commissionType} requires rate_type = ${expectedRateType}, but ${providedRateType} was provided`,
    { commissionType, providedRateType, expectedRateType },
  );
}

/** Factory: invalid effective range (effective_until <= effective_from). */
function invalidEffectiveRangeError(
  effectiveFrom: string,
  effectiveUntil: string,
): RateManagementError {
  return new RateManagementError(
    'INVALID_EFFECTIVE_RANGE',
    `effective_until must be after effective_from, or null for open-ended`,
    { effectiveFrom, effectiveUntil },
  );
}

/** Factory: overlapping rate period detected. */
function overlappingRatePeriodError(
  commissionType: string,
  generation: number,
  market: string,
  effectiveFrom: string,
  effectiveUntil: string | null,
): RateManagementError {
  return new RateManagementError(
    'OVERLAPPING_RATE_PERIOD',
    `An active rate version already exists for ${commissionType} generation ${generation} in market ${market} that overlaps with the period [${effectiveFrom}, ${effectiveUntil ?? '∞'})`,
    { commissionType, generation, market, effectiveFrom, effectiveUntil },
  );
}

/** Factory: rate version not found. */
function rateVersionNotFoundError(id: string): RateManagementError {
  return new RateManagementError(
    'RATE_VERSION_NOT_FOUND',
    `Rate version not found: ${id}`,
    { id },
  );
}

/** Factory: invalid market code. */
function invalidMarketError(market: string): RateManagementError {
  return new RateManagementError(
    'INVALID_MARKET',
    `Invalid market code: ${market}. Market code must be a 2-letter uppercase code (e.g., 'MY', 'SG')`,
    { market },
  );
}

/** Factory: invalid rate value. */
function invalidRateValueError(
  rateValue: string,
  detail?: string,
): RateManagementError {
  return new RateManagementError(
    'INVALID_RATE_VALUE',
    detail ?? `Invalid rate value: ${rateValue}`,
    { rateValue },
  );
}

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

@Injectable()
export class RateManagementService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /* ================================================================ */
  /*  PUBLIC API                                                       */
  /* ================================================================ */

  /**
   * Get currently active rate versions.
   *
   * Returns all rate versions that are effective at the current time
   * (i.e., effective_from <= NOW() AND (effective_until IS NULL OR
   * effective_until > NOW())).
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
        commissionRateVersions.effectiveFrom,
      );

    return rows.map((r) => this.toRateVersionResponse(r));
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
   * Create a new rate version.
   *
   * Validates business rules before insertion:
   * - Commission type must be valid (AGENT_UPGRADE, MEMBER_CONSUMPTION, MERCHANT_RECRUITMENT)
   * - Generation must be valid for the commission type
   * - Rate type must match the commission type (AGENT_UPGRADE → FIXED, others → PERCENTAGE)
   * - Rate value must be a non-negative decimal string
   * - Market must be a valid 2-letter uppercase code
   * - effective_until must be after effective_from when provided
   * - No overlapping effective period for the same (type, generation, market) combination
   *
   * **Immutable:** Once created, rate versions cannot be updated or deleted.
   * New rates are prospective only — existing ledger entries are not recalculated.
   *
   * @param adminId         - The admin UUID creating this rate version
   * @param commissionType  - Commission type
   * @param generation      - Generation value
   * @param market          - Market code (e.g., 'MY', 'SG')
   * @param rateValue       - Rate value as a non-negative decimal string (NUMERIC(38,10))
   * @param rateType        - Rate type: PERCENTAGE or FIXED
   * @param effectiveFrom   - Start of validity (ISO 8601 timestamp)
   * @param effectiveUntil  - End of validity (optional, null = open-ended)
   * @returns The created rate version details
   * @throws RateManagementError on validation failures or overlapping periods
   */
  async createRate(
    adminId: string,
    commissionType: string,
    generation: number,
    market: string,
    rateValue: string,
    rateType: string,
    effectiveFrom: string,
    effectiveUntil?: string,
  ): Promise<CreateRateVersionResult> {
    // ---------------------------------------------------------------
    // 1. Validate commission type
    // ---------------------------------------------------------------
    this.assertValidCommissionType(commissionType);

    // ---------------------------------------------------------------
    // 2. Validate generation for the commission type
    // ---------------------------------------------------------------
    this.assertValidGeneration(commissionType, generation);

    // ---------------------------------------------------------------
    // 3. Validate rate type
    // ---------------------------------------------------------------
    this.assertValidRateType(rateType);

    // ---------------------------------------------------------------
    // 4. Validate rate type matches commission type
    //    AGENT_UPGRADE → FIXED
    //    MEMBER_CONSUMPTION → PERCENTAGE
    //    MERCHANT_RECRUITMENT → PERCENTAGE
    // ---------------------------------------------------------------
    const expectedRateType = COMMISSION_TYPE_RATE_TYPE[commissionType]!;
    if (rateType !== expectedRateType) {
      throw rateTypeMismatchError(commissionType, rateType, expectedRateType);
    }

    // ---------------------------------------------------------------
    // 5. Validate market code
    // ---------------------------------------------------------------
    const normalizedMarket = market.toUpperCase();
    this.assertValidMarket(normalizedMarket);

    // ---------------------------------------------------------------
    // 6. Validate rate value (must be non-negative decimal string)
    // ---------------------------------------------------------------
    this.assertValidRateValue(rateValue);

    // ---------------------------------------------------------------
    // 7. Parse timestamps
    // ---------------------------------------------------------------
    const parsedFrom = this.parseTimestamp(effectiveFrom, 'effective_from');
    let parsedUntil: Date | null = null;

    if (effectiveUntil !== undefined && effectiveUntil !== null) {
      parsedUntil = this.parseTimestamp(effectiveUntil, 'effective_until');

      // 7a. Validate effective range (effective_until > effective_from)
      if (parsedUntil <= parsedFrom) {
        throw invalidEffectiveRangeError(effectiveFrom, effectiveUntil);
      }
    }

    // ---------------------------------------------------------------
    // 8. Check for overlapping effective periods
    //
    //    For the same (commission_type, generation, market), we must
    //    prevent overlapping effective date ranges. The DB has an
    //    EXCLUDE constraint (uq_rate_period) using btree_gist, but
    //    we validate at the application layer for better error messages.
    //
    //    Overlap condition (two ranges [a_from, a_until) and [b_from, b_until)):
    //    a_from < COALESCE(b_until, 'infinity') AND b_from < COALESCE(a_until, 'infinity')
    // ---------------------------------------------------------------
    const db = this.database.db;

    const overlappingRows = await db
      .select({ id: commissionRateVersions.id })
      .from(commissionRateVersions)
      .where(
        and(
          eq(commissionRateVersions.commissionType, commissionType),
          eq(commissionRateVersions.generation, generation),
          eq(commissionRateVersions.market, normalizedMarket),
          sql`${commissionRateVersions.effectiveFrom} < ${parsedUntil !== null ? parsedUntil : sql`'infinity'::timestamptz`}`,
          sql`${parsedFrom} < COALESCE(${commissionRateVersions.effectiveUntil}, 'infinity'::timestamptz)`,
        ),
      )
      .limit(1);

    if (overlappingRows.length > 0) {
      throw overlappingRatePeriodError(
        commissionType,
        generation,
        normalizedMarket,
        effectiveFrom,
        effectiveUntil ?? null,
      );
    }

    // ---------------------------------------------------------------
    // 9. Create the rate version (immutable — no updates/deletes)
    // ---------------------------------------------------------------
    const id = randomUUID();
    const now = new Date();

    await db.insert(commissionRateVersions).values({
      id,
      commissionType,
      generation,
      market: normalizedMarket,
      rateValue,
      rateType,
      effectiveFrom: parsedFrom,
      effectiveUntil: parsedUntil,
      createdBy: adminId,
      createdAt: now,
    });

    return {
      id,
      commissionType,
      generation,
      market: normalizedMarket,
      rateValue,
      rateType,
      effectiveFrom: effectiveFrom,
      effectiveUntil: effectiveUntil ?? null,
    };
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

  /**
   * Assert the rate value is a valid non-negative decimal string.
   *
   * Validates format and non-negativity at NUMERIC(38,10) precision.
   *
   * @throws RateManagementError if invalid
   */
  private assertValidRateValue(rateValue: string): void {
    if (typeof rateValue !== 'string' || rateValue.length === 0) {
      throw invalidRateValueError(
        rateValue,
        'Rate value must be a non-empty string',
      );
    }

    // Validate decimal format: optional leading -, digits, optional decimal with up to 10 digits
    const decimalRegex = /^-?\d+(\.\d{1,10})?$/;
    if (!decimalRegex.test(rateValue)) {
      throw invalidRateValueError(
        rateValue,
        'Rate value must be a valid decimal string with up to 10 decimal places',
      );
    }

    // Check non-negative per DB constraint chk_rate_value
    const isNegative = rateValue.startsWith('-');
    if (isNegative) {
      throw invalidRateValueError(rateValue, 'Rate value must be non-negative');
    }

    // Parse and verify total digits don't exceed 38
    const [intPart = '0', fracPart = ''] = rateValue.split('.');
    const totalDigits = intPart.replace(/^-?0*/, '').length + fracPart.length;

    if (totalDigits > 38) {
      throw invalidRateValueError(
        rateValue,
        `Rate value total digits (${totalDigits}) exceeds maximum of 38`,
      );
    }
  }

  /* ================================================================ */
  /*  PRIVATE HELPERS                                                  */
  /* ================================================================ */

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
  private parseTimestamp(value: string, fieldName: string): Date {
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

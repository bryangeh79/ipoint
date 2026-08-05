import { Inject, Injectable } from '@nestjs/common';
import { markets, rewardRuleVersions } from '@ipoint/database';
import { desc, eq } from 'drizzle-orm';
import { AdminRewardService } from '../admin-reward/admin-reward.service.js';
import {
  localWallString,
  normalizeRateString,
  resolveLocalMidnight,
} from '../admin-reward/admin-reward.service.js';
import type {
  AdminRewardActor,
  AdminRewardRuleVersionCreateResponse,
} from '../admin-reward/admin-reward.types.js';
import { AdminRewardError } from '../admin-reward/admin-reward.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { CreateRewardRuleDto } from './admin-reward-ops.dto.js';
import {
  rewardActivationNotFutureError,
  rewardEffectiveWindowOverlapError,
  rewardIdempotencyConflictError,
  rewardIdempotencyKeyRequiredError,
  rewardMarketAccessDeniedError,
  rewardMarketContextMismatchError,
  rewardMarketNotFoundError,
  rewardMarketSelectionRequiredError,
  rewardPermissionDeniedError,
  rewardRateExceedsGovernanceLimitError,
  rewardRateExceedsPackageMaxError,
  rewardRatePrecisionExceededError,
  rewardReasonRequiredError,
} from './admin-reward-ops.errors.js';
import {
  REWARD_PACKAGE_REFERENCE_MAX_RATE,
  REWARD_RATE_GOVERNANCE_MAX,
  REWARD_RATE_SCALE,
  REWARD_RULE_SURFACE_NAME_PREFIX,
  REWARD_RULE_SURFACE_NAME_SUFFIX,
  type AdminRewardOpsActor,
  type AdminRewardOpsError,
  type AdminRewardRuleCreateResponse,
  type AdminRewardRuleListResponse,
  type AdminRewardRuleVersionDto,
  type AdminRewardWindowStatus,
} from './admin-reward-ops.types.js';

// ─── Canonical owner helpers (D-050) ────────────────────────────────
// The market-local midnight resolution, the local-time rendering, the
// rate display normalization and the canonical payload hash are all owned
// by the frozen Phase 3 owner command (D-050). The adapter imports and
// re-exports them so the Phase 7 surface exercises ONE implementation
// (the owner's multi-probe DST-safe helper) and the unit spec keeps
// testing the canonical behavior.
export {
  canonicalPayloadHash,
  localWallString,
  normalizeRateString,
  resolveLocalMidnight,
} from '../admin-reward/admin-reward.service.js';

/**
 * P7-S6B Admin Reward Configuration adapter service (D-050 rewiring).
 *
 * Phase 7 read projection + orchestration over the canonical Phase 3
 * reward owner. The adapter NEVER enforces owner-level business controls:
 * after the D-050 remediation every one of them lives inside the secured
 * owner command `AdminRewardService.createRuleVersion` — RBAC re-check
 * (`reward.rule.schedule`, SUPER_ADMIN), identity validation, selected-
 * market enforcement (`currentMarketId`), resource-market consistency,
 * exact 0%–0.05%/day BigInt rate bounds and six-decimal precision, future
 * market-local 00:00 activation, strictly-increasing append-only windows
 * under a transaction-safe advisory lock, operation-scoped idempotency
 * with the canonical payload hash, mandatory reason (durable on the
 * version row), and the atomic immutable owner audit.
 *
 * What the adapter adds (legitimate Phase 7 orchestration/read/UI
 * behavior only):
 *
 * 1. The §7.1 package-reference surface: per-package maxima (A `0.0125`,
 *    B `0.025`, C/D/E/F `0.05` %/day) the frozen owner does not know,
 *    plus the external-contract classification that a rate above the
 *    0.05%/day governance ceiling is surfaced as
 *    `REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT` (never as a package-max
 *    error, since packages C–F share the ceiling as their maximum). The
 *    owner remains the enforcement authority — this comparison only
 *    selects the surface error code.
 * 2. The market-local calendar DATE → exact UTC instant conversion using
 *    the canonical owner helper (`resolveLocalMidnight`); the owner
 *    re-verifies the instant is a strictly future market-local 00:00.
 * 3. The read projection (`listRules`) with the frozen settlement window
 *    semantics, and the create response mapping (owner-resolved UTC +
 *    market-local activation times).
 *
 * The adapter performs NO advisory lock, NO idempotency claim/mechanism
 * writes and NO privileged audit of its own for the create path — those
 * are all owned by the canonical owner command (order §8; the owner's
 * atomic audit carries the operator reason, actor, market and request
 * correlation).
 */
@Injectable()
export class AdminRewardOpsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminRewardService) private readonly owner: AdminRewardService,
  ) {}

  // ─── Read projection ──────────────────────────────────────────────

  /**
   * Selected-market reward schedule: all rule versions for the market with
   * the §7.1 package references and the projected effective windows.
   *
   * The effective window of each market-scoped version is
   * `[effective_from, window_end)` where `window_end` is the earlier of the
   * next version's `effective_from` and an explicit `effective_to` — the
   * frozen settlement resolves exactly one effective version per
   * market-local day (latest effective_from wins inside the window), so the
   * projected windows never overlap and nothing historical is ever
   * recalculated. Versions created through this surface always have
   * `effective_to = null`, so their windows are pure chain steps.
   */
  async listRules(marketId: string): Promise<AdminRewardRuleListResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw rewardMarketNotFoundError();

    const rows = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(eq(rewardRuleVersions.marketId, marketId))
      .orderBy(
        desc(rewardRuleVersions.effectiveFrom),
        desc(rewardRuleVersions.createdAt),
      );

    // Chain semantics matching the frozen settlement resolution
    // (`RewardService.findEffectiveRuleVersion`): a version is effective for
    // `[effective_from, effective_to)` when `effective_to` is set, else
    // open-ended; the non-archived version with the latest `effective_from`
    // inside that window wins. For versions created through this surface
    // (`effective_to` always null, strictly increasing `effective_from` per
    // market) the projected window is exactly `[effective_from, next
    // effective_from)`; for legacy owner-created rows with an explicit
    // `effective_to`, the projected window ends at the earlier of the
    // explicit end and the next version's start (frozen resolution wins).
    const nonArchived = rows
      .filter((row) => row.archivedAt === null)
      .sort(
        (left, right) =>
          left.effectiveFrom.getTime() - right.effectiveFrom.getTime(),
      );
    const now = Date.now();

    const rules: AdminRewardRuleVersionDto[] = rows.map((row) => {
      const archived = row.archivedAt !== null;
      const chainIndex = archived
        ? -1
        : nonArchived.findIndex((candidate) => candidate.id === row.id);
      const chainNext =
        chainIndex >= 0 ? nonArchived[chainIndex + 1] : undefined;
      const explicitEndMs = row.effectiveTo ? row.effectiveTo.getTime() : null;
      // A version is superseded by the next chain step only when the next
      // version starts before the explicit window end (frozen resolution:
      // latest effective_from inside the window wins). When the explicit end
      // is earlier or equal, the window closes on its own.
      const supersededByNext =
        chainNext !== undefined &&
        (explicitEndMs === null ||
          chainNext.effectiveFrom.getTime() < explicitEndMs);
      const windowEnd = supersededByNext
        ? chainNext.effectiveFrom
        : explicitEndMs !== null
          ? row.effectiveTo
          : null;
      const effectiveFromLocal = localWallString(
        row.effectiveFrom,
        market.timezone,
      );
      let windowStatus: AdminRewardWindowStatus;
      if (archived) windowStatus = 'ARCHIVED';
      else if (supersededByNext) windowStatus = 'SUPERSEDED';
      else if (windowEnd !== null && now >= windowEnd.getTime())
        windowStatus = 'EXPIRED';
      else if (row.effectiveFrom.getTime() > now) windowStatus = 'SCHEDULED';
      else windowStatus = 'ACTIVE';

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        reward_rate: normalizeRateString(String(row.rewardRate)),
        cap_type: row.capType,
        cap_value: String(row.capValue),
        minimum_reward: String(row.minimumReward),
        package_reference: derivePackageReference(row.name),
        effective_from_utc: row.effectiveFrom.toISOString(),
        effective_from_local: effectiveFromLocal,
        effective_until_utc: windowEnd ? windowEnd.toISOString() : null,
        effective_until_local: windowEnd
          ? localWallString(windowEnd, market.timezone)
          : null,
        timezone: market.timezone,
        window_status: windowStatus,
        market_id: row.marketId,
        created_by: row.createdBy,
        created_at: row.createdAt.toISOString(),
      };
    });

    return {
      marketId,
      timezone: market.timezone,
      packages: Object.entries(REWARD_PACKAGE_REFERENCE_MAX_RATE).map(
        ([code, maxRatePerDay]) => ({ code, max_rate_per_day: maxRatePerDay }),
      ),
      rules,
    };
  }

  // ─── Orchestrated create (canonical owner command, D-050) ─────────

  /**
   * Schedule a new reward rule version for the selected market.
   *
   * The adapter performs ONLY Phase 7 orchestration: the §7.1 package-
   * maximum surface check, the market row lookup and the market-local date
   * → UTC instant conversion. EVERYTHING else is delegated to the secured
   * canonical owner command `AdminRewardService.createRuleVersion`, which
   * re-checks permission + identity, enforces the selected market
   * (`currentMarketId` from the RbacGuard market context), the exact
   * 0%–0.05%/day rate bounds/precision, the strictly-future market-local
   * 00:00 activation, the append-only strictly-increasing windows under its
   * transaction-safe advisory lock, the operation-scoped idempotency claim
   * (with the canonical payload hash), the mandatory reason and the atomic
   * owner audit — all in ONE transaction. The adapter performs no writes of
   * its own for the create path.
   */
  async createRule(
    actor: AdminRewardOpsActor,
    marketId: string,
    input: CreateRewardRuleDto,
    idempotencyKey: string,
  ): Promise<AdminRewardRuleCreateResponse> {
    // ── Phase 7 surface classification (pure exact-decimal comparison — no
    //    enforcement; the owner enforces the ceiling inside its command) ──
    // A rate above the §7.1 governance ceiling is always surfaced as
    // REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT — never as a package-max error —
    // because packages C–F share the ceiling as their maximum (pre-existing
    // S6B external contract, pinned by unit + integration tests).
    const rateScaled = scaledDecimal(input.rate);
    if (rateScaled > scaledDecimal(REWARD_RATE_GOVERNANCE_MAX)) {
      throw rewardRateExceedsGovernanceLimitError();
    }
    const packageMax =
      REWARD_PACKAGE_REFERENCE_MAX_RATE[input.package_reference] ?? '0';
    if (rateScaled > scaledDecimal(packageMax)) {
      throw rewardRateExceedsPackageMaxError(
        input.package_reference,
        packageMax,
      );
    }

    // ── Market row for the surface's market-local resolution (the owner
    //    re-validates the market server-side and returns the authoritative
    //    timezone/activation in its response) ────────────────────────────
    const market = await this.marketRow(marketId);
    if (!market) throw rewardMarketNotFoundError();

    // ── Convert the market-local DATE into the exact UTC activation instant
    //    using the canonical owner helper (multi-probe, DST-safe). The owner
    //    re-verifies the instant is a strictly-future market-local 00:00 and
    //    rejects same-day/backdated/DST-skipped activations with
    //    ADMIN_REWARD_ACTIVATION_NOT_FUTURE. ─────────────────────────────
    const effectiveFrom = resolveLocalMidnight(
      input.effective_date,
      market.timezone,
    );
    if (!effectiveFrom) throw rewardActivationNotFutureError();

    // ── Delegate the ENTIRE create to the canonical owner command ────────
    //    (D-050): RBAC re-check, identity, selected market, resource-market
    //    consistency, exact rate bounds/precision, future market-local 00:00,
    //    overlap + advisory lock, idempotency claim + payload hash, mandatory
    //    reason and the atomic owner audit all live inside
    //    `AdminRewardService.createRuleVersion`.
    let version: AdminRewardRuleVersionCreateResponse;
    try {
      version = await this.owner.createRuleVersion(this.ownerActor(actor), {
        name: `${REWARD_RULE_SURFACE_NAME_PREFIX}${input.package_reference}${REWARD_RULE_SURFACE_NAME_SUFFIX}`,
        description: input.description ?? undefined,
        effectiveFrom: effectiveFrom.toISOString(),
        rewardRate: input.rate,
        capType: 'NONE',
        capValue: '0',
        minimumReward: '0',
        marketId,
        reason: input.reason,
        idempotencyKey,
      });
    } catch (error) {
      // Surface the owner's ADMIN_REWARD_* rejections with the pre-existing
      // S6B external codes and HTTP semantics (order §8, scope item 3).
      if (error instanceof AdminRewardError) throw this.mapOwnerError(error);
      throw error;
    }

    // ── Adapter response: owner-resolved activation + surface fields ────
    //    (same external shape as before the rewiring — the api-client and
    //    Admin Web contract is unchanged).
    return {
      id: version.id,
      package_reference: input.package_reference,
      reward_rate: normalizeRateString(input.rate),
      effective_date: input.effective_date,
      effective_from_utc: version.effectiveFrom,
      effective_from_local: version.effectiveFromLocal,
      timezone: version.timezone,
      market_id: marketId,
      created_by: actor.adminUserId,
      created_at: version.createdAt,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async marketRow(
    marketId: string,
  ): Promise<{ id: string; timezone: string } | undefined> {
    const rows = await this.database.db
      .select({ id: markets.id, timezone: markets.timezone })
      .from(markets)
      .where(eq(markets.id, marketId))
      .limit(1);
    return rows[0];
  }

  /**
   * Adapt the surface actor into the owner actor, passing the server-owned
   * Current Admin Market (RbacGuard `adminMarketContext`) through so the
   * owner command applies the exact same selected-market enforcement as the
   * canonical route (D-050 contract).
   */
  private ownerActor(actor: AdminRewardOpsActor): AdminRewardActor {
    return {
      adminUserId: actor.adminUserId,
      ...(actor.requestId ? { requestId: actor.requestId } : {}),
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.currentMarketId
        ? { currentMarketId: actor.currentMarketId }
        : {}),
      ...(actor.marketContextVersion !== undefined
        ? { marketContextVersion: actor.marketContextVersion }
        : {}),
    };
  }

  /**
   * Translate the canonical owner's ADMIN_REWARD_* rejections into the
   * pre-existing S6B external codes. The HTTP status for each code is
   * assigned in the controller's error mapping; every code here maps to the
   * status the pre-rewiring surface used for the same violation
   * (order §8, scope item 3).
   */
  private mapOwnerError(error: AdminRewardError): AdminRewardOpsError {
    switch (error.code) {
      case 'ADMIN_REWARD_IDEMPOTENCY_CONFLICT':
        return rewardIdempotencyConflictError();
      case 'ADMIN_REWARD_EFFECTIVE_WINDOW_OVERLAP':
        return rewardEffectiveWindowOverlapError();
      case 'ADMIN_REWARD_ACTIVATION_NOT_FUTURE':
        return rewardActivationNotFutureError();
      case 'ADMIN_REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT':
        return rewardRateExceedsGovernanceLimitError();
      case 'ADMIN_REWARD_RATE_PRECISION_EXCEEDED':
        return rewardRatePrecisionExceededError();
      case 'ADMIN_REWARD_MARKET_NOT_FOUND':
        return rewardMarketNotFoundError();
      case 'ADMIN_REWARD_MARKET_SELECTION_REQUIRED':
        return rewardMarketSelectionRequiredError();
      case 'ADMIN_REWARD_MARKET_CONTEXT_MISMATCH':
        return rewardMarketContextMismatchError();
      case 'ADMIN_REWARD_MARKET_ACCESS_DENIED':
        return rewardMarketAccessDeniedError();
      case 'ADMIN_REWARD_PERMISSION_DENIED':
        return rewardPermissionDeniedError();
      case 'ADMIN_REWARD_IDEMPOTENCY_KEY_REQUIRED':
        return rewardIdempotencyKeyRequiredError();
      case 'ADMIN_REWARD_REASON_REQUIRED':
        return rewardReasonRequiredError();
      default:
        // Unknown owner codes (never thrown by the create command) propagate
        // as-is and surface as a 500 through the controller.
        throw error;
    }
  }
}

// ─── Exact-decimal helpers (string only — never float arithmetic) ──

/**
 * Scale a `%/day` decimal string to 10^6 integer units.
 *
 * Exported for direct unit testing of the §7.1 boundary math; not part of
 * the adapter's public surface. (The DTO grammar `^\d+(\.\d{1,6})?$`
 * guarantees the input shape before this helper runs.)
 */
export function scaledDecimal(value: string): bigint {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return (
    BigInt(whole) * BigInt(REWARD_RATE_SCALE) +
    BigInt(fraction.padEnd(6, '0') || '0')
  );
}

/**
 * Derive the §7.1 package reference from the deterministic surface name.
 *
 * Exported for direct unit testing; not part of the adapter's public
 * surface.
 */
export function derivePackageReference(name: string): string | null {
  if (!name.startsWith(REWARD_RULE_SURFACE_NAME_PREFIX)) return null;
  if (!name.endsWith(REWARD_RULE_SURFACE_NAME_SUFFIX)) return null;
  const code = name.slice(
    REWARD_RULE_SURFACE_NAME_PREFIX.length,
    name.length - REWARD_RULE_SURFACE_NAME_SUFFIX.length,
  );
  return /^[A-F]$/u.test(code) ? code : null;
}

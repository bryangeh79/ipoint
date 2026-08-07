import { Inject, Injectable } from '@nestjs/common';
import {
  serviceFeeProfiles,
  serviceFeeVersions,
  specialPercentages,
} from '@ipoint/database';
import { asc, desc, eq, isNull, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { PackageService } from '../merchant/package.service.js';
import type { CreateSpecialPercentageDto } from './admin-package-ops.dto.js';
import {
  specialPercentageCreateFailedError,
  specialPercentageIdempotencyConflictError,
  specialPercentageIdempotencyKeyRequiredError,
  specialPercentageMarketAccessDeniedError,
  specialPercentageMarketContextMismatchError,
  specialPercentageMarketNotFoundError,
  specialPercentageMarketSelectionRequiredError,
  specialPercentagePermissionDeniedError,
  specialPercentageReasonRequiredError,
} from './admin-package-ops.errors.js';
import { AdminPackageOpsError } from './admin-package-ops.types.js';
import type {
  AdminPackageCatalogDto,
  AdminPackageOpsActor,
  AdminPackageOpsErrorCode,
  AdminPackageProfileDto,
  AdminPackageVersionDto,
  AdminSpecialPercentageCreateResponse,
  AdminSpecialPercentageDto,
  AdminSpecialPercentageListDto,
} from './admin-package-ops.types.js';

/**
 * P7-S6A Admin Package Operations adapter service.
 *
 * Read projections over frozen Phase 1 owner-owned rows (frozen contract
 * §7.3) plus ONE orchestrated create: the special-percentage create is
 * delegated ENTIRELY to the D-051-secured Phase 1 owner command
 * (`PackageService.createSpecialPercentage`) — RBAC re-check, selected-
 * market enforcement, mandatory reason (trim/≤500, durable on the row),
 * operation-scoped idempotency with the canonical payload hash, the
 * atomic immutable audit and the single `special_percentages` insert all
 * live inside the owner. The standard-package catalog and the special-
 * percentage list are assembled here only because the Phase 1 owner
 * exposes no admin read surface for them.
 *
 * The adapter performs NO owner-level control of its own: no RBAC check,
 * no market authorization, no idempotency claim/mechanism writes, no
 * payload hash, no audit creation, no advisory lock and no direct table
 * write. It only builds the server actor (from the authenticated session
 * + RbacGuard `adminMarketContext`) and maps the owner rejections onto
 * the S6A external contract (owner codes preserved verbatim).
 *
 * Audit-of-view: the special-percentage list is a privileged read (the
 * `merchant.special_package.manage` permission is seeded to SUPER_ADMIN
 * only, with step-up required), so every list view writes a privileged
 * audit record through the canonical AuditService. The standard catalog is
 * an ordinary operational read (`merchant.package.view`, all roles) and
 * is not audited, matching the merchant-read precedent.
 */
@Injectable()
export class AdminPackageOpsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PackageService) private readonly owner: PackageService,
  ) {}

  /** Selected-market standard package catalog (profiles + versions). */
  async catalog(marketId: string): Promise<AdminPackageCatalogDto> {
    // The seeded A–F standard packages and their baseline versions are
    // market-agnostic (market_id IS NULL); per-market versions are created
    // through the Phase 1 owner command with an explicit market. Both are
    // shown in the selected-market catalog.
    const profiles = await this.database.db
      .select({
        id: serviceFeeProfiles.id,
        code: serviceFeeProfiles.code,
        name: serviceFeeProfiles.name,
        description: serviceFeeProfiles.description,
      })
      .from(serviceFeeProfiles)
      .where(
        or(
          eq(serviceFeeProfiles.marketId, marketId),
          isNull(serviceFeeProfiles.marketId),
        ),
      )
      .orderBy(asc(serviceFeeProfiles.code), asc(serviceFeeProfiles.createdAt));

    const versions = await this.database.db
      .select({
        id: serviceFeeVersions.id,
        profile_id: serviceFeeVersions.serviceFeeProfileId,
        rate: serviceFeeVersions.rate,
        status: serviceFeeVersions.status,
        effective_from: serviceFeeVersions.effectiveFrom,
        effective_to: serviceFeeVersions.effectiveTo,
        created_at: serviceFeeVersions.createdAt,
      })
      .from(serviceFeeVersions)
      .where(
        or(
          eq(serviceFeeVersions.marketId, marketId),
          isNull(serviceFeeVersions.marketId),
        ),
      )
      .orderBy(desc(serviceFeeVersions.createdAt));

    const versionsByProfile = new Map<string, AdminPackageVersionDto[]>();
    for (const version of versions) {
      const bucket = versionsByProfile.get(version.profile_id) ?? [];
      bucket.push({
        id: version.id,
        profile_id: version.profile_id,
        rate: String(version.rate),
        status: version.status,
        effective_from: toIsoString(version.effective_from),
        effective_to:
          version.effective_to === null
            ? null
            : toIsoString(version.effective_to),
        created_at: toIsoString(version.created_at),
      });
      versionsByProfile.set(version.profile_id, bucket);
    }

    const items: AdminPackageProfileDto[] = profiles.map((profile) => ({
      id: profile.id,
      code: profile.code,
      name: profile.name,
      description: profile.description,
      versions: versionsByProfile.get(profile.id) ?? [],
    }));

    return { marketId, items };
  }

  /**
   * Selected-market special-percentage list (privileged, audited read).
   * Every view writes an audit-of-view record; access is additionally gated
   * server-side by the RbacGuard (SUPER_ADMIN-only permission + step-up).
   */
  async specialPercentages(
    marketId: string,
    actor: AdminPackageOpsActor,
  ): Promise<AdminSpecialPercentageListDto> {
    const rows = await this.database.db
      .select({
        id: specialPercentages.id,
        rate: specialPercentages.rate,
        description: specialPercentages.description,
        created_by_admin_user_id: specialPercentages.createdByAdminUserId,
        created_at: specialPercentages.createdAt,
      })
      .from(specialPercentages)
      .where(eq(specialPercentages.marketId, marketId))
      .orderBy(desc(specialPercentages.createdAt));

    const items: AdminSpecialPercentageDto[] = rows.map((row) => ({
      id: row.id,
      rate: String(row.rate),
      description: row.description,
      created_by_admin_user_id: row.created_by_admin_user_id,
      created_at: toIsoString(row.created_at),
    }));

    await this.audit.recordPrivilegedAction({
      actor: { type: 'ADMIN_USER', id: actor.adminUserId },
      action: 'ADMIN_SPECIAL_PERCENTAGE_LIST_VIEWED',
      entity: { type: 'SPECIAL_PERCENTAGE', id: marketId },
      marketId,
      result: 'SUCCESS',
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      summary: 'Administrator viewed the selected-market special percentages.',
    });

    return { marketId, items };
  }

  /**
   * Create a special percentage (frozen contract §7.3, SUPER_ADMIN-only
   * permission, step-up required). Phase 7 orchestration ONLY: the adapter
   * forwards the server actor (adminUserId from the authenticated session,
   * currentMarketId from the RbacGuard `adminMarketContext` — the client
   * can neither supply nor override either), the validated DTO and the
   * mandatory Idempotency-Key to the D-051-secured owner command. The
   * owner performs every control and returns the owner-resolved result;
   * the exact stored rate and the durable reason come from the immutable
   * owner row, never derived by the adapter.
   */
  async createSpecialPercentage(
    actor: AdminPackageOpsActor,
    marketId: string,
    input: CreateSpecialPercentageDto,
    idempotencyKey: string,
  ): Promise<AdminSpecialPercentageCreateResponse> {
    let created: Awaited<ReturnType<PackageService['createSpecialPercentage']>>;
    try {
      created = await this.owner.createSpecialPercentage(
        marketId,
        this.ownerActor(actor),
        input,
        idempotencyKey,
      );
    } catch (error) {
      if (error instanceof AdminPackageOpsError) throw error;
      if (isOwnerSpecialPercentageError(error)) {
        throw this.mapOwnerError(error.code);
      }
      throw error;
    }
    // Adapter create response mapping: the owner-resolved values verbatim,
    // renamed onto the S6A surface field style (snake_case, matching the
    // S6A read DTOs). No value is derived or re-rounded by the adapter.
    return {
      id: created.id,
      rate: created.rate,
      description: created.description,
      reason: created.reason,
      marketId: created.marketId,
      market: created.market,
      created_by: created.createdBy,
      created_at: created.createdAt,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  /**
   * Forward the adapter actor into the owner's `SpecialPercentageAdminActor`
   * shape. Only server-resolved fields are forwarded — the client can never
   * influence the actor object.
   */
  private ownerActor(
    actor: AdminPackageOpsActor,
  ): Parameters<PackageService['createSpecialPercentage']>[1] {
    return {
      adminUserId: actor.adminUserId,
      ...(actor.requestId !== undefined ? { requestId: actor.requestId } : {}),
      ...(actor.ipAddress !== undefined ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.currentMarketId !== undefined
        ? { currentMarketId: actor.currentMarketId }
        : {}),
      ...(actor.marketContextVersion !== undefined
        ? { marketContextVersion: actor.marketContextVersion }
        : {}),
    };
  }

  /**
   * Translate the D-051 owner rejections onto the S6A external contract.
   * Owner codes are preserved verbatim (the S6A surface exposes the
   * canonical `SPECIAL_PERCENTAGE_*` contract); the HTTP status for each
   * code is assigned in the controller's error mapping. Unknown owner
   * codes propagate as-is and surface as 500 — no error is swallowed
   * into a 2xx.
   */
  private mapOwnerError(code: string): AdminPackageOpsError {
    switch (code) {
      case 'SPECIAL_PERCENTAGE_PERMISSION_DENIED':
        return specialPercentagePermissionDeniedError();
      case 'SPECIAL_PERCENTAGE_MARKET_SELECTION_REQUIRED':
        return specialPercentageMarketSelectionRequiredError();
      case 'SPECIAL_PERCENTAGE_MARKET_CONTEXT_MISMATCH':
        return specialPercentageMarketContextMismatchError();
      case 'SPECIAL_PERCENTAGE_MARKET_NOT_FOUND':
        return specialPercentageMarketNotFoundError();
      case 'SPECIAL_PERCENTAGE_MARKET_ACCESS_DENIED':
        return specialPercentageMarketAccessDeniedError();
      case 'SPECIAL_PERCENTAGE_REASON_REQUIRED':
        return specialPercentageReasonRequiredError();
      case 'SPECIAL_PERCENTAGE_IDEMPOTENCY_KEY_REQUIRED':
        return specialPercentageIdempotencyKeyRequiredError();
      case 'SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT':
        return specialPercentageIdempotencyConflictError();
      case 'SPECIAL_PERCENTAGE_CREATE_FAILED':
        return specialPercentageCreateFailedError();
      default:
        // Unknown owner code — re-throw as-is (controller → 500).
        return new AdminPackageOpsError(
          code as AdminPackageOpsErrorCode,
          `The owner rejected the request with an unknown code: ${code}`,
        );
    }
  }
}

/** Narrow type guard for the D-051 owner create rejections. */
function isOwnerSpecialPercentageError(
  error: unknown,
): error is { code: string } {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('SPECIAL_PERCENTAGE_');
}

function toIsoString(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

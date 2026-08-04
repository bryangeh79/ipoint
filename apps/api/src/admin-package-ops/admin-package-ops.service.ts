import { Inject, Injectable } from '@nestjs/common';
import {
  serviceFeeProfiles,
  serviceFeeVersions,
  specialPercentages,
} from '@ipoint/database';
import { asc, desc, eq, isNull, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type {
  AdminPackageCatalogDto,
  AdminPackageOpsActor,
  AdminPackageProfileDto,
  AdminPackageVersionDto,
  AdminSpecialPercentageDto,
  AdminSpecialPercentageListDto,
} from './admin-package-ops.types.js';

/**
 * P7-S6A Admin Package Operations adapter service.
 *
 * Read-only projections over frozen Phase 1 owner-owned rows (frozen
 * contract §7.3). The standard-package catalog and the special-percentage
 * list are assembled here only because the Phase 1 owner exposes no admin
 * read surface for them; every write stays on the owner commands. No owner
 * business logic is duplicated: lifecycle state, assignability, overlap
 * rules and idempotency remain the owner's; this service only shapes stored
 * rows and always returns exact decimal strings.
 *
 * Audit-of-view: the special-percentage list is a privileged read (the
 * `merchant.special_package.manage` permission is seeded to SUPER_ADMIN
 * only, with step-up required), so every list view writes a privileged
 * audit record through the canonical AuditService. The standard catalog is
 * an ordinary operational read (`merchant.package.view`, all roles) and is
 * not audited, matching the merchant-read precedent.
 */
@Injectable()
export class AdminPackageOpsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
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
}

function toIsoString(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

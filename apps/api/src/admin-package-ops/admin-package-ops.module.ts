import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { PackageService } from '../merchant/package.service.js';
import { AdminPackageOpsController } from './admin-package-ops.controller.js';
import { AdminPackageOpsService } from './admin-package-ops.service.js';

/**
 * P7-S6A Admin Package Operations adapter module (Phase 7, new).
 *
 * Selected-market read projections over the frozen Phase 1 package owner
 * rows plus ONE orchestrated create: the special-percentage create is
 * delegated ENTIRELY to the D-051-secured Phase 1 owner command
 * (`PackageService.createSpecialPercentage`). No frozen Phase 1 owner file
 * is modified and no owner command is duplicated; all other configuration
 * writes stay on the Phase 1 owner routes
 * (`admin/markets/.../packages/...`,
 * `admin/markets/.../merchants/:branchId/packages/...`).
 *
 * OWNER-GAP CLOSED (D-051): the frozen contract §7.3 owner gap is
 * resolved — the secured owner command now enforces the mandatory reason
 * (trimmed, 1..500 chars, durable on the `special_percentages` row via
 * migration 0033 AND in the atomic immutable audit),
 * `merchant.special_package.manage` RBAC re-check, selected-market
 * enforcement, operation-scoped idempotency (`package.special.owner.create`
 * scope + canonical payload hash) and the atomic audit; the special-
 * percentage CREATE surface is therefore exposed on this adapter and the
 * write surface is no longer blocked.
 *
 * DI note: the canonical owner module (`MerchantModule`) provides
 * `PackageService` but does not export it, and `apps/api/src/merchant/**`
 * is frozen (D-051), so this module registers `PackageService` itself.
 * The owner class is stateless — every effect lives in the shared
 * `DatabaseService`/`AuditService`/`RbacService` singletons, so the
 * instance here is behaviorally identical to the canonical one and the
 * single write path still runs inside the owner command.
 */
@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule],
  controllers: [AdminPackageOpsController],
  providers: [AdminPackageOpsService, PackageService],
  exports: [AdminPackageOpsService],
})
export class AdminPackageOpsModule {}

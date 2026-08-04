import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { AdminPackageOpsController } from './admin-package-ops.controller.js';
import { AdminPackageOpsService } from './admin-package-ops.service.js';

/**
 * P7-S6A Admin Package Operations adapter module (Phase 7, new).
 *
 * Read-only selected-market projections over the frozen Phase 1 package
 * owner rows. No frozen Phase 1 owner file is modified and no owner command
 * is duplicated; all configuration writes stay on the Phase 1 owner routes
 * (`admin/markets/.../packages/...`,
 * `admin/markets/.../merchants/:branchId/packages/...`).
 *
 * OWNER-GAP RECORD (frozen contract §7.3): "Only Super Admin with the
 * dedicated permission may create/activate a special percentage; reason and
 * immutable audit are mandatory." The Phase 1 owner already enforces the
 * dedicated permission server-side (`merchant.special_package.manage` is
 * seeded to SUPER_ADMIN only with step-up required) and audits the write,
 * but its `createSpecialPercentage` command/DTO accept only `rate` +
 * `description` — there is no mandatory `reason` field, no `reason` column
 * on `special_percentages`, and the owner's audit record for
 * SPECIAL_PERCENTAGE_CREATED carries no reason. Because Phase 7 cannot
 * record the reason atomically with the owner's domain effect (frozen
 * contract §14), the special-percentage CREATE/ACTIVATE capability is NOT
 * exposed on this surface and is reported to OpenClaw as an owner gap; the
 * UI shows the blocked state. The read projection remains available to the
 * SUPER_ADMIN-only permission with audit-of-view.
 */
@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule],
  controllers: [AdminPackageOpsController],
  providers: [AdminPackageOpsService],
  exports: [AdminPackageOpsService],
})
export class AdminPackageOpsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { RedemptionModule } from '../redemption/redemption.module.js';
import { AdminRedemptionFulfilmentOpsController } from './admin-redemption-fulfilment-ops.controller.js';
import { AdminRedemptionFulfilmentOpsService } from './admin-redemption-fulfilment-ops.service.js';

/**
 * P7-S8 Admin Redemption Operations adapter module (Phase 7, new).
 *
 * Phase 7 read projection + orchestration over the FROZEN Phase 6
 * redemption owner (`RedemptionFulfilmentService` + `RedemptionRefundService`,
 * SEC-02). No frozen redemption file is modified and no owner command is
 * duplicated: suspend/resume/retry delegate 1:1 to the owner commands with
 * the server Current Admin Market resource check (P6-R2 pattern); the six
 * fulfilment queues and the refund queue/detail/status-history views are
 * bounded market-scoped read projections with the explicit
 * rate-configuration capability state.
 *
 * Market enforcement is the canonical RbacGuard (all permissions are
 * marketScoped): the URL market must equal the server-owned Current Admin
 * Market and the actor must hold the market grant.
 */
@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule, RedemptionModule],
  controllers: [AdminRedemptionFulfilmentOpsController],
  providers: [AdminRedemptionFulfilmentOpsService],
  exports: [AdminRedemptionFulfilmentOpsService],
})
export class AdminRedemptionFulfilmentOpsModule {}

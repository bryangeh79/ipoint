import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { RedemptionModule } from '../redemption/redemption.module.js';
import { AdminRedemptionOpsController } from './admin-redemption-ops.controller.js';
import { AdminRedemptionOpsService } from './admin-redemption-ops.service.js';

/**
 * P7-S6C Admin Redemption Rate Configuration adapter module (Phase 7,
 * new; rewired to the D-053 secured owner, order §15).
 *
 * Phase 7 read projection + orchestrated create/cancel over the secured
 * Phase 6 redemption owner (frozen contract §7.2). No frozen Phase 1/3/5/6
 * owner file is modified and no owner command is duplicated: the single
 * `redemption_rate_versions` insert and the append-only cancellation
 * events delegate to the secured owner commands
 * (`RedemptionService.createRateVersion` / `cancelRateVersion`) with the
 * mandatory reason, the client Idempotency-Key and the server Current
 * Admin Market (RbacGuard `adminMarketContext`).
 *
 * The adapter adds only legitimate Phase 7 orchestration/read/UI
 * behavior: the read projection (approved per-market bounds resolved from
 * the canonical `redemption_rate_market_rules` table — the same source
 * the owner enforces — or the explicit blocked state, full technical
 * precision, market-local + resolved UTC windows incl. CANCELLED), the
 * market-local date → UTC instant conversion, and the create/cancel
 * response + error mapping. It performs no advisory lock, no idempotency
 * claim/mechanism writes and no privileged audit of its own — those are
 * owned by the canonical owner commands (D-053 §10/§11).
 *
 * Market enforcement is the canonical RbacGuard
 * (`redemption.rate.read` / `redemption.rate.manage` are marketScoped):
 * the URL market must equal the server-owned Current Admin Market and the
 * actor must hold the grant.
 */
@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule, RedemptionModule],
  controllers: [AdminRedemptionOpsController],
  providers: [AdminRedemptionOpsService],
  exports: [AdminRedemptionOpsService],
})
export class AdminRedemptionOpsModule {}

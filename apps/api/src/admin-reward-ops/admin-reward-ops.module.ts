import { Module } from '@nestjs/common';
import { AdminRewardModule } from '../admin-reward/admin-reward.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { AdminRewardOpsController } from './admin-reward-ops.controller.js';
import { AdminRewardOpsService } from './admin-reward-ops.service.js';

/**
 * P7-S6B Admin Reward Configuration adapter module (Phase 7, new).
 *
 * Phase 7 read projection + orchestration over the canonical Phase 3
 * reward owner (D-050). No frozen Phase 1/3/5/6 owner file is modified:
 * the create path delegates the ENTIRE command (rate bounds/precision,
 * future market-local 00:00 activation, overlap + advisory lock,
 * operation-scoped idempotency, mandatory reason, selected-market
 * enforcement, atomic owner audit) to the secured
 * `AdminRewardService.createRuleVersion` owner command (D-050), passing
 * `reason`, `idempotencyKey` and the server Current Admin Market
 * (RbacGuard `adminMarketContext`).
 *
 * The adapter adds only legitimate Phase 7 orchestration/read/UI
 * behavior: the §7.1 package-reference surface (A–F maxima the owner does
 * not know), the market-local date → UTC instant conversion, the read
 * projection, and the create response mapping. It performs no advisory
 * lock, no idempotency claim/mechanism writes and no privileged audit of
 * its own for the create path — those are owned by the canonical owner
 * command (order §8).
 *
 * Market enforcement is the canonical RbacGuard (`reward.rule.read` /
 * `reward.rule.schedule` are marketScoped): the URL market must equal the
 * server-owned Current Admin Market and the actor must hold the grant.
 */
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PlatformAccessModule,
    AdminRewardModule,
  ],
  controllers: [AdminRewardOpsController],
  providers: [AdminRewardOpsService],
  exports: [AdminRewardOpsService],
})
export class AdminRewardOpsModule {}

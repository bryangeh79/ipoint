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
 * Phase 7 read projection + orchestration over the frozen Phase 3 reward
 * owner (frozen contract §7.1). No frozen Phase 1/3/5/6 owner file is
 * modified and no owner command is duplicated: the single
 * `reward_rule_versions` insert delegates to the frozen
 * `AdminRewardService.createRuleVersion` owner command unchanged.
 *
 * The adapter adds the §7.1 configuration surface the frozen owner does not
 * provide: exact `%/day` rate range/precision/package-maxima validation,
 * future market-local 00:00 activation resolution, no-overlap chain
 * serialization (session-level advisory lock, frozen contract §14),
 * exact idempotency (Idempotency-Key + canonical payload hash claimed in
 * the shared idempotency mechanism table), and mandatory reason + privileged
 * audit (§7/§15). The owner's own insert + audit stay atomic inside the
 * frozen command; the Phase 7 audit record carries the operator's reason
 * and the idempotency correlation.
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

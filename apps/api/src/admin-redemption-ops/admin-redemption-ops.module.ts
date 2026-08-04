import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { RedemptionModule } from '../redemption/redemption.module.js';
import { AdminRedemptionOpsController } from './admin-redemption-ops.controller.js';
import { AdminRedemptionOpsService } from './admin-redemption-ops.service.js';
import {
  REDEMPTION_RATE_MARKET_RULES,
  REDEMPTION_RATE_RULES_PROVIDER,
} from './admin-redemption-ops.types.js';

/**
 * P7-S6C Admin Redemption Rate Configuration adapter module (Phase 7, new).
 *
 * Phase 7 read projection + orchestration over the frozen Phase 6
 * redemption owner (frozen contract §7.2). No frozen Phase 1/3/5/6 owner
 * file is modified and no owner command is duplicated: the single
 * `redemption_rate_versions` insert delegates to the frozen
 * `RedemptionService.createRateVersion` owner command unchanged.
 *
 * The adapter adds the §7.2 configuration surface the frozen owner does
 * not provide: per-market approved bounds (Malaysia initial RM1.00 / min
 * RM0.50 / max RM2.00 per 1 iPoint; every other market stays blocked with
 * no fallback), ≤10-decimal technical precision validation, future
 * market-local 00:00 activation resolution, no-overlap chain serialization
 * (session-level advisory lock, frozen contract §14), exact idempotency
 * (Idempotency-Key + canonical payload hash claimed in the shared
 * idempotency mechanism table), and mandatory reason + privileged audit
 * (§7/§15). Quotes and orders retain their original rate version (frozen
 * OD-22) — this surface never reprices history.
 *
 * Market enforcement is the canonical RbacGuard
 * (`redemption.rate.read` / `redemption.rate.manage` are marketScoped):
 * the URL market must equal the server-owned Current Admin Market and the
 * actor must hold the grant.
 */
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PlatformAccessModule,
    RedemptionModule,
  ],
  controllers: [AdminRedemptionOpsController],
  providers: [
    AdminRedemptionOpsService,
    {
      provide: REDEMPTION_RATE_RULES_PROVIDER,
      useValue: REDEMPTION_RATE_MARKET_RULES,
    },
  ],
  exports: [AdminRedemptionOpsService],
})
export class AdminRedemptionOpsModule {}

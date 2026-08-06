import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommissionModule } from '../commission/commission.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { AdminCommissionOpsController } from './admin-commission-ops.controller.js';
import { AdminCommissionOpsService } from './admin-commission-ops.service.js';

/**
 * P7-S6D Admin Commission Rate Configuration adapter module (Phase 7,
 * new; D-054 §16 / D-055 §8).
 *
 * Phase 7 read projection + orchestrated create over the secured Phase 5
 * commission-rate owner (`RateManagementService.createRateVersion`,
 * D-054). No frozen Phase 5 owner file is modified and no owner command
 * is duplicated: the single `commission_rate_version` insert, the
 * idempotency claim and the privileged audit all delegate to the secured
 * owner command with the mandatory reason, the client Idempotency-Key and
 * the server Current Admin Market (RbacGuard `adminMarketContext`).
 *
 * The adapter adds only legitimate Phase 7 orchestration/read/UI
 * behavior: the read projection (frozen taxonomy for the UI, current +
 * scheduled + history per (commission_type, generation) with exact rates,
 * market-local + resolved UTC windows, the explicit blocked state for
 * non-ACTIVE markets), the market-local date → UTC instant conversion,
 * and the create response + error mapping. It performs no advisory lock,
 * no idempotency claim/mechanism writes and no privileged audit of its
 * own — those are owned by the canonical owner command (D-054 §10/§11).
 *
 * Market enforcement is the canonical RbacGuard
 * (`commission.rate.read` / `commission.rate.manage` are marketScoped):
 * the URL market must equal the server-owned Current Admin Market and the
 * actor must hold the grant.
 */
@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule, CommissionModule],
  controllers: [AdminCommissionOpsController],
  providers: [AdminCommissionOpsService],
  exports: [AdminCommissionOpsService],
})
export class AdminCommissionOpsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { AdminIpointAdjustOpsController } from './admin-ipoint-adjust-ops.controller.js';
import { AdminIpointAdjustOpsService } from './admin-ipoint-adjust-ops.service.js';

/**
 * P7-S7B Admin iPoint Adjustment Operations adapter module (Phase 7, new;
 * SEC-01 §6 / P7-S1 §17).
 *
 * Phase 7 read projections + orchestration over the FROZEN SEC-01 owner
 * (`WalletAdjustmentOwnerService`). No frozen wallet-domain file is
 * modified and no owner command is duplicated: every create/submit/
 * decide/execute delegates to the frozen owner command with the client
 * Idempotency-Key, the server Current Admin Market (RbacGuard
 * `adminMarketContext`) and the step-up grants consumed by the canonical
 * RbacGuard (catalog `stepUpRequired`).
 *
 * The adapter adds only legitimate Phase 7 orchestration/read/UI
 * behavior: the Finance queue projection, the request detail with
 * immutable decision history, the maker-form support projection (market
 * rules + reason-code catalog, explicit blocked state for unconfigured
 * markets), the wallet/member lookup for the maker screen, and the
 * owner-error → HTTP mapping (SEC-01 §6.4).
 *
 * Market enforcement is the canonical RbacGuard (all permissions are
 * marketScoped): the URL market must equal the server-owned Current Admin
 * Market and the actor must hold the grant.
 */
@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule, WalletModule],
  controllers: [AdminIpointAdjustOpsController],
  providers: [AdminIpointAdjustOpsService],
  exports: [AdminIpointAdjustOpsService],
})
export class AdminIpointAdjustOpsModule {}

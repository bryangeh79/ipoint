import { Module } from '@nestjs/common';
import { AdminKycModule } from '../admin-kyc/admin-kyc.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MerchantModule } from '../merchant/merchant.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { AdminKycOpsController } from './admin-kyc-ops.controller.js';
import { AdminKycOpsService } from './admin-kyc-ops.service.js';

/**
 * P7-S5C Admin KYC Operations adapter module (Phase 7).
 *
 * Wraps the frozen Phase 2 member KYC owner (AdminKycModule) and the frozen
 * Phase 1 merchant KYC owner (MerchantModule) with the selected-market
 * contract and the frozen-contract §6.4 evidence rules. Both owner modules
 * are imported as-is and never modified; this module only adds the adapter
 * controller/service.
 */
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PlatformAccessModule,
    AdminKycModule,
    MerchantModule,
  ],
  controllers: [AdminKycOpsController],
  providers: [AdminKycOpsService],
  exports: [AdminKycOpsService],
})
export class AdminKycOpsModule {}

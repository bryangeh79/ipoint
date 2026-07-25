import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  AgentUpgradeCommissionService,
  MemberConsumptionCommissionService,
  MerchantRecruitmentCommissionService,
} from '../domain/commission/index.js';
import { CommissionController } from '../controllers/commission.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CommissionController],
  providers: [
    AgentUpgradeCommissionService,
    MemberConsumptionCommissionService,
    MerchantRecruitmentCommissionService,
  ],
  exports: [
    AgentUpgradeCommissionService,
    MemberConsumptionCommissionService,
    MerchantRecruitmentCommissionService,
  ],
})
export class CommissionModule {}

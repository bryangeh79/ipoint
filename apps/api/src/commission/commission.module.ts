import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AgentUpgradeCommissionService } from '../domain/commission/agent-upgrade.service.js';
import { MemberConsumptionCommissionService } from '../domain/commission/member-consumption.service.js';
import { MerchantRecruitmentCommissionService } from '../domain/commission/merchant-recruitment.service.js';
import { CommissionQueryService } from '../domain/commission/query.service.js';
import { AdjustmentService } from '../domain/commission/adjustment.service.js';
import { RateManagementService } from '../domain/commission/rate.service.js';
import { AgentCommissionController } from '../controllers/agent-commission.controller.js';
import { AdminCommissionController } from '../controllers/admin-commission.controller.js';
import { CommissionController } from '../controllers/commission.controller.js';
import { AdminRateController } from '../controllers/admin-rate.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    CommissionController,
    AgentCommissionController,
    AdminCommissionController,
    AdminRateController,
  ],
  providers: [
    AgentUpgradeCommissionService,
    MemberConsumptionCommissionService,
    MerchantRecruitmentCommissionService,
    CommissionQueryService,
    AdjustmentService,
    RateManagementService,
  ],
  exports: [
    AgentUpgradeCommissionService,
    MemberConsumptionCommissionService,
    MerchantRecruitmentCommissionService,
    CommissionQueryService,
    AdjustmentService,
    RateManagementService,
  ],
})
export class CommissionModule {}

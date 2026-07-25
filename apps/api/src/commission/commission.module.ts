import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AgentUpgradeCommissionService } from '../domain/commission/agent-upgrade.service.js';
import { MemberConsumptionCommissionService } from '../domain/commission/member-consumption.service.js';
import { MerchantRecruitmentCommissionService } from '../domain/commission/merchant-recruitment.service.js';
import { CommissionQueryService } from '../domain/commission/query.service.js';
import { CommissionAdjustmentService } from '../domain/commission/adjustment.service.js';
import { CommissionRateService } from '../domain/commission/rate.service.js';
import { AgentCommissionController } from '../controllers/agent-commission.controller.js';
import { AdminCommissionController } from '../controllers/admin-commission.controller.js';
import { CommissionController } from '../controllers/commission.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    CommissionController,
    AgentCommissionController,
    AdminCommissionController,
  ],
  providers: [
    AgentUpgradeCommissionService,
    MemberConsumptionCommissionService,
    MerchantRecruitmentCommissionService,
    CommissionQueryService,
    CommissionAdjustmentService,
    CommissionRateService,
  ],
  exports: [
    AgentUpgradeCommissionService,
    MemberConsumptionCommissionService,
    MerchantRecruitmentCommissionService,
    CommissionQueryService,
    CommissionAdjustmentService,
    CommissionRateService,
  ],
})
export class CommissionModule {}

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { AuthenticatedMember } from '../auth/authenticated-member.decorator.js';
import { AuthenticatedAdmin } from '../auth/authenticated-admin.decorator.js';
import { AgentUpgradeCommissionService } from '../domain/commission/agent-upgrade.service.js';
import { MemberConsumptionCommissionService } from '../domain/commission/member-consumption.service.js';
import { MerchantRecruitmentCommissionService } from '../domain/commission/merchant-recruitment.service.js';

@Controller('api/v1/commission')
export class CommissionController {
  constructor(
    private readonly agentUpgrade: AgentUpgradeCommissionService,
    private readonly memberConsumption: MemberConsumptionCommissionService,
    private readonly merchantRecruitment: MerchantRecruitmentCommissionService,
  ) {}

  @Post('calculate')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async calculate(
    @Body() body: { sourceType: string; sourceReference: string },
  ) {
    const { sourceType, sourceReference } = body;
    switch (sourceType) {
      case 'AGENT_ACTIVATION':
        return this.agentUpgrade.processAgentUpgrade(sourceReference);
      case 'MEMBER_CONSUMPTION':
        return this.memberConsumption.processMemberConsumption(sourceReference);
      case 'MERCHANT_TRANSACTION':
        return this.merchantRecruitment.processMerchantRecruitment(
          sourceReference,
        );
      default:
        return { error: `Unknown source type: ${sourceType}` };
    }
  }

  @Get('ledger')
  @UseGuards(AuthGuard)
  async getLedger(@AuthenticatedMember() memberId: string) {
    return { memberId, message: 'Ledger query endpoint' };
  }
}

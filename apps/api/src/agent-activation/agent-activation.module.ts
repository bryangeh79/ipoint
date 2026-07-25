import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { CommissionModule } from '../commission/commission.module.js';
import { AgentActivationService } from '../domain/agent-activation/service.js';
import { AgentActivationController } from '../controllers/agent-activation.controller.js';
import { AdminAgentActivationController } from '../controllers/admin-agent-activation.controller.js';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule, CommissionModule],
  controllers: [AgentActivationController, AdminAgentActivationController],
  providers: [AgentActivationService],
  exports: [AgentActivationService],
})
export class AgentActivationModule {}

import { Module } from '@nestjs/common';
import { AgentActivationModule } from '../agent-activation/agent-activation.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { AdminAgentOpsController } from './admin-agent-ops.controller.js';
import { AdminAgentOpsService } from './admin-agent-ops.service.js';

/**
 * P7-S8 Admin Agent Operations adapter module (Phase 7, new).
 *
 * Phase 7 read projection + orchestration over the FROZEN Phase 5 agent
 * activation owner (`AgentActivationService`). No frozen Phase 5 file is
 * modified and no owner command is duplicated: every status operation
 * (suspend/reactivate/deactivate) delegates 1:1 to the owner command with
 * the server Current Admin Market (resolved to the market code by the
 * RbacGuard context) and the executing admin identity (P5-R1 actor
 * attribution). The adapter adds only legitimate Phase 7 read/UI behavior:
 * the market-scoped agent list/search/detail projection, the append-only
 * status-history view and the explicit capability state
 * (`CONFIGURED` / `AGENT_FEE_NOT_CONFIGURED`, no fallback fee).
 *
 * Market enforcement is the canonical RbacGuard (all permissions are
 * marketScoped): the URL market must equal the server-owned Current Admin
 * Market and the actor must hold the market grant.
 */
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PlatformAccessModule,
    AgentActivationModule,
  ],
  controllers: [AdminAgentOpsController],
  providers: [AdminAgentOpsService],
  exports: [AdminAgentOpsService],
})
export class AdminAgentOpsModule {}

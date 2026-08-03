import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MerchantModule } from '../merchant/merchant.module.js';
import { McpService } from '../merchant/mcp.service.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { AdminMerchantOpsController } from './admin-merchant-ops.controller.js';
import { AdminMerchantOpsService } from './admin-merchant-ops.service.js';

/**
 * P7-S5B Admin Merchant Operations adapter module (Phase 7, new).
 *
 * No frozen Phase 1 owner file is modified. The frozen MerchantModule exports
 * only MerchantService, so the adapter re-registers the owner McpService
 * class as a provider in this module's scope to delegate MCP read surfaces
 * (summary / reconcile / adminLedger). Nest resolves its dependencies
 * (DatabaseService, AuditService, MerchantService) from the imported
 * modules' exports; the second McpService instance is stateless and only
 * reads.
 *
 * NOTE (integration): wiring this module into `apps/api/src/app.module.ts`
 * is an OpenClaw integration step outside this task's allowed paths; the
 * module is delivered and verified here through its own Nest testing module
 * (see admin-merchant-ops.integration.spec.ts).
 */
@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule, MerchantModule],
  controllers: [AdminMerchantOpsController],
  providers: [AdminMerchantOpsService, McpService],
  exports: [AdminMerchantOpsService],
})
export class AdminMerchantOpsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { AdminReconciliationOpsController } from './admin-reconciliation-ops.controller.js';
import { AdminReconciliationOpsService } from './admin-reconciliation-ops.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule],
  controllers: [AdminReconciliationOpsController],
  providers: [AdminReconciliationOpsService],
  exports: [AdminReconciliationOpsService],
})
export class AdminReconciliationOpsModule {}

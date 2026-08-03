import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { DashboardMetricCache } from './admin-dashboard.cache.js';
import { AdminDashboardController } from './admin-dashboard.controller.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService, DashboardMetricCache],
  exports: [AdminDashboardService],
})
export class AdminDashboardModule {}

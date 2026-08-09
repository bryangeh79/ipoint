import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { AdminRiskControlsController } from './admin-risk-controls.controller.js';
import { AdminRiskControlsService } from './admin-risk-controls.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule],
  controllers: [AdminRiskControlsController],
  providers: [AdminRiskControlsService],
  exports: [AdminRiskControlsService],
})
export class AdminRiskControlsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { AdminKycController } from './admin-kyc.controller.js';
import { AdminKycService } from './admin-kyc.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule],
  controllers: [AdminKycController],
  providers: [AdminKycService],
  exports: [AdminKycService],
})
export class AdminKycModule {}

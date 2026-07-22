import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { AdminRewardController } from './admin-reward.controller.js';
import { AdminRewardService } from './admin-reward.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule, WalletModule],
  controllers: [AdminRewardController],
  providers: [AdminRewardService],
  exports: [AdminRewardService],
})
export class AdminRewardModule {}

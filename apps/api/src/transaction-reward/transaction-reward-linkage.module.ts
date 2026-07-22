import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { TransactionRewardLinkageService } from './transaction-reward-linkage.service.js';

@Module({
  imports: [DatabaseModule, PlatformAccessModule],
  providers: [TransactionRewardLinkageService],
  exports: [TransactionRewardLinkageService],
})
export class TransactionRewardLinkageModule {}

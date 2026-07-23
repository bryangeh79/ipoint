import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MerchantModule } from '../merchant/merchant.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { TransactionController } from './transaction.controller.js';
import { TransactionConfirmationRewardWriter } from './transaction-confirmation-reward.writer.js';
import { TransactionService } from './transaction.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, PlatformAccessModule, MerchantModule],
  controllers: [TransactionController],
  providers: [TransactionService, TransactionConfirmationRewardWriter],
  exports: [TransactionService],
})
export class TransactionModule {}

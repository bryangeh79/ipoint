import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MerchantModule } from '../merchant/merchant.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { TransactionController } from './transaction.controller.js';
import { MemberTransactionController } from './member-transaction.controller.js';
import { TransactionConfirmationRewardWriter } from './transaction-confirmation-reward.writer.js';
import { TransactionCorrectionService } from './transaction-correction.service.js';
import { TransactionReadService } from './transaction-read.service.js';
import { TransactionService } from './transaction.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, PlatformAccessModule, MerchantModule],
  controllers: [TransactionController, MemberTransactionController],
  providers: [
    TransactionService,
    TransactionReadService,
    TransactionConfirmationRewardWriter,
    TransactionCorrectionService,
  ],
  exports: [
    TransactionService,
    TransactionReadService,
    TransactionCorrectionService,
  ],
})
export class TransactionModule {}

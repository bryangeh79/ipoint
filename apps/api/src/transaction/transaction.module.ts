import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MerchantModule } from '../merchant/merchant.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { CommissionModule } from '../commission/commission.module.js';
import { TransactionController } from './transaction.controller.js';
import { MemberTransactionController } from './member-transaction.controller.js';
import { TransactionConfirmationRewardWriter } from './transaction-confirmation-reward.writer.js';
import { TransactionCommissionDispatchWriter } from './transaction-commission-dispatch.writer.js';
import { TransactionCommissionOutboxWorker } from './transaction-commission-outbox.worker.js';
import { TransactionCommissionIntegrator } from './transaction-commission.integrator.js';
import { TransactionCorrectionService } from './transaction-correction.service.js';
import { TransactionReadService } from './transaction-read.service.js';
import { TransactionSecurityInterceptor } from './transaction-security.interceptor.js';
import { TransactionService } from './transaction.service.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    PlatformAccessModule,
    MerchantModule,
    CommissionModule,
  ],
  controllers: [TransactionController, MemberTransactionController],
  providers: [
    TransactionService,
    TransactionReadService,
    TransactionConfirmationRewardWriter,
    TransactionCommissionDispatchWriter,
    TransactionCommissionOutboxWorker,
    TransactionCommissionIntegrator,
    TransactionCorrectionService,
    TransactionSecurityInterceptor,
  ],
  exports: [
    TransactionService,
    TransactionReadService,
    TransactionCorrectionService,
    TransactionCommissionOutboxWorker,
  ],
})
export class TransactionModule {}

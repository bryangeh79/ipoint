import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { ConfigModule } from '../config/config.module.js';
import { RedemptionController } from './redemption.controller.js';
import { RedemptionService } from './redemption.service.js';
import { RedemptionFulfilmentService } from './redemption-fulfilment.service.js';
import { RedemptionRefundService } from './redemption-refund.service.js';
import { AdminRedemptionFulfilmentController } from './redemption-admin-fulfilment.controller.js';
import { AdminRedemptionRefundController } from './redemption-admin-refund.controller.js';
import { SandboxPaymentAdapter } from './sandbox-payment.adapter.js';
import { SHIPPING_PAYMENT_ADAPTER } from './shipping-payment.port.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    PlatformAccessModule,
    WalletModule,
    ConfigModule,
  ],
  controllers: [
    RedemptionController,
    AdminRedemptionFulfilmentController,
    AdminRedemptionRefundController,
  ],
  providers: [
    RedemptionService,
    RedemptionFulfilmentService,
    RedemptionRefundService,
    {
      provide: SHIPPING_PAYMENT_ADAPTER,
      useClass: SandboxPaymentAdapter,
    },
  ],
  exports: [
    RedemptionService,
    RedemptionFulfilmentService,
    RedemptionRefundService,
  ],
})
export class RedemptionModule {}

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { WalletController } from './wallet.controller.js';
import { WalletAdjustmentOwnerService } from './wallet-adjustment.owner.service.js';
import { WalletService } from './wallet.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, PlatformAccessModule],
  controllers: [WalletController],
  providers: [WalletService, WalletAdjustmentOwnerService],
  exports: [WalletService, WalletAdjustmentOwnerService],
})
export class WalletModule {}

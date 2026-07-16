import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { MerchantOwnershipGuard } from './guards/merchant-ownership.guard.js';
import { MerchantController } from './merchant.controller.js';
import { MerchantService } from './merchant.service.js';

@Module({
  imports: [DatabaseModule, PlatformAccessModule, AuthModule],
  controllers: [MerchantController],
  providers: [MerchantService, MerchantOwnershipGuard],
  exports: [MerchantService],
})
export class MerchantModule {}

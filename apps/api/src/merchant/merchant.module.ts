import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { MerchantOwnershipGuard } from './guards/merchant-ownership.guard.js';
import {
  DevelopmentKycStorageAdapter,
  KYC_STORAGE_ADAPTER,
} from './kyc-storage.adapter.js';
import { MerchantController } from './merchant.controller.js';
import { MerchantService } from './merchant.service.js';
import { McpController } from './mcp.controller.js';
import { McpService } from './mcp.service.js';
import { PackageController } from './package.controller.js';
import { PackageService } from './package.service.js';

@Module({
  imports: [DatabaseModule, PlatformAccessModule, AuthModule],
  controllers: [MerchantController, PackageController, McpController],
  providers: [
    MerchantService,
    PackageService,
    McpService,
    MerchantOwnershipGuard,
    {
      provide: KYC_STORAGE_ADAPTER,
      useClass: DevelopmentKycStorageAdapter,
    },
  ],
  exports: [MerchantService],
})
export class MerchantModule {}

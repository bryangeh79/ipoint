import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MarketModule } from '../market/market.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import {
  AdminAdsContentController,
  MemberAdsContentController,
} from './ads-content.controller.js';
import { AdsContentService } from './ads-content.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, MarketModule, PlatformAccessModule],
  controllers: [AdminAdsContentController, MemberAdsContentController],
  providers: [AdsContentService],
  exports: [AdsContentService],
})
export class AdsContentModule {}

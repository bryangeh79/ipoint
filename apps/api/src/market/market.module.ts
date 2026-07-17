import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MarketController } from './market.controller.js';
import { MarketService } from './market.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [MarketController],
  providers: [MarketService],
})
export class MarketModule {}

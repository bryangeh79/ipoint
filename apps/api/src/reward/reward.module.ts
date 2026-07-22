import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { RewardController } from './reward.controller.js';
import { RewardService } from './reward.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RewardController],
  providers: [RewardService],
  exports: [RewardService],
})
export class RewardModule {}

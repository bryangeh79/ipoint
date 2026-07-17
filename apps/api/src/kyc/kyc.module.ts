import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { KycController } from './kyc.controller.js';
import { KycService } from './kyc.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [KycController],
  providers: [KycService],
})
export class KycModule {}

/**
 * Referral Module
 *
 * NestJS module that wires up the referral engine service and
 * controller. Imports DatabaseModule for Drizzle access and
 * AuthModule for authentication guards.
 *
 * @packageDocumentation
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ReferralController } from '../controllers/referral.controller.js';
import { ReferralService } from '../domain/referral/referral.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ReferralController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}

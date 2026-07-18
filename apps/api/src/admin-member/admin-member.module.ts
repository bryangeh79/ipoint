import { Module } from '@nestjs/common';
import { AdminKycModule } from '../admin-kyc/admin-kyc.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { AdminMemberController } from './admin-member.controller.js';
import { AdminMemberService } from './admin-member.service.js';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule, AdminKycModule],
  controllers: [AdminMemberController],
  providers: [AdminMemberService],
  exports: [AdminMemberService],
})
export class AdminMemberModule {}

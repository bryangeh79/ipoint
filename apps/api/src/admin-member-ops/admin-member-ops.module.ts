import { Module } from '@nestjs/common';
import { AdminMemberModule } from '../admin-member/admin-member.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { AdminMemberOpsController } from './admin-member-ops.controller.js';
import { AdminMemberOpsService } from './admin-member-ops.service.js';

/**
 * P7-S5A Member Operations adapter module (Phase 7).
 *
 * Wraps the frozen Phase 2 AdminMemberModule (owner service) with the
 * selected-market contract. The owner module is imported as-is and never
 * modified; this module only adds the adapter controller/service.
 */
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PlatformAccessModule,
    AdminMemberModule,
  ],
  controllers: [AdminMemberOpsController],
  providers: [AdminMemberOpsService],
  exports: [AdminMemberOpsService],
})
export class AdminMemberOpsModule {}

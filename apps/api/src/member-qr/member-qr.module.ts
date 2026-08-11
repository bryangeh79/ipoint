import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { MemberQrController } from './member-qr.controller.js';
import { MemberQrService } from './member-qr.service.js';

/**
 * L-06 member QR surface module (P8-S9, D-080 bounded implementation).
 * Owns only the /members/me/qr surface; reuses the frozen generic
 * idempotency ledger (auth_idempotency_keys) and the audit service.
 */
@Module({
  imports: [DatabaseModule, AuthModule, PlatformAccessModule],
  controllers: [MemberQrController],
  providers: [MemberQrService],
})
export class MemberQrModule {}

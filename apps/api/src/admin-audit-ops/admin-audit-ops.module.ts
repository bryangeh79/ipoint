import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { AdminAuditOpsController } from './admin-audit-ops.controller.js';
import { AdminAuditOpsService } from './admin-audit-ops.service.js';

/**
 * P7-S9 Admin Audit Viewer adapter module (Phase 7, new).
 *
 * Read-only, market-scoped projections over the canonical append-only
 * `audit_logs` table (immutable by trigger; the viewer defines no write
 * endpoints and performs no writes). The limited view (`audit.read`)
 * masks evidence for every controlled role incl. Support; the raw
 * evidence view (`audit.sensitive-diff.view`) is granted only to
 * non-Support templates and enforces a recorded reason + fresh MFA
 * step-up grant through the canonical RbacGuard — support never reads
 * raw ledgers. No migration is required: `audit_logs_market_time_idx`
 * already covers the market-scoped filter.
 */
@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule],
  controllers: [AdminAuditOpsController],
  providers: [AdminAuditOpsService],
  exports: [AdminAuditOpsService],
})
export class AdminAuditOpsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { ReportSnapshotCache } from './admin-report-ops.cache.js';
import { AdminReportOpsController } from './admin-report-ops.controller.js';
import { AdminReportOpsService } from './admin-report-ops.service.js';

/**
 * P7-S9 Admin Basic Reports adapter module (Phase 7, new).
 *
 * Market-scoped, on-screen, bounded operational reports aggregated from
 * existing canonical owner tables (`report.read`, marketScoped; ALL
 * controlled roles). Freshness semantics are honest (asOf / freshness /
 * stale / unavailable; no fabricated zeros) and the frozen SLA
 * (P7-OD-16: QUEUE ≤ 60s, KPI ≤ 5m) is evidenced by bounded queries and
 * measured query durations. There is NO export surface: Command Center
 * §7 explicitly prohibits CSV/download export. No migration is required —
 * all sources are existing tables queried with bounded windows.
 */
@Module({
  imports: [AuthModule, DatabaseModule, PlatformAccessModule],
  controllers: [AdminReportOpsController],
  providers: [AdminReportOpsService, ReportSnapshotCache],
  exports: [AdminReportOpsService],
})
export class AdminReportOpsModule {}

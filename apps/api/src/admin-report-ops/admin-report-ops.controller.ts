import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import {
  AdminReportOpsService,
  type ReportActor,
} from './admin-report-ops.service.js';
import {
  ReportError,
  type ReportCatalogResponse,
  type ReportDetailResponse,
} from './admin-report-ops.types.js';

/**
 * P7-S9 Basic Reports adapter endpoints (Command Center 2026-08-07 §7.2).
 *
 * - `GET .../reports` — selected-market bounded report catalog with
 *   per-report state (`report.read`, marketScoped): every report carries
 *   `asOf`, `freshness`, `stale` and `unavailable`; missing/failed sources
 *   are UNAVAILABLE — never a fabricated zero.
 * - `GET .../reports/:reportId` — one report detail; UNAVAILABLE → 503,
 *   STALE → 503, unknown report → 422, unknown market → 404.
 *
 * On-screen bounded only: there is NO export/CSV/download surface on this
 * module (Command Center §7 explicitly prohibits export). All queries are
 * bounded (trailing windows, market-filtered GROUP BY) and measured
 * (`queryDurationMs`) against the frozen SLA (QUEUE ≤ 60s, KPI ≤ 5m).
 *
 * Market contract: canonical RbacGuard (permission marketScoped) — the URL
 * market must equal the server-owned Current Admin Market (409
 * `MARKET_CONTEXT_MISMATCH` otherwise).
 */
@ApiTags('Admin Basic Reports')
@ApiBearerAuth()
@Controller('admin/report-ops')
@UseGuards(AuthGuard, RbacGuard)
export class AdminReportOpsController {
  constructor(
    @Inject(AdminReportOpsService)
    private readonly reports: AdminReportOpsService,
  ) {}

  @Get('markets/:marketId/reports')
  @RequirePermission('report.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Selected-market bounded report catalog with state.',
    description:
      'Server-owned bounded operational reports aggregated from existing canonical tables. Every report discloses definition, source, freshness class, asOf, freshness state, stale flag, unavailable state and (when the source is available) the measured source-query duration. A missing or failed source is explicitly UNAVAILABLE — never a fabricated zero. Read-only; no export surface exists.',
  })
  @ApiResponse({ status: 200, description: 'Report catalog with state.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({ status: 404, description: 'Market not found.' })
  @ApiResponse({ status: 409, description: 'Market context mismatch.' })
  catalog(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
  ): Promise<ReportCatalogResponse> {
    return this.handle(() =>
      this.reports.catalog(this.actor(actor, request), marketId),
    );
  }

  @Get('markets/:marketId/reports/:reportId')
  @RequirePermission('report.read', { marketScoped: true })
  @ApiOperation({
    summary: 'One selected-market report detail.',
    description:
      'Single bounded report with value, definition version, asOf, freshness state and measured source-query duration. 503 when the report is UNAVAILABLE or explicitly STALE; 422 for an unknown report id; 404 for an unknown market.',
  })
  @ApiResponse({ status: 200, description: 'Report detail.' })
  @ApiResponse({ status: 404, description: 'Market not found.' })
  @ApiResponse({ status: 422, description: 'Unknown report.' })
  @ApiResponse({ status: 503, description: 'Report unavailable or stale.' })
  report(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('reportId') reportId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
  ): Promise<ReportDetailResponse> {
    return this.handle(() =>
      this.reports.report(this.actor(actor, request), reportId, marketId),
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private actor(
    actor: RequestActor | undefined,
    request: Request,
  ): ReportActor {
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action.',
      });
    }
    const requestId = (request as unknown as Record<string, unknown>)[
      'requestId'
    ];
    return {
      adminUserId: actor.adminUserId,
      ...(typeof requestId === 'string' ? { requestId } : {}),
    };
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ReportError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'REPORT_MARKET_NOT_FOUND':
          throw new NotFoundException(body);
        case 'REPORT_UNDEFINED':
          throw new UnprocessableEntityException(body);
        case 'REPORT_DATA_UNAVAILABLE':
        case 'REPORT_DATA_STALE':
          throw new ServiceUnavailableException(body);
        default:
          throw new ServiceUnavailableException(body);
      }
    }
  }
}

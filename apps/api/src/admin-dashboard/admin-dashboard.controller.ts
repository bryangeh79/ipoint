import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
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
import { AdminDashboardService } from './admin-dashboard.service.js';
import { DashboardError } from './admin-dashboard.types.js';
import type {
  DashboardActor,
  DashboardCatalogResponse,
  DashboardMetricDetail,
} from './admin-dashboard.types.js';

/**
 * P7-S4A Dashboard read-model endpoints.
 *
 * Both endpoints are market-scoped: the RbacGuard resolves the Current Admin
 * Market server-side from the canonical session context and rejects any
 * client-supplied market mismatch. No market id is ever trusted from the
 * client.
 */
@ApiTags('Admin Dashboard')
@ApiBearerAuth()
@Controller('admin/dashboard')
@UseGuards(AuthGuard, RbacGuard)
export class AdminDashboardController {
  constructor(
    @Inject(AdminDashboardService)
    private readonly dashboard: AdminDashboardService,
  ) {}

  @Get('metrics')
  @RequirePermission('dashboard.view')
  @ApiOperation({
    summary: 'List the selected-market dashboard metric catalog with state',
    description:
      'Server-owned bounded read models. Every metric discloses definition, asOf, freshness state, and unavailable state; missing or failed sources are never fabricated as zero.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard metric catalog with per-metric state.',
  })
  listMetrics(
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
  ): Promise<DashboardCatalogResponse> {
    return this.handle(() =>
      this.dashboard.catalog(
        this.dashboardActor(actor, request),
        this.currentMarket(request),
      ),
    );
  }

  @Get('metrics/:metricId')
  @RequirePermission('dashboard.view')
  @ApiOperation({
    summary: 'Get one selected-market dashboard metric with drill-down',
    description:
      'Single metric with value, definition version, asOf, freshness state, source reference, and a drill-down reference preserving market, permission, masking, metric filter, and time boundary.',
  })
  @ApiResponse({ status: 200, description: 'Metric detail.' })
  @ApiResponse({ status: 422, description: 'Unknown metric.' })
  @ApiResponse({ status: 503, description: 'Metric stale or unavailable.' })
  getMetric(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('metricId') metricId: string,
    @Req() request: Request,
  ): Promise<DashboardMetricDetail> {
    return this.handle(() =>
      this.dashboard.metric(
        this.dashboardActor(actor, request),
        metricId,
        this.currentMarket(request),
      ),
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private currentMarket(request: Request): string {
    const context = (
      request as Request & {
        adminMarketContext?: { marketId: string; contextVersion: number };
      }
    ).adminMarketContext;
    if (!context?.marketId) {
      // The RbacGuard normally guarantees this; fail closed if absent.
      throw new ForbiddenException({
        code: 'MARKET_SELECTION_REQUIRED',
        message: 'Select an authorized market to continue.',
      });
    }
    return context.marketId;
  }

  private dashboardActor(
    actor: RequestActor | undefined,
    request: Request,
  ): DashboardActor {
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
      if (!(error instanceof DashboardError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'DASHBOARD_METRIC_UNDEFINED':
        case 'DASHBOARD_FILTER_INVALID':
          throw new UnprocessableEntityException(body);
        case 'DASHBOARD_DATA_UNAVAILABLE':
        case 'DASHBOARD_DATA_STALE':
          throw new ServiceUnavailableException(body);
        default:
          throw new ServiceUnavailableException(body);
      }
    }
  }
}

import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Ip,
  Param,
  ParseUUIDPipe,
  Req,
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
import { AdminPackageOpsService } from './admin-package-ops.service.js';
import type { AdminPackageOpsActor } from './admin-package-ops.types.js';

/**
 * P7-S6A Admin Package Operations adapter endpoints (frozen contract §7.3).
 *
 * Read-only selected-market projections over the frozen Phase 1 package
 * owner rows:
 *
 * - `GET .../packages` — standard package catalog (A–F profiles with their
 *   forward-only versions). Ordinary operational read behind
 *   `merchant.package.view` (all admin roles).
 * - `GET .../special-percentages` — privileged read behind
 *   `merchant.special_package.manage` (seeded to SUPER_ADMIN only, step-up
 *   required by the canonical permission catalog); every view is audited.
 *
 * The market contract is enforced by the canonical RbacGuard (marketScoped):
 * the URL market must equal the server-owned Current Admin Market and the
 * actor must hold the market grant; any client-supplied market disagreement
 * returns MARKET_CONTEXT_MISMATCH.
 *
 * Writes are intentionally NOT duplicated here. Creating/activating
 * standard-package versions, per-merchant explicit assignment/reassignment
 * and set-default remain frozen Phase 1 owner commands
 * (`admin/markets/:marketId/packages/...`,
 * `admin/markets/:marketId/merchants/:branchId/packages/...`). Creating a
 * special percentage is NOT exposed at all: see the module docs for the
 * owner-gap record (the owner command cannot record the mandatory reason
 * the frozen contract §7.3 requires).
 */
@ApiTags('Admin Package Operations')
@ApiBearerAuth()
@Controller('admin/package-ops')
@UseGuards(AuthGuard, RbacGuard)
export class AdminPackageOpsController {
  constructor(
    @Inject(AdminPackageOpsService)
    private readonly ops: AdminPackageOpsService,
  ) {}

  @Get('markets/:marketId/packages')
  @RequirePermission('merchant.package.view', { marketScoped: true })
  @ApiOperation({
    summary: 'Selected-market standard package catalog with versions.',
    description:
      'Read-only projection of the frozen Phase 1 package profiles and versions for the server-owned Current Admin Market. Rates are exact decimal strings (numeric(12,6)). Writing stays on the Phase 1 owner commands.',
  })
  @ApiResponse({ status: 200, description: 'Package catalog.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({ status: 409, description: 'Market context mismatch.' })
  catalog(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
  ): ReturnType<AdminPackageOpsService['catalog']> {
    return this.ops.catalog(marketId);
  }

  @Get('markets/:marketId/special-percentages')
  @RequirePermission('merchant.special_package.manage', { marketScoped: true })
  @ApiOperation({
    summary:
      'Selected-market special percentages (Super Admin, step-up; every view audited).',
    description:
      'Privileged read-only projection behind the SUPER_ADMIN-only permission. Requires a fresh step-up grant (x-step-up-token). Every view writes an audit-of-view record. Creation of special percentages is not exposed (owner command cannot record the mandatory §7.3 reason — see module docs).',
  })
  @ApiResponse({ status: 200, description: 'Special percentages.' })
  @ApiResponse({
    status: 403,
    description: 'Permission, step-up, or market denied.',
  })
  @ApiResponse({ status: 409, description: 'Market context mismatch.' })
  specialPercentages(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): ReturnType<AdminPackageOpsService['specialPercentages']> {
    return this.ops.specialPercentages(
      marketId,
      this.actor(actor, request, ip),
    );
  }

  private actor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): AdminPackageOpsActor {
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
      ipAddress,
      ...(typeof requestId === 'string' ? { requestId } : {}),
    };
  }
}

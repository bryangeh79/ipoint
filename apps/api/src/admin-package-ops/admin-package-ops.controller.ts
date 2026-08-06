import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Ip,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
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
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import {
  createSpecialPercentageSchema,
  type CreateSpecialPercentageDto,
} from './admin-package-ops.dto.js';
import { AdminPackageOpsService } from './admin-package-ops.service.js';
import { AdminPackageOpsError } from './admin-package-ops.types.js';
import type {
  AdminPackageOpsActor,
  AdminSpecialPercentageCreateResponse,
} from './admin-package-ops.types.js';

/**
 * P7-S6A Admin Package Operations adapter endpoints (frozen contract
 * §7.3, D-051).
 *
 * Selected-market projections over the frozen Phase 1 package owner rows
 * plus ONE orchestrated create:
 *
 * - `GET .../packages` — standard package catalog (A–F profiles with their
 *   forward-only versions). Ordinary operational read behind
 *   `merchant.package.view` (all admin roles).
 * - `GET .../special-percentages` — privileged read behind
 *   `merchant.special_package.manage` (seeded to SUPER_ADMIN only, step-up
 *   required by the canonical permission catalog); every view is audited.
 * - `POST .../special-percentages` — create a special percentage. Phase 7
 *   orchestration over the D-051-secured Phase 1 owner command
 *   (`PackageService.createSpecialPercentage`): the adapter only forwards
 *   the server actor + market context and delegates the ENTIRE create to
 *   the owner — RBAC re-check, selected-market enforcement, mandatory
 *   reason (trim/≤500, durable on the row), operation-scoped idempotency
 *   with the canonical payload hash and the atomic immutable audit all
 *   live inside the owner command (D-051 §1–§8). The Idempotency-Key
 *   header is mandatory: same key + same payload replays the original
 *   result; same key + different payload returns 409.
 *
 * The market contract is enforced by the canonical RbacGuard
 * (marketScoped): the URL market must equal the server-owned Current Admin
 * Market and the actor must hold the market grant; any client-supplied
 * market disagreement returns MARKET_CONTEXT_MISMATCH.
 *
 * Creating/activating standard-package versions, per-merchant explicit
 * assignment/reassignment and set-default remain frozen Phase 1 owner
 * commands (`admin/markets/:marketId/packages/...`,
 * `admin/markets/:marketId/merchants/:branchId/packages/...`).
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
      'Privileged read-only projection behind the SUPER_ADMIN-only permission. Requires a fresh step-up grant (x-step-up-token). Every view writes an audit-of-view record. Creation is exposed on POST .../special-percentages through the D-051-secured owner command.',
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

  @Post('markets/:marketId/special-percentages')
  @RequirePermission('merchant.special_package.manage', { marketScoped: true })
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Create a special percentage (Super Admin, step-up; owner-atomic audit + reason).',
    description:
      'Phase 7 orchestration over the D-051-secured Phase 1 owner command (PackageService.createSpecialPercentage): the adapter forwards the server actor + RbacGuard market context and delegates the entire create to the owner — RBAC re-check, selected-market enforcement, mandatory reason (trim/≤500, durable on the row and in the immutable audit), operation-scoped idempotency with the canonical payload hash and the atomic audit. The Idempotency-Key header is mandatory: same key + same payload replays the original result; same key + different payload returns 409. Rate must be an exact decimal string in (0, 100] with at most 6 decimals.',
  })
  @ApiResponse({ status: 201, description: 'Special percentage created.' })
  @ApiResponse({ status: 400, description: 'Invalid body or missing key.' })
  @ApiResponse({
    status: 403,
    description: 'Permission, step-up, or market denied.',
  })
  @ApiResponse({
    status: 409,
    description: 'Idempotency conflict or market context mismatch.',
  })
  createSpecialPercentage(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createSpecialPercentageSchema))
    input: CreateSpecialPercentageDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminSpecialPercentageCreateResponse> {
    return this.handle(() =>
      this.ops.createSpecialPercentage(
        this.actor(actor, request, ip),
        marketId,
        input,
        this.requireIdempotencyKey(idempotencyKey),
      ),
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────

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
    // Server-owned Current Admin Market resolved by the canonical RbacGuard
    // (marketScoped): passed through into the owner command so create gets
    // the exact same selected-market enforcement as the canonical Phase 1
    // route (D-051 §1). The client can never supply this value.
    const marketContext = (
      request as Request & {
        adminMarketContext?: { marketId: string; contextVersion: number };
      }
    ).adminMarketContext;
    return {
      adminUserId: actor.adminUserId,
      ipAddress,
      ...(typeof requestId === 'string' ? { requestId } : {}),
      ...(marketContext
        ? {
            currentMarketId: marketContext.marketId,
            marketContextVersion: marketContext.contextVersion,
          }
        : {}),
    };
  }

  private requireIdempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (!key || key.length > 200) {
      throw new BadRequestException({
        code: 'SPECIAL_PERCENTAGE_IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
    return key;
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AdminPackageOpsError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'SPECIAL_PERCENTAGE_PERMISSION_DENIED':
        case 'SPECIAL_PERCENTAGE_MARKET_ACCESS_DENIED':
          throw new ForbiddenException(body);
        case 'SPECIAL_PERCENTAGE_MARKET_NOT_FOUND':
          throw new NotFoundException(body);
        case 'SPECIAL_PERCENTAGE_MARKET_SELECTION_REQUIRED':
        case 'SPECIAL_PERCENTAGE_MARKET_CONTEXT_MISMATCH':
        case 'SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT':
          throw new ConflictException(body);
        case 'SPECIAL_PERCENTAGE_REASON_REQUIRED':
        case 'SPECIAL_PERCENTAGE_IDEMPOTENCY_KEY_REQUIRED':
          throw new BadRequestException(body);
        // S6A external contract (D-051): CREATE_FAILED keeps the owner's
        // existing code but surfaces with 500 semantics on this surface —
        // the owner raises it only when the atomic insert returned no row
        // (a genuine server-side failure, not a client violation). The
        // canonical Phase 1 route keeps its own 409.
        case 'SPECIAL_PERCENTAGE_CREATE_FAILED':
          throw new InternalServerErrorException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

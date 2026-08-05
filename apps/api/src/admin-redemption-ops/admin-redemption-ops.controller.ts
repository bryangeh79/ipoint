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
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import {
  cancelRedemptionRateSchema,
  createRedemptionRateSchema,
  type CancelRedemptionRateDto,
  type CreateRedemptionRateDto,
} from './admin-redemption-ops.dto.js';
import { AdminRedemptionOpsError } from './admin-redemption-ops.types.js';
import { AdminRedemptionOpsService } from './admin-redemption-ops.service.js';
import type {
  AdminRedemptionOpsActor,
  AdminRedemptionRateCancelResponse,
  AdminRedemptionRateCreateResponse,
  AdminRedemptionRateListResponse,
} from './admin-redemption-ops.types.js';

/**
 * P7-S6C Admin Redemption Rate Configuration adapter endpoints (frozen
 * contract §7.2; rewired to the D-053 secured owner, order §15).
 *
 * - `GET .../rates` — selected-market redemption rate configuration
 *   (`redemption.rate.read`, all admin roles, marketScoped): the approved
 *   per-market bounds (or the explicit blocked state when the market has
 *   no approved configuration — no fallback to Malaysia or any other
 *   market) and every `POINTS_PER_CURRENCY` rate version with full
 *   technical precision, the ≤6-decimal display value, and the projected
 *   effective windows in market-local time AND resolved UTC (including
 *   the `CANCELLED` state for voided scheduled versions).
 * - `POST .../rates` — create a new rate version
 *   (`redemption.rate.manage`, SUPER_ADMIN only, marketScoped, mandatory
 *   Idempotency-Key + reason). The adapter performs only Phase 7
 *   orchestration (market-local date → UTC instant conversion) and
 *   delegates the ENTIRE create to the secured Phase 6 owner command
 *   `RedemptionService.createRateVersion` (D-053): RBAC re-check,
 *   selected-market enforcement, exact per-market bounds/precision,
 *   future market-local 00:00 activation, append-only half-open windows
 *   under a transaction-scoped advisory lock, operation-scoped
 *   idempotency, mandatory reason and the atomic owner audit.
 * - `POST .../rates/:versionId/cancel` — cancel a scheduled,
 *   not-yet-effective version (`redemption.rate.manage`, SUPER_ADMIN
 *   only, marketScoped, mandatory Idempotency-Key + reason). Delegated
 *   entirely to the secured owner command
 *   `RedemptionService.cancelRateVersion` (D-053 §9): append-only
 *   immutable cancellation event; the rate-version row is never
 *   updated/deleted; active/expired/historically-used versions are
 *   rejected with 409 `REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE`.
 *
 * The market contract is enforced by the canonical RbacGuard
 * (`marketScoped`): the URL market must equal the server-owned Current
 * Admin Market and the actor must hold the market grant; any client-
 * supplied market disagreement returns 409 `MARKET_CONTEXT_MISMATCH`.
 * The server Current Admin Market (RbacGuard `adminMarketContext`) is
 * passed through into the owner commands, which re-enforce the same
 * contract in-process (D-053 §5).
 */
@ApiTags('Admin Redemption Operations')
@ApiBearerAuth()
@Controller('admin/redemption-ops')
@UseGuards(AuthGuard, RbacGuard)
export class AdminRedemptionOpsController {
  constructor(
    @Inject(AdminRedemptionOpsService)
    private readonly ops: AdminRedemptionOpsService,
  ) {}

  @Get('markets/:marketId/rates')
  @RequirePermission('redemption.rate.read', { marketScoped: true })
  @ApiOperation({
    summary:
      'Selected-market redemption rate configuration with the §7.2 bounds.',
    description:
      'Read-only projection of the secured Phase 6 redemption rate versions for the server-owned Current Admin Market, plus the approved per-market bounds (initial / minimum / maximum / currency / display unit, resolved from the canonical rules table). A market without an approved configuration returns the explicit blocked state (configured: false) — the surface never falls back to Malaysia or any other market. Rates are exact decimal strings (up to 10 technical decimals); the display value carries at most 6 decimals and is display-only. Cancelled scheduled versions are projected with the CANCELLED window state. Quotes and orders keep their original rate version — nothing historical is ever repriced.',
  })
  @ApiResponse({ status: 200, description: 'Redemption rate configuration.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({ status: 409, description: 'Market context mismatch.' })
  listRates(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
  ): Promise<AdminRedemptionRateListResponse> {
    return this.ops.listRates(marketId);
  }

  @Post('markets/:marketId/rates')
  @RequirePermission('redemption.rate.manage', { marketScoped: true })
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Create a redemption rate version (Super Admin; future market-local 00:00 only).',
    description:
      'Phase 7 orchestration over the secured Phase 6 owner command (D-053): the adapter converts the market-local activation date to the exact UTC instant, then delegates the entire create (RBAC, selected market, exact per-market bounds/precision, future market-local 00:00 activation, append-only half-open windows under a transaction-scoped advisory lock, operation-scoped idempotency, mandatory reason, atomic owner audit) to RedemptionService.createRateVersion. The Idempotency-Key header is mandatory: same key + same payload replays the original result; same key + different payload returns 409. The reason is mandatory and stored durably on the version row by the owner. Markets without an approved configuration are blocked (422).',
  })
  @ApiResponse({ status: 201, description: 'Rate version created.' })
  @ApiResponse({ status: 400, description: 'Invalid body or missing key.' })
  @ApiResponse({
    status: 409,
    description: 'Overlap, idempotency conflict, or market context mismatch.',
  })
  @ApiResponse({
    status: 422,
    description: 'Market blocked, bounds/precision/activation-time violation.',
  })
  createRate(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createRedemptionRateSchema))
    input: CreateRedemptionRateDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminRedemptionRateCreateResponse> {
    return this.handle(() =>
      this.ops.createRate(
        this.actor(actor, request, ip),
        marketId,
        input,
        this.requireIdempotencyKey(idempotencyKey),
      ),
    );
  }

  @Post('markets/:marketId/rates/:versionId/cancel')
  @RequirePermission('redemption.rate.manage', { marketScoped: true })
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Cancel a scheduled redemption rate version (Super Admin; future-effective only).',
    description:
      'Delegated entirely to the secured Phase 6 owner command RedemptionService.cancelRateVersion (D-053 §9): identity/permission re-check, selected-market + resource-market consistency, operation-scoped idempotency, cancellability pre-checks inside the transaction-scoped advisory lock, an append-only immutable cancellation event and the atomic owner audit. The immutable rate-version row is never updated or deleted; the resolver ignores cancelled versions forever. Only a future scheduled, not-yet-effective version can be cancelled; active/expired/historically-used versions are rejected with 409 REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE and a second cancellation with 409 REDEMPTION_RATE_ALREADY_CANCELLED. The Idempotency-Key header and a mandatory reason are required.',
  })
  @ApiResponse({ status: 200, description: 'Version cancelled.' })
  @ApiResponse({ status: 400, description: 'Invalid body or missing key.' })
  @ApiResponse({
    status: 409,
    description:
      'Cannot cancel effective/used version, already cancelled, idempotency conflict, or market context mismatch.',
  })
  cancelRate(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(cancelRedemptionRateSchema))
    input: CancelRedemptionRateDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminRedemptionRateCancelResponse> {
    return this.handle(() =>
      this.ops.cancelRate(
        this.actor(actor, request, ip),
        versionId,
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
  ): AdminRedemptionOpsActor {
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
    // (marketScoped): passed through into the owner commands so create and
    // cancel get the exact same selected-market enforcement as the
    // canonical route (D-053 contract).
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
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
    return key;
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AdminRedemptionOpsError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'REDEMPTION_MARKET_NOT_FOUND':
        case 'REDEMPTION_RATE_VERSION_NOT_FOUND':
          throw new NotFoundException(body);
        case 'PERMISSION_DENIED':
        case 'MARKET_ACCESS_DENIED':
          throw new ForbiddenException(body);
        case 'REDEMPTION_RATE_OVERLAP':
        case 'REDEMPTION_IDEMPOTENCY_CONFLICT':
        case 'MARKET_SELECTION_REQUIRED':
        case 'MARKET_CONTEXT_MISMATCH':
        case 'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE':
        case 'REDEMPTION_RATE_ALREADY_CANCELLED':
          throw new ConflictException(body);
        case 'IDEMPOTENCY_KEY_REQUIRED':
        case 'REASON_REQUIRED':
          throw new BadRequestException(body);
        case 'REDEMPTION_RATE_MARKET_BLOCKED':
        case 'REDEMPTION_RATE_BELOW_MINIMUM':
        case 'REDEMPTION_RATE_ABOVE_MAXIMUM':
        case 'REDEMPTION_RATE_CURRENCY_MISMATCH':
        case 'REDEMPTION_RATE_PRECISION_EXCEEDED':
        case 'REDEMPTION_ACTIVATION_NOT_FUTURE':
          throw new UnprocessableEntityException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

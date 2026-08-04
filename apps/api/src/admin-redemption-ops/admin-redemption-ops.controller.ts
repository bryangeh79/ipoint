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
  createRedemptionRateSchema,
  type CreateRedemptionRateDto,
} from './admin-redemption-ops.dto.js';
import { AdminRedemptionOpsError } from './admin-redemption-ops.types.js';
import { AdminRedemptionOpsService } from './admin-redemption-ops.service.js';
import type {
  AdminRedemptionOpsActor,
  AdminRedemptionRateCreateResponse,
  AdminRedemptionRateListResponse,
} from './admin-redemption-ops.types.js';

/**
 * P7-S6C Admin Redemption Rate Configuration adapter endpoints (frozen
 * contract §7.2).
 *
 * - `GET .../rates` — selected-market redemption rate configuration
 *   (`redemption.rate.read`, all admin roles, marketScoped): the approved
 *   §7.2 per-market bounds (or the explicit blocked state when the market
 *   has no approved configuration — no fallback to Malaysia or any other
 *   market) and every `POINTS_PER_CURRENCY` rate version with full
 *   technical precision, the ≤6-decimal display value, and the projected
 *   effective windows in market-local time AND resolved UTC.
 * - `POST .../rates` — create a new rate version
 *   (`redemption.rate.manage`, SUPER_ADMIN only, marketScoped, mandatory
 *   Idempotency-Key + reason). The adapter validates the §7.2 per-market
 *   bounds (Malaysia initial RM1.00 / min RM0.50 / max RM2.00 per 1
 *   iPoint) and the ≤10-decimal technical precision, resolves the strictly
 *   future market-local 00:00 activation, serializes overlap with an
 *   advisory lock, then delegates the single insert to the frozen Phase 6
 *   owner command unchanged. Quotes and orders keep their original rate
 *   version — no historical repricing, ever.
 *
 * The market contract is enforced by the canonical RbacGuard
 * (`marketScoped`): the URL market must equal the server-owned Current
 * Admin Market and the actor must hold the market grant; any client-
 * supplied market disagreement returns 409 `MARKET_CONTEXT_MISMATCH`.
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
      'Read-only projection of the frozen Phase 6 redemption rate versions for the server-owned Current Admin Market, plus the approved §7.2 per-market bounds (initial / minimum / maximum / currency / display unit). A market without an approved configuration returns the explicit blocked state (configured: false) — the surface never falls back to Malaysia or any other market. Rates are exact decimal strings (up to 10 technical decimals); the display value carries at most 6 decimals and is display-only. Quotes and orders keep their original rate version — nothing historical is ever repriced.',
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
      'Validates the §7.2 per-market bounds (Malaysia: initial RM1.00, minimum RM0.50, maximum RM2.00 per 1 iPoint) and the ≤10-decimal technical precision, requires a strictly future market-local 00:00 activation (market-local AND resolved UTC are returned), rejects overlapping effective windows, and delegates the insert to the frozen Phase 6 owner command. The Idempotency-Key header is mandatory: same key + same payload replays the original result; same key + different payload returns 409. The reason is mandatory and recorded in the privileged audit trail. Markets without an approved configuration are blocked (422).',
  })
  @ApiResponse({ status: 201, description: 'Rate version created.' })
  @ApiResponse({ status: 400, description: 'Invalid body or missing key.' })
  @ApiResponse({
    status: 409,
    description: 'Overlap, idempotency conflict, or market context mismatch.',
  })
  @ApiResponse({
    status: 422,
    description:
      'Market blocked, bounds/precision/activation-time violation.',
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
    return {
      adminUserId: actor.adminUserId,
      ipAddress,
      ...(typeof requestId === 'string' ? { requestId } : {}),
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
        case 'REDEMPTION_RATE_OVERLAP':
        case 'REDEMPTION_IDEMPOTENCY_CONFLICT':
          throw new ConflictException(body);
        case 'REDEMPTION_RATE_MARKET_BLOCKED':
        case 'REDEMPTION_RATE_BELOW_MINIMUM':
        case 'REDEMPTION_RATE_ABOVE_MAXIMUM':
        case 'REDEMPTION_RATE_PRECISION_EXCEEDED':
        case 'REDEMPTION_ACTIVATION_NOT_FUTURE':
          throw new UnprocessableEntityException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

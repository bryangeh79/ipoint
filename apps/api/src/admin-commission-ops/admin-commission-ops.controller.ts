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
  createCommissionRateSchema,
  type CreateCommissionRateDto,
} from './admin-commission-ops.dto.js';
import { AdminCommissionOpsError } from './admin-commission-ops.types.js';
import { AdminCommissionOpsService } from './admin-commission-ops.service.js';
import type {
  AdminCommissionOpsActor,
  AdminCommissionRateCreateResponse,
  AdminCommissionRateListResponse,
} from './admin-commission-ops.types.js';

/**
 * P7-S6D Admin Commission Rate Configuration adapter endpoints (D-054
 * §16 / D-055 §8).
 *
 * - `GET .../rates` — selected-market commission rate configuration
 *   (`commission.rate.read`, all Finance admin roles, marketScoped): the
 *   frozen taxonomy (UI display only), every (commission_type, generation)
 *   definition with the current effective version (owner logical half-open
 *   resolution), the scheduled future versions and the full immutable
 *   history — exact decimal strings with full technical precision, the
 *   ≤6-decimal display value and the projected effective windows in
 *   market-local time AND resolved UTC. A market that is not present or
 *   not ACTIVE is reported with the explicit blocked state
 *   (`configured: false` — no fallback to any other market).
 * - `POST .../rates` — create a new rate version
 *   (`commission.rate.manage`, SUPER_ADMIN only, marketScoped, mandatory
 *   Idempotency-Key + reason). The adapter performs only Phase 7
 *   orchestration (market-local date → UTC instant conversion) and
 *   delegates the ENTIRE create to the secured Phase 5 owner command
 *   `RateManagementService.createRateVersion` (D-054): RBAC re-check,
 *   selected-market enforcement, frozen taxonomy, exact rate
 *   grammar/precision, future market-local 00:00 activation, append-only
 *   half-open windows under a transaction-scoped advisory lock,
 *   operation-scoped idempotency, mandatory reason and the atomic owner
 *   audit.
 *
 * The market contract is enforced by the canonical RbacGuard
 * (`marketScoped`): the URL market must equal the server-owned Current
 * Admin Market and the actor must hold the market grant; any client-
 * supplied market disagreement returns 409 `MARKET_CONTEXT_MISMATCH`.
 * The server Current Admin Market (RbacGuard `adminMarketContext`) is
 * passed through into the owner command, which re-enforces the same
 * contract in-process (D-054 §5).
 */
@ApiTags('Admin Commission Operations')
@ApiBearerAuth()
@Controller('admin/commission-ops')
@UseGuards(AuthGuard, RbacGuard)
export class AdminCommissionOpsController {
  constructor(
    @Inject(AdminCommissionOpsService)
    private readonly ops: AdminCommissionOpsService,
  ) {}

  @Get('markets/:marketId/rates')
  @RequirePermission('commission.rate.read', { marketScoped: true })
  @ApiOperation({
    summary:
      'Selected-market commission rate configuration (history, current, scheduled).',
    description:
      'Read-only projection of the secured Phase 5 commission rate versions for the server-owned Current Admin Market: every (commission_type, generation) definition with the current effective version, the scheduled future versions and the full immutable history. Rates are exact decimal strings (up to 10 technical decimals); the display value carries at most 6 decimals and is display-only. Windows are projected with the owner logical half-open semantics (a successor closes its open-ended predecessor) in market-local time AND resolved UTC. The frozen taxonomy is exposed for the configuration UI; the owner remains the enforcement boundary. A market that is not ACTIVE is reported with the explicit blocked state (configured: false) — the surface never falls back to another market.',
  })
  @ApiResponse({
    status: 200,
    description: 'Commission rate configuration.',
  })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({ status: 409, description: 'Market context mismatch.' })
  listRates(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
  ): Promise<AdminCommissionRateListResponse> {
    return this.ops.listRates(marketId);
  }

  @Post('markets/:marketId/rates')
  @RequirePermission('commission.rate.manage', { marketScoped: true })
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Create a commission rate version (Super Admin; future market-local 00:00 only).',
    description:
      'Phase 7 orchestration over the secured Phase 5 owner command (D-054): the adapter converts the market-local activation date to the exact UTC instant, then delegates the entire create (RBAC, selected market, frozen taxonomy, exact rate grammar/precision, future market-local 00:00 activation, append-only half-open windows under a transaction-scoped advisory lock, operation-scoped idempotency, mandatory reason, atomic owner audit) to RateManagementService.createRateVersion. The Idempotency-Key header is mandatory: same key + same payload replays the original result; same key + different payload returns 409. The reason is mandatory and stored durably on the version row by the owner. Markets that are not ACTIVE are blocked (422).',
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
      'Market blocked, taxonomy/precision/activation-time violation.',
  })
  createRate(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createCommissionRateSchema))
    input: CreateCommissionRateDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminCommissionRateCreateResponse> {
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
  ): AdminCommissionOpsActor {
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
    // the exact same selected-market enforcement as the canonical route
    // (D-054 §5 contract).
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
        code: 'COMMISSION_RATE_IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
    return key;
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AdminCommissionOpsError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'COMMISSION_MARKET_NOT_FOUND':
          throw new NotFoundException(body);
        case 'COMMISSION_RATE_PERMISSION_DENIED':
        case 'COMMISSION_RATE_MARKET_ACCESS_DENIED':
          throw new ForbiddenException(body);
        case 'COMMISSION_RATE_MARKET_SELECTION_REQUIRED':
        case 'COMMISSION_RATE_MARKET_CONTEXT_MISMATCH':
        case 'COMMISSION_RATE_IDEMPOTENCY_CONFLICT':
        case 'OVERLAPPING_RATE_PERIOD':
          throw new ConflictException(body);
        case 'COMMISSION_RATE_REASON_REQUIRED':
        case 'COMMISSION_RATE_IDEMPOTENCY_KEY_REQUIRED':
        case 'INVALID_MARKET':
        case 'INVALID_RATE_VALUE':
        case 'INVALID_EFFECTIVE_RANGE':
        case 'INVALID_TIMESTAMP':
          throw new BadRequestException(body);
        // S6D external contract: the frozen-taxonomy rejections
        // (INVALID_COMMISSION_TYPE / INVALID_GENERATION / INVALID_RATE_TYPE /
        // RATE_TYPE_MISMATCH) surface as 422 Unprocessable Entity — the
        // request is well-formed but semantically invalid against the frozen
        // commission-type contract (D-054 §6). The canonical Phase 5 route
        // keeps its own pre-existing 400 mapping; this surface documents the
        // 422 contract and the integration suite asserts it.
        case 'COMMISSION_RATE_MARKET_NOT_FOUND':
        case 'COMMISSION_RATE_PRECISION_EXCEEDED':
        case 'COMMISSION_RATE_PERCENTAGE_LIMIT':
        case 'COMMISSION_RATE_ACTIVATION_NOT_FUTURE':
        case 'COMMISSION_RATE_TIMEZONE_MISMATCH':
        case 'INVALID_COMMISSION_TYPE':
        case 'INVALID_GENERATION':
        case 'INVALID_RATE_TYPE':
        case 'RATE_TYPE_MISMATCH':
          throw new UnprocessableEntityException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

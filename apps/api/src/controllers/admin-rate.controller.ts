/**
 * Admin Commission Rate Management Controller
 *
 * Admin-facing rate versioning API for commission rate configuration.
 * All rates are versioned, immutable after creation, and prospective only.
 *
 * ## Key Rules (FROZEN)
 * - Rates are versioned and immutable (no updates/deletes)
 * - New rates are prospective only (no retroactive changes)
 * - No overlapping effective periods
 * - Market isolation
 * - Decimal strings throughout
 *
 * ## D-054 (CG-04 gate)
 * - Both write routes (`POST /` and `POST /schedule`) call the SINGLE
 *   secured owner command `RateManagementService.createRateVersion`, which
 *   re-enforces RBAC / selected market / exact decimals / taxonomy /
 *   future market-local activation / overlap / advisory lock /
 *   idempotency / reason / atomic audit INSIDE the service. Transport
 *   guards (`@UseGuards(AuthGuard, RbacGuard)` +
 *   `@RequirePermission('commission.rate.manage')`) are defense-in-depth
 *   only — they are not the security boundary.
 * - The Idempotency-Key header is mandatory on writes and injected into
 *   the owner command; the server actor/context (adminUserId, Current
 *   Admin Market, request id, IP) is built here — never from client input.
 * - Caller-supplied `createdBy` is never accepted (the command carries no
 *   such field; the owner derives `createdBy` from the authenticated
 *   actor).
 *
 * @packageDocumentation
 */

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
  Post,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { markets } from '@ipoint/database';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import {
  RateManagementService,
  RateManagementError,
} from '../domain/commission/rate.service.js';
import {
  ownerRateCreateSchema,
  type OwnerRateCreateDto,
} from '../domain/commission/rate.dto.js';
import type {
  CommissionRateAdminActor,
  CreateRateVersionCommand,
} from '../domain/commission/rate.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

/* ================================================================== */
/*  Admin Rate Controller                                             */
/* ================================================================== */

@ApiTags('Admin Commission Rates')
@ApiBearerAuth()
@Controller('admin/commission-rates')
@UseGuards(AuthGuard, RbacGuard)
export class AdminRateController {
  constructor(
    @Inject(RateManagementService)
    private readonly rateService: RateManagementService,
    @Inject(DatabaseService)
    private readonly database: DatabaseService,
  ) {}

  // ─── Get Active Rates ──────────────────────────────────────────

  @Get('active')
  @RequirePermission('commission.rate.read')
  @ApiOperation({
    summary: 'Get active commission rates for a market',
  })
  @ApiQuery({
    name: 'market',
    required: true,
    description: 'Market code (e.g. MY, SG)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of active rate versions for the market',
  })
  async getActiveRates(
    @CurrentActor() _actor: RequestActor | undefined,
    @Req() request: Request,
    @Query('market') market?: string,
  ) {
    if (!market) {
      throw new BadRequestException({
        code: 'RATE_MISSING_MARKET',
        message: 'market query parameter is required.',
      });
    }
    // P5-R1: rate configuration is bounded to the server-selected market.
    const selectedMarket = await this.resolveSelectedMarketCode(request);
    this.assertMarketMatches(market, selectedMarket);
    return this.rateService.getActiveRates(market);
  }

  // ─── Get Rate History ─────────────────────────────────────────

  @Get('history')
  @RequirePermission('commission.rate.read')
  @ApiOperation({
    summary: 'Get commission rate history filtered by type, generation, market',
  })
  @ApiQuery({ name: 'commissionType', required: true })
  @ApiQuery({ name: 'generation', required: true })
  @ApiQuery({ name: 'market', required: true })
  @ApiResponse({
    status: 200,
    description: 'Ordered list of rate versions matching the filter',
  })
  async getRateHistory(
    @CurrentActor() _actor: RequestActor | undefined,
    @Req() request: Request,
    @Query('commissionType') commissionType?: string,
    @Query('generation') generation?: string,
    @Query('market') market?: string,
  ) {
    if (!commissionType || generation === undefined || !market) {
      throw new BadRequestException({
        code: 'RATE_MISSING_FILTERS',
        message: 'commissionType, generation, and market are required.',
      });
    }
    // P5-R1: rate configuration is bounded to the server-selected market.
    const selectedMarket = await this.resolveSelectedMarketCode(request);
    this.assertMarketMatches(market, selectedMarket);
    return this.rateService.getRateHistory(
      market,
      commissionType,
      parseInt(generation, 10),
    );
  }

  // ─── Get Rate By ID ──────────────────────────────────────────

  @Get(':id')
  @RequirePermission('commission.rate.read')
  @ApiOperation({ summary: 'Get a single rate version by ID' })
  @ApiResponse({ status: 200, description: 'Rate version details' })
  @ApiResponse({ status: 404, description: 'Rate version not found' })
  async getRateById(
    @CurrentActor() _actor: RequestActor | undefined,
    @Param('id') id: string,
  ) {
    if (!id) {
      throw new BadRequestException({
        code: 'RATE_MISSING_ID',
        message: 'Rate version ID is required.',
      });
    }
    try {
      return await this.rateService.getRateById(id);
    } catch (error) {
      if (error instanceof RateManagementError) {
        throw new NotFoundException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  }

  // ─── Create Rate Version (D-054 secured owner) ─────────────────

  @Post()
  @RequirePermission('commission.rate.manage')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a new commission rate version',
    description:
      'Creates a prospective rate version through the secured Phase 5 ' +
      'owner. Rates are immutable after creation. Overlapping effective ' +
      'periods are rejected. The Idempotency-Key header is mandatory. ' +
      'The createdBy admin ID is derived from the authenticated principal ' +
      '(client-supplied createdBy is never accepted).',
  })
  @ApiResponse({ status: 201, description: 'Rate version created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({
    status: 403,
    description: 'Permission / market access denied',
  })
  @ApiResponse({
    status: 409,
    description: 'Market context / overlap / idempotency conflict',
  })
  async createRateVersion(
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(ownerRateCreateSchema))
    body: OwnerRateCreateDto,
  ) {
    return this.handleRateError(() =>
      this.rateService.createRateVersion(this.adminActor(actor, request, ip), {
        ...(body as unknown as Record<string, unknown>),
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      } as unknown as CreateRateVersionCommand),
    );
  }

  // ─── Schedule Rate Version (D-054 secured owner) ───────────────

  @Post('schedule')
  @RequirePermission('commission.rate.manage')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Schedule a future rate version',
    description:
      'Creates a rate version effective from a future date through the ' +
      'secured Phase 5 owner. Same validation as create (no overlaps, ' +
      'prospective only, future market-local 00:00). The Idempotency-Key ' +
      'header is mandatory.',
  })
  @ApiResponse({ status: 201, description: 'Rate version scheduled' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({
    status: 403,
    description: 'Permission / market access denied',
  })
  @ApiResponse({
    status: 409,
    description: 'Market context / overlap / idempotency conflict',
  })
  async scheduleRateVersion(
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(ownerRateCreateSchema))
    body: OwnerRateCreateDto,
  ) {
    return this.handleRateError(() =>
      this.rateService.createRateVersion(this.adminActor(actor, request, ip), {
        ...(body as unknown as Record<string, unknown>),
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      } as unknown as CreateRateVersionCommand),
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────

  /**
   * Build the server-created actor/context for the owner command from the
   * authenticated session, the RbacGuard-resolved Current Admin Market,
   * the request correlation id and the client IP. Client input never
   * reaches the actor object.
   */
  private adminActor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): CommissionRateAdminActor {
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new ForbiddenException({
        code: 'AUTH_PERMISSION_DENIED',
        message: 'An administrator session is required.',
      });
    }
    const requestId = (request as unknown as Record<string, unknown>)[
      'requestId'
    ];
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

  /**
   * Resolve the server-selected Current Admin Market code from the
   * RbacGuard-resolved context (never from client input).
   */
  private async resolveSelectedMarketCode(request: Request): Promise<string> {
    const context = (
      request as Request & {
        adminMarketContext?: { marketId: string; contextVersion: number };
      }
    ).adminMarketContext;
    if (!context?.marketId) {
      throw new ForbiddenException({
        code: 'MARKET_SELECTION_REQUIRED',
        message: 'Select an authorized market to continue.',
      });
    }
    const rows = await this.database.db
      .select({ code: markets.code })
      .from(markets)
      .where(eq(markets.id, context.marketId))
      .limit(1);
    const code = rows[0]?.code;
    if (!code) {
      throw new ForbiddenException({
        code: 'MARKET_SELECTION_REQUIRED',
        message: 'The selected market is not available.',
      });
    }
    return code;
  }

  /**
   * Reject any request whose market code differs from the server-selected
   * Current Admin Market (client market values are never authority).
   */
  private assertMarketMatches(market: string, selectedMarket: string): void {
    if (market.toUpperCase() !== selectedMarket) {
      throw new ConflictException({
        code: 'MARKET_CONTEXT_MISMATCH',
        message: 'The selected market changed. Refresh and try again.',
      });
    }
  }

  private async handleRateError<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof RateManagementError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'RATE_VERSION_NOT_FOUND':
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
        case 'INVALID_COMMISSION_TYPE':
        case 'INVALID_GENERATION':
        case 'INVALID_RATE_TYPE':
        case 'RATE_TYPE_MISMATCH':
        case 'INVALID_MARKET':
        case 'INVALID_RATE_VALUE':
        case 'INVALID_EFFECTIVE_RANGE':
        case 'INVALID_TIMESTAMP':
          throw new BadRequestException(body);
        case 'COMMISSION_RATE_PRECISION_EXCEEDED':
        case 'COMMISSION_RATE_PERCENTAGE_LIMIT':
        case 'COMMISSION_RATE_ACTIVATION_NOT_FUTURE':
        case 'COMMISSION_RATE_TIMEZONE_MISMATCH':
        case 'COMMISSION_RATE_MARKET_NOT_FOUND':
          throw new UnprocessableEntityException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

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
 * @packageDocumentation
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import {
  RateManagementService,
  RateManagementError,
} from '../domain/commission/rate.service.js';

/* ================================================================== */
/*  Admin Rate Controller                                             */
/* ================================================================== */

@ApiTags('Admin Commission Rates')
@ApiBearerAuth()
@Controller('api/v1/admin/commission-rates')
@UseGuards(AuthGuard, RbacGuard)
export class AdminRateController {
  constructor(
    @Inject(RateManagementService)
    private readonly rateService: RateManagementService,
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
    @Query('market') market?: string,
  ) {
    if (!market) {
      throw new BadRequestException({
        code: 'RATE_MISSING_MARKET',
        message: 'market query parameter is required.',
      });
    }
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

  // ─── Create Rate Version ──────────────────────────────────────

  @Post()
  @RequirePermission('commission.rate.manage')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create a new commission rate version',
    description:
      'Creates a prospective rate version. Rates are immutable after ' +
      'creation. Overlapping effective periods are rejected. ' +
      'The createdBy admin ID is extracted from the auth principal.',
  })
  @ApiResponse({ status: 200, description: 'Rate version created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Overlapping period conflict' })
  async createRateVersion(
    @CurrentActor() actor: RequestActor | undefined,
    @Body()
    body: {
      market: string;
      commissionType: string;
      generation: number;
      rateValue: string;
      rateType: string;
      effectiveFrom: string;
      effectiveUntil?: string;
    },
  ) {
    const adminId = this.resolveAdminId(actor);

    const {
      market,
      commissionType,
      generation,
      rateValue,
      rateType,
      effectiveFrom,
      effectiveUntil,
    } = body;

    if (
      !market ||
      !commissionType ||
      generation === undefined ||
      !rateValue ||
      !rateType ||
      !effectiveFrom
    ) {
      throw new BadRequestException({
        code: 'RATE_MISSING_FIELDS',
        message:
          'market, commissionType, generation, rateValue, rateType, and effectiveFrom are required.',
      });
    }

    return this.handleRateError(() =>
      this.rateService.createRate(
        adminId,
        commissionType,
        generation,
        market,
        rateValue,
        rateType,
        effectiveFrom,
        effectiveUntil ?? undefined,
      ),
    );
  }

  // ─── Schedule Rate Version ─────────────────────────────────────

  @Post('schedule')
  @RequirePermission('commission.rate.manage')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Schedule a future rate version',
    description:
      'Creates a rate version effective from a future date. ' +
      'Same validation as create (no overlaps, prospective only).',
  })
  @ApiResponse({ status: 200, description: 'Rate version scheduled' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Overlapping period conflict' })
  async scheduleRateVersion(
    @CurrentActor() actor: RequestActor | undefined,
    @Body()
    body: {
      market: string;
      commissionType: string;
      generation: number;
      rateValue: string;
      rateType: string;
      effectiveFrom: string;
    },
  ) {
    const adminId = this.resolveAdminId(actor);
    const {
      market,
      commissionType,
      generation,
      rateValue,
      rateType,
      effectiveFrom,
    } = body;

    if (
      !market ||
      !commissionType ||
      generation === undefined ||
      !rateValue ||
      !rateType ||
      !effectiveFrom
    ) {
      throw new BadRequestException({
        code: 'RATE_MISSING_FIELDS',
        message: 'All fields are required.',
      });
    }

    return this.handleRateError(() =>
      this.rateService.createRate(
        adminId,
        commissionType,
        generation,
        market,
        rateValue,
        rateType,
        effectiveFrom,
        undefined,
      ),
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private resolveAdminId(actor: RequestActor | undefined): string {
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new ForbiddenException({
        code: 'AUTH_PERMISSION_DENIED',
        message: 'An administrator session is required.',
      });
    }
    return actor.adminUserId;
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
        case 'INVALID_COMMISSION_TYPE':
        case 'INVALID_GENERATION':
        case 'INVALID_RATE_TYPE':
        case 'INVALID_MARKET':
        case 'INVALID_RATE_VALUE':
        case 'INVALID_EFFECTIVE_RANGE':
          throw new BadRequestException(body);
        case 'OVERLAPPING_RATE_PERIOD':
          throw new ConflictException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

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
  Put,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import { RedemptionService } from './redemption.service.js';
import { RedemptionError } from './redemption.errors.js';
import type { RedemptionAdminActor } from './redemption.types.js';
import {
  type AdminCatalogQueryDto,
  type RateVersionQueryDto,
  type PickupLocationQueryDto,
  adminCatalogQuerySchema,
  rateVersionQuerySchema,
  pickupLocationQuerySchema,
  ownerRateCreateSchema,
  ownerRateCancelSchema,
} from './redemption.dto.js';
import {
  createCatalogItemSchema,
  updateCatalogItemSchema,
  setCatalogStatusSchema,
  createPickupLocationSchema,
  updatePickupLocationSchema,
} from '@ipoint/validation';

@ApiTags('Admin Redemption')
@ApiBearerAuth()
@Controller('admin/redemption')
@UseGuards(AuthGuard, RbacGuard)
export class AdminRedemptionController {
  constructor(
    @Inject(RedemptionService) private readonly redemption: RedemptionService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  // CATALOG ITEMS
  // ═══════════════════════════════════════════════════════════════════════

  @Post('catalog')
  @RequirePermission('redemption.catalog.manage', { marketScoped: true })
  createItem(
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createCatalogItemSchema))
    body: unknown,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.createCatalogItem(
        this.adminActor(actor, request, ip),
        body as Parameters<RedemptionService['createCatalogItem']>[1],
      ),
    );
  }

  @Put('catalog/:itemId')
  @RequirePermission('redemption.catalog.manage', { marketScoped: true })
  updateItem(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(updateCatalogItemSchema))
    body: unknown,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(async () => {
      const adminActor = this.adminActor(actor, request, ip);
      await this.assertCatalogItemMarket(itemId, adminActor.currentMarketId);
      return this.redemption.updateCatalogItem(
        adminActor,
        itemId,
        body as Parameters<RedemptionService['updateCatalogItem']>[2],
      );
    });
  }

  @Post('catalog/:itemId/status')
  @RequirePermission('redemption.catalog.manage', { marketScoped: true })
  @HttpCode(200)
  setStatus(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(setCatalogStatusSchema))
    body: unknown,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(async () => {
      const adminActor = this.adminActor(actor, request, ip);
      await this.assertCatalogItemMarket(itemId, adminActor.currentMarketId);
      return this.redemption.setCatalogStatus(
        adminActor,
        itemId,
        body as Parameters<RedemptionService['setCatalogStatus']>[2],
      );
    });
  }

  @Get('market/:marketId/catalog')
  @RequirePermission('redemption.catalog.manage', { marketScoped: true })
  listItems(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('marketId') marketId: string,
    @Query(new ZodValidationPipe(adminCatalogQuerySchema))
    query: AdminCatalogQueryDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.listCatalogItems(
        this.adminActor(actor, request, ip),
        marketId,
        query,
      ),
    );
  }

  @Get('catalog/:itemId')
  @RequirePermission('redemption.catalog.manage', { marketScoped: true })
  getItem(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('itemId') itemId: string,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(async () => {
      const adminActor = this.adminActor(actor, request, ip);
      await this.assertCatalogItemMarket(itemId, adminActor.currentMarketId);
      return this.redemption.getCatalogItem(adminActor, itemId);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RATE VERSIONS
  // ═══════════════════════════════════════════════════════════════════════

  @Post('market/:marketId/rates')
  @RequirePermission('redemption.rate.manage', { marketScoped: true })
  createRate(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('marketId') marketId: string,
    @Body(new ZodValidationPipe(ownerRateCreateSchema))
    body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.createRateVersion(this.adminActor(actor, request, ip), {
        ...(body as Record<string, unknown>),
        marketId,
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      } as Parameters<RedemptionService['createRateVersion']>[1]),
    );
  }

  @Get('market/:marketId/rates')
  @RequirePermission('redemption.rate.manage', { marketScoped: true })
  listRates(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('marketId') marketId: string,
    @Query(new ZodValidationPipe(rateVersionQuerySchema))
    query: RateVersionQueryDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.listRateVersions(
        this.adminActor(actor, request, ip),
        marketId,
        query,
      ),
    );
  }

  @Post('rates/:rateId/cancel')
  @RequirePermission('redemption.rate.manage', { marketScoped: true })
  @HttpCode(200)
  cancelRate(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('rateId') rateId: string,
    @Body(new ZodValidationPipe(ownerRateCancelSchema))
    body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.cancelRateVersion(
        this.adminActor(actor, request, ip),
        rateId,
        {
          ...(body as Record<string, unknown>),
          idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
        } as Parameters<RedemptionService['cancelRateVersion']>[2],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PICKUP LOCATIONS
  // ═══════════════════════════════════════════════════════════════════════

  @Post('market/:marketId/pickup-locations')
  @RequirePermission('redemption.catalog.manage', { marketScoped: true })
  createPickupLocation(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('marketId') marketId: string,
    @Body(new ZodValidationPipe(createPickupLocationSchema))
    body: unknown,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.createPickupLocation(
        this.adminActor(actor, request, ip),
        {
          ...(body as Record<string, unknown>),
          marketId,
        } as Parameters<RedemptionService['createPickupLocation']>[1],
      ),
    );
  }

  @Put('pickup-locations/:locationId')
  @RequirePermission('redemption.catalog.manage', { marketScoped: true })
  updatePickupLocation(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('locationId') locationId: string,
    @Body(new ZodValidationPipe(updatePickupLocationSchema))
    body: unknown,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(async () => {
      const adminActor = this.adminActor(actor, request, ip);
      await this.assertPickupLocationMarket(
        locationId,
        adminActor.currentMarketId,
      );
      return this.redemption.updatePickupLocation(
        adminActor,
        locationId,
        body as Record<string, unknown>,
      );
    });
  }

  @Get('market/:marketId/pickup-locations')
  @RequirePermission('redemption.catalog.manage', { marketScoped: true })
  listPickupLocations(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('marketId') marketId: string,
    @Query(new ZodValidationPipe(pickupLocationQuerySchema))
    query: PickupLocationQueryDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.listPickupLocations(
        this.adminActor(actor, request, ip),
        marketId,
        query,
      ),
    );
  }

  @Get('pickup-locations/:locationId')
  @RequirePermission('redemption.catalog.manage', { marketScoped: true })
  getPickupLocation(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('locationId') locationId: string,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(async () => {
      const adminActor = this.adminActor(actor, request, ip);
      await this.assertPickupLocationMarket(
        locationId,
        adminActor.currentMarketId,
      );
      return this.redemption.getPickupLocation(adminActor, locationId);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * P6-R2 (D-055): resource-market consistency. Routes without a market in
   * the URL still resolve the server-owned Current Admin Market through the
   * canonical RbacGuard; the targeted resource must belong to that market
   * (requirement: resource market == Current Admin Market). A resource that
   * does not exist is left to the owner to 404; a resource in another market
   * is rejected 409 so the admin switches market instead of acting
   * cross-market.
   */
  private async assertCatalogItemMarket(
    itemId: string,
    currentMarketId: string | undefined,
  ): Promise<void> {
    if (!currentMarketId) throw this.marketMismatch();
    const rows = await this.database.db.execute(
      sql`SELECT market_id FROM redemption_catalog_items WHERE id = ${itemId}`,
    );
    const marketId = rows.rows[0]?.market_id as string | undefined;
    if (marketId && marketId !== currentMarketId) {
      throw this.marketMismatch();
    }
  }

  private async assertPickupLocationMarket(
    locationId: string,
    currentMarketId: string | undefined,
  ): Promise<void> {
    if (!currentMarketId) throw this.marketMismatch();
    const rows = await this.database.db.execute(
      sql`SELECT market_id FROM redemption_pickup_locations WHERE id = ${locationId}`,
    );
    const marketId = rows.rows[0]?.market_id as string | undefined;
    if (marketId && marketId !== currentMarketId) {
      throw this.marketMismatch();
    }
  }

  private marketMismatch(): ConflictException {
    return new ConflictException({
      code: 'MARKET_CONTEXT_MISMATCH',
      message: 'The selected market changed. Refresh and try again.',
    });
  }

  private adminActor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): RedemptionAdminActor {
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
        code: 'REDEMPTION_RATE_IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
    return key;
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof RedemptionError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'REDEMPTION_CATALOG_ITEM_NOT_FOUND':
        case 'REDEMPTION_RATE_NOT_FOUND':
        case 'REDEMPTION_RATE_MARKET_NOT_FOUND':
        case 'REDEMPTION_PICKUP_LOCATION_NOT_FOUND':
        case 'REDEMPTION_QUOTE_NOT_FOUND':
        case 'REDEMPTION_SHIPPING_PAYMENT_NOT_FOUND':
          throw new NotFoundException(body);
        case 'REDEMPTION_RATE_PERMISSION_DENIED':
        case 'REDEMPTION_RATE_MARKET_ACCESS_DENIED':
          throw new ForbiddenException(body);
        case 'REDEMPTION_CATALOG_SKU_DUPLICATE':
        case 'REDEMPTION_RATE_OVERLAP':
        case 'REDEMPTION_CATALOG_ITEM_VERSION_CONFLICT':
        case 'REDEMPTION_RATE_CANNOT_MODIFY_HISTORICAL':
        case 'REDEMPTION_IDEMPOTENCY_MISMATCH':
        case 'REDEMPTION_RATE_IDEMPOTENCY_CONFLICT':
        case 'REDEMPTION_RATE_MARKET_SELECTION_REQUIRED':
        case 'REDEMPTION_RATE_MARKET_CONTEXT_MISMATCH':
        case 'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE':
        case 'REDEMPTION_RATE_ALREADY_CANCELLED':
          throw new ConflictException(body);
        case 'REDEMPTION_RATE_REASON_REQUIRED':
        case 'REDEMPTION_RATE_IDEMPOTENCY_KEY_REQUIRED':
        case 'REDEMPTION_INVALID_STATUS':
          throw new BadRequestException(body);
        case 'REDEMPTION_RATE_PRECISION_EXCEEDED':
        case 'REDEMPTION_RATE_MARKET_BLOCKED':
        case 'REDEMPTION_RATE_BELOW_MINIMUM':
        case 'REDEMPTION_RATE_ABOVE_MAXIMUM':
        case 'REDEMPTION_RATE_CURRENCY_MISMATCH':
        case 'REDEMPTION_RATE_ACTIVATION_NOT_FUTURE':
          throw new UnprocessableEntityException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

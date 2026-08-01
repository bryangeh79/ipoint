import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Ip,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
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
} from './redemption.dto.js';
import {
  createCatalogItemSchema,
  updateCatalogItemSchema,
  setCatalogStatusSchema,
  createRateVersionSchema,
  cancelRateVersionSchema,
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
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  // CATALOG ITEMS
  // ═══════════════════════════════════════════════════════════════════════

  @Post('catalog')
  @RequirePermission('redemption.catalog.manage')
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
  @RequirePermission('redemption.catalog.manage')
  updateItem(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(updateCatalogItemSchema))
    body: unknown,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.updateCatalogItem(
        this.adminActor(actor, request, ip),
        itemId,
        body as Parameters<RedemptionService['updateCatalogItem']>[2],
      ),
    );
  }

  @Post('catalog/:itemId/status')
  @RequirePermission('redemption.catalog.manage')
  @HttpCode(200)
  setStatus(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(setCatalogStatusSchema))
    body: unknown,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.setCatalogStatus(
        this.adminActor(actor, request, ip),
        itemId,
        body as Parameters<RedemptionService['setCatalogStatus']>[2],
      ),
    );
  }

  @Get('market/:marketId/catalog')
  @RequirePermission('redemption.catalog.manage')
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
  @RequirePermission('redemption.catalog.manage')
  getItem(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('itemId') itemId: string,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.getCatalogItem(
        this.adminActor(actor, request, ip),
        itemId,
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RATE VERSIONS
  // ═══════════════════════════════════════════════════════════════════════

  @Post('market/:marketId/rates')
  @RequirePermission('redemption.rate.manage')
  createRate(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('marketId') marketId: string,
    @Body(new ZodValidationPipe(createRateVersionSchema))
    body: unknown,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.createRateVersion(this.adminActor(actor, request, ip), {
        ...(body as Record<string, unknown>),
        marketId,
      } as Parameters<RedemptionService['createRateVersion']>[1]),
    );
  }

  @Get('market/:marketId/rates')
  @RequirePermission('redemption.rate.manage')
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
  @RequirePermission('redemption.rate.manage')
  @HttpCode(200)
  cancelRate(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('rateId') rateId: string,
    @Body(new ZodValidationPipe(cancelRateVersionSchema))
    body: unknown,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.cancelRateVersion(
        this.adminActor(actor, request, ip),
        rateId,
        body as Parameters<RedemptionService['cancelRateVersion']>[2],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PICKUP LOCATIONS
  // ═══════════════════════════════════════════════════════════════════════

  @Post('market/:marketId/pickup-locations')
  @RequirePermission('redemption.catalog.manage')
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
  @RequirePermission('redemption.catalog.manage')
  updatePickupLocation(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('locationId') locationId: string,
    @Body(new ZodValidationPipe(updatePickupLocationSchema))
    body: unknown,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.updatePickupLocation(
        this.adminActor(actor, request, ip),
        locationId,
        body as Record<string, unknown>,
      ),
    );
  }

  @Get('market/:marketId/pickup-locations')
  @RequirePermission('redemption.catalog.manage')
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
  @RequirePermission('redemption.catalog.manage')
  getPickupLocation(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('locationId') locationId: string,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.redemption.getPickupLocation(
        this.adminActor(actor, request, ip),
        locationId,
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════

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
    return {
      adminUserId: actor.adminUserId,
      ipAddress,
      ...(typeof requestId === 'string' ? { requestId } : {}),
    };
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
        case 'REDEMPTION_PICKUP_LOCATION_NOT_FOUND':
        case 'REDEMPTION_QUOTE_NOT_FOUND':
        case 'REDEMPTION_SHIPPING_PAYMENT_NOT_FOUND':
          throw new NotFoundException(body);
        case 'REDEMPTION_CATALOG_SKU_DUPLICATE':
        case 'REDEMPTION_RATE_OVERLAP':
        case 'REDEMPTION_CATALOG_ITEM_VERSION_CONFLICT':
        case 'REDEMPTION_RATE_CANNOT_MODIFY_HISTORICAL':
        case 'REDEMPTION_IDEMPOTENCY_MISMATCH':
          throw new ConflictException(body);
        default:
          throw new ConflictException(body);
      }
    }
  }
}

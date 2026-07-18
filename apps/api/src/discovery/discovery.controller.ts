import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  merchantListQuerySchema,
  merchantNearbyQuerySchema,
} from './discovery.dto.js';
import type {
  MerchantListQuery,
  MerchantNearbyQuery,
} from './discovery.dto.js';
import { DiscoveryService } from './discovery.service.js';
import { MerchantDiscoveryError } from './discovery.types.js';
import type {
  CategoryResponse,
  MerchantDetailResponse,
  MerchantListItemResponse,
  PaginatedResponse,
} from './discovery.types.js';

@ApiTags('Merchant Discovery')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('members')
export class DiscoveryController {
  constructor(
    @Inject(DiscoveryService)
    private readonly discoveryService: DiscoveryService,
  ) {}

  private async handleDiscoveryError<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof MerchantDiscoveryError) {
        const body = { code: error.code, message: error.message };
        if (error.code === 'DISCOVERY_MERCHANT_NOT_FOUND') {
          throw new NotFoundException(body);
        }
        throw new BadRequestException(body);
      }
      throw error;
    }
  }

  @Get('merchants')
  @ApiOperation({ summary: 'List merchants in the current market' })
  @ApiResponse({ status: 200, description: 'Merchant list returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  listMerchants(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(merchantListQuerySchema))
    query: MerchantListQuery,
  ): Promise<PaginatedResponse<MerchantListItemResponse>> {
    return this.handleDiscoveryError(() =>
      this.discoveryService.listMerchants(actor.accountId, query),
    );
  }

  @Get('merchants/nearby')
  @ApiOperation({ summary: 'Find nearby merchants in the current market' })
  @ApiResponse({ status: 200, description: 'Nearby merchants returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  findNearby(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(merchantNearbyQuerySchema))
    query: MerchantNearbyQuery,
  ): Promise<PaginatedResponse<MerchantListItemResponse>> {
    return this.handleDiscoveryError(() =>
      this.discoveryService.findNearby(
        actor.accountId,
        query.latitude,
        query.longitude,
        query.radius,
        query,
      ),
    );
  }

  @Get('merchant-categories')
  @ApiOperation({ summary: 'List merchant categories in the current market' })
  @ApiResponse({ status: 200, description: 'Categories returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getCategories(
    @CurrentActor() actor: RequestActor,
  ): Promise<CategoryResponse[]> {
    return this.handleDiscoveryError(() =>
      this.discoveryService.getCategories(actor.accountId),
    );
  }

  @Get('merchants/:merchantId')
  @ApiOperation({ summary: 'Get public merchant detail in the current market' })
  @ApiResponse({ status: 200, description: 'Merchant detail returned.' })
  @ApiResponse({ status: 404, description: 'Merchant not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getMerchant(
    @CurrentActor() actor: RequestActor,
    @Param('merchantId') merchantId: string,
  ): Promise<MerchantDetailResponse> {
    return this.handleDiscoveryError(() =>
      this.discoveryService.getMerchant(actor.accountId, merchantId),
    );
  }
}

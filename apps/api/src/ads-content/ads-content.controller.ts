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
  Patch,
  Post,
  Query,
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
  adsContentListQuerySchema,
  createAdSchema,
  createArticleSchema,
  createPlacementSchema,
  transitionSchema,
  updateAdSchema,
  updateArticleSchema,
  type AdsContentListQueryDto,
  type CreateAdDto,
  type CreateArticleDto,
  type CreatePlacementDto,
  type TransitionDto,
  type UpdateAdDto,
  type UpdateArticleDto,
} from './ads-content.dto.js';
import { AdsContentService } from './ads-content.service.js';
import { AdsContentError, type AdsContentActor } from './ads-content.types.js';

@ApiTags('Admin Ads & Content Operations')
@ApiBearerAuth()
@Controller('admin/ads-content')
@UseGuards(AuthGuard, RbacGuard)
export class AdminAdsContentController {
  constructor(
    @Inject(AdsContentService) private readonly service: AdsContentService,
  ) {}

  @Get('markets/:marketId/placements')
  @RequirePermission('ads.view', { marketScoped: true })
  @ApiOperation({ summary: 'List selected-market ad placements.' })
  listPlacements(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.listPlacements(this.actor(actor, request, ip), marketId),
    );
  }

  @Post('markets/:marketId/placements')
  @RequirePermission('ads.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Create a selected-market ad placement.' })
  @ApiResponse({ status: 201, description: 'Placement created and audited.' })
  createPlacement(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Body(new ZodValidationPipe(createPlacementSchema))
    input: CreatePlacementDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.createPlacement(
        this.actor(actor, request, ip),
        marketId,
        input,
        this.key(key),
      ),
    );
  }

  @Get('markets/:marketId/ads')
  @RequirePermission('ads.view', { marketScoped: true })
  @ApiOperation({ summary: 'List selected-market ads.' })
  listAds(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(adsContentListQuerySchema))
    query: AdsContentListQueryDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.listAds(this.actor(actor, request, ip), marketId, query),
    );
  }

  @Get('markets/:marketId/ads/:adId')
  @RequirePermission('ads.view', { marketScoped: true })
  @ApiOperation({ summary: 'Get one selected-market ad.' })
  getAd(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('adId', new ParseUUIDPipe()) adId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.getAd(this.actor(actor, request, ip), marketId, adId),
    );
  }

  @Post('markets/:marketId/ads')
  @RequirePermission('ads.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Create a DRAFT ad.' })
  createAd(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Body(new ZodValidationPipe(createAdSchema)) input: CreateAdDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.createAd(
        this.actor(actor, request, ip),
        marketId,
        input,
        this.key(key),
      ),
    );
  }

  @Patch('markets/:marketId/ads/:adId')
  @RequirePermission('ads.manage', { marketScoped: true })
  @ApiOperation({
    summary: 'Update ad creative or schedule with optimistic versioning.',
  })
  updateAd(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('adId', new ParseUUIDPipe()) adId: string,
    @Body(new ZodValidationPipe(updateAdSchema)) input: UpdateAdDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.updateAd(
        this.actor(actor, request, ip),
        marketId,
        adId,
        input,
        this.key(key),
      ),
    );
  }

  @Post('markets/:marketId/ads/:adId/status')
  @HttpCode(200)
  @RequirePermission('ads.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Apply one validated ad lifecycle transition.' })
  transitionAd(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('adId', new ParseUUIDPipe()) adId: string,
    @Body(new ZodValidationPipe(transitionSchema)) input: TransitionDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.transitionAd(
        this.actor(actor, request, ip),
        marketId,
        adId,
        input,
        this.key(key),
      ),
    );
  }

  @Get('markets/:marketId/articles')
  @RequirePermission('content.view', { marketScoped: true })
  @ApiOperation({ summary: 'List selected-market content articles.' })
  listArticles(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(adsContentListQuerySchema))
    query: AdsContentListQueryDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.listArticles(
        this.actor(actor, request, ip),
        marketId,
        query,
      ),
    );
  }

  @Get('markets/:marketId/articles/:articleId')
  @RequirePermission('content.view', { marketScoped: true })
  @ApiOperation({ summary: 'Get one selected-market content article.' })
  getArticle(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('articleId', new ParseUUIDPipe()) articleId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.getArticle(
        this.actor(actor, request, ip),
        marketId,
        articleId,
      ),
    );
  }

  @Post('markets/:marketId/articles')
  @RequirePermission('content.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Create a DRAFT content article.' })
  createArticle(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Body(new ZodValidationPipe(createArticleSchema)) input: CreateArticleDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.createArticle(
        this.actor(actor, request, ip),
        marketId,
        input,
        this.key(key),
      ),
    );
  }

  @Patch('markets/:marketId/articles/:articleId')
  @RequirePermission('content.manage', { marketScoped: true })
  @ApiOperation({
    summary: 'Update content or schedule with optimistic versioning.',
  })
  updateArticle(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('articleId', new ParseUUIDPipe()) articleId: string,
    @Body(new ZodValidationPipe(updateArticleSchema)) input: UpdateArticleDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.updateArticle(
        this.actor(actor, request, ip),
        marketId,
        articleId,
        input,
        this.key(key),
      ),
    );
  }

  @Post('markets/:marketId/articles/:articleId/status')
  @HttpCode(200)
  @RequirePermission('content.manage', { marketScoped: true })
  @ApiOperation({
    summary: 'Apply one validated content lifecycle transition.',
  })
  transitionArticle(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('articleId', new ParseUUIDPipe()) articleId: string,
    @Body(new ZodValidationPipe(transitionSchema)) input: TransitionDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.transitionArticle(
        this.actor(actor, request, ip),
        marketId,
        articleId,
        input,
        this.key(key),
      ),
    );
  }

  private actor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): AdsContentActor {
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId)
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'Admin authorization is required.',
      });
    const requestId = (request as unknown as Record<string, unknown>)[
      'requestId'
    ];
    const context = (
      request as Request & { adminMarketContext?: { marketId: string } }
    ).adminMarketContext;
    return {
      adminUserId: actor.adminUserId,
      currentMarketId: context?.marketId,
      ipAddress,
      ...(typeof requestId === 'string' ? { requestId } : {}),
    };
  }

  private key(value: string | undefined): string {
    if (!value || value.length > 200)
      throw new BadRequestException({
        code: 'ADS_CONTENT_IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    return value;
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AdsContentError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'ADS_CONTENT_NOT_FOUND':
          throw new NotFoundException(body);
        case 'ADS_CONTENT_MARKET_MISMATCH':
          throw new ForbiddenException(body);
        case 'ADS_CONTENT_INVALID_SCHEDULE':
        case 'ADS_CONTENT_INVALID_CONTENT':
        case 'ADS_CONTENT_IDEMPOTENCY_KEY_REQUIRED':
          throw new BadRequestException(body);
        case 'ADS_CONTENT_INVALID_TRANSITION':
        case 'ADS_CONTENT_STALE_VERSION':
        case 'ADS_CONTENT_IDEMPOTENCY_CONFLICT':
        case 'ADS_CONTENT_DUPLICATE':
          throw new ConflictException(body);
        case 'ADS_CONTENT_PLACEMENT_INACTIVE':
        case 'ADS_CONTENT_FEE_CONFIG_UNAVAILABLE':
          throw new BadRequestException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

@ApiTags('Member Ads & Content')
@ApiBearerAuth()
@Controller('members/content')
@UseGuards(AuthGuard)
export class MemberAdsContentController {
  constructor(
    @Inject(AdsContentService) private readonly service: AdsContentService,
  ) {}

  @Get('home')
  @ApiOperation({
    summary: 'Read ACTIVE ads and content for the member Current Market.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current-market home content with explicit sponsor labels.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  home(@CurrentActor() actor: RequestActor) {
    return this.service.memberHome(actor.accountId);
  }
}

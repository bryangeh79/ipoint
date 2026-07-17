import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { updateMarketSchema } from './market.dto.js';
import { MarketService } from './market.service.js';
import { MarketError } from './market.types.js';
import type { UpdateMarketDto } from './market.dto.js';
import type { MemberMarketResponse } from './market.types.js';

@ApiTags('Market')
@Controller('members/me/market')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class MarketController {
  constructor(
    @Inject(MarketService) private readonly marketService: MarketService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get current market and enabled markets',
    description:
      'Returns the current market and all enabled markets for the authenticated member.',
  })
  @ApiResponse({ status: 200, description: 'Markets returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getMarket(
    @CurrentActor() actor: RequestActor,
  ): Promise<MemberMarketResponse> {
    try {
      return await this.marketService.getMarket(actor.accountId);
    } catch (e) {
      if (e instanceof MarketError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  @Patch()
  @ApiOperation({
    summary: 'Switch current market',
    description: 'Changes the current market for the authenticated member.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { marketId: { type: 'string', format: 'uuid' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Market updated.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateMarket(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(updateMarketSchema)) body: UpdateMarketDto,
  ): Promise<MemberMarketResponse> {
    try {
      return await this.marketService.updateMarket(
        actor.accountId,
        body.marketId,
      );
    } catch (e) {
      if (e instanceof MarketError) throw new BadRequestException(e.message);
      throw e;
    }
  }
}

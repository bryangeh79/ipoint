import {
  Body,
  Controller,
  Get,
  Inject,
  Ip,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  selectCurrentMarketSchema,
  type SelectCurrentMarketDto,
} from './access-administration.dto.js';
import { AdminMarketContextService } from './admin-market-context.service.js';
import { RbacGuard, RequirePermission } from './rbac.guard.js';

@ApiTags('Current Admin Market')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(AuthGuard)
export class AdminMarketContextController {
  constructor(
    @Inject(AdminMarketContextService)
    private readonly context: AdminMarketContextService,
  ) {}

  @Get('me/markets')
  accessibleMarkets(@CurrentActor() actor: RequestActor) {
    return this.context.accessibleMarkets(actor);
  }

  @Get('bootstrap')
  bootstrap(@CurrentActor() actor: RequestActor) {
    return this.context.bootstrap(actor);
  }

  @Put('me/current-market')
  @UseGuards(RbacGuard)
  @RequirePermission('admin.market.select', { marketScoped: false })
  selectCurrentMarket(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(selectCurrentMarketSchema))
    input: SelectCurrentMarketDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    const requestId = (request as unknown as Record<string, unknown>)[
      'requestId'
    ];
    return this.context.selectCurrentMarket(
      actor,
      {
        marketId: input.market_id,
        expectedContextVersion: input.expected_context_version,
      },
      {
        adminUserId: actor.adminUserId!,
        requestId: typeof requestId === 'string' ? requestId : undefined,
        ipAddress,
        userAgent: request.headers['user-agent'],
      },
    );
  }
}

import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
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
  planListQuerySchema,
  ruleListQuerySchema,
  type PlanListQueryDto,
  type RuleListQueryDto,
} from './reward.dto.js';
import { RewardError } from './reward.types.js';
import { RewardService } from './reward.service.js';

@ApiTags('Rewards')
@Controller({ path: 'rewards', version: '1' })
export class RewardController {
  constructor(@Inject(RewardService) private readonly reward: RewardService) {}

  // ─── Member endpoints ─────────────────────────────────────────────

  @Get('plans')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List reward plans for the authenticated member' })
  @ApiResponse({ status: 200, description: 'Paginated list of reward plans.' })
  async listMemberPlans(
    @CurrentActor() actor: RequestActor,
    @Query(new ZodValidationPipe(planListQuerySchema)) query: PlanListQueryDto,
  ) {
    return this.handle(() => {
      const { memberId } = this.extractMemberActor(actor);
      return this.reward.getMemberPlans(memberId, query);
    });
  }

  @Get('plans/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get reward plan detail' })
  @ApiResponse({ status: 200, description: 'Reward plan detail.' })
  async getPlan(@Param('id') id: string) {
    return this.handle(() => this.reward.getPlan(id));
  }

  // ─── Admin Rule Version endpoints ──────────────────────────────────

  @Get('rules')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List reward rule versions (admin)' })
  @ApiResponse({ status: 200, description: 'Paginated list of rule versions.' })
  async listRules(
    @Query(new ZodValidationPipe(ruleListQuerySchema)) query: RuleListQueryDto,
  ) {
    return this.handle(() => this.reward.getRuleVersions(query));
  }

  @Get('rules/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get reward rule version detail' })
  @ApiResponse({ status: 200, description: 'Rule version detail.' })
  async getRule(@Param('id') id: string) {
    return this.handle(() => this.reward.getRuleVersion(id));
  }

  // ─── Error Handling ────────────────────────────────────────────────

  private extractMemberActor(actor: RequestActor): {
    accountId: string;
    memberId: string;
  } {
    if (actor.type !== 'ACCOUNT') {
      throw new BadRequestException({
        code: 'REWARD_NOT_ALLOWED',
        message: 'Only member accounts can perform this action.',
      });
    }
    const memberId = (actor as unknown as Record<string, string>).memberId!;
    return { accountId: actor.accountId, memberId };
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof RewardError)) throw error;

      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };

      switch (error.code) {
        case 'REWARD_PLAN_NOT_FOUND':
        case 'REWARD_RULE_VERSION_NOT_FOUND':
        case 'REWARD_SOURCE_NOT_FOUND':
          throw new NotFoundException(body);
        case 'REWARD_PLAN_DUPLICATE':
        case 'REWARD_SOURCE_DUPLICATE':
        case 'REWARD_SOURCE_ALREADY_CONSUMED':
          throw new ConflictException(body);
        case 'REWARD_PLAN_INVALID_STATE':
        case 'REWARD_RULE_NO_EFFECTIVE_VERSION':
          throw new HttpException(body, HttpStatus.UNPROCESSABLE_ENTITY);
        case 'REWARD_MARKET_ACCESS_DENIED':
          throw new HttpException(body, HttpStatus.FORBIDDEN);
        default:
          throw new HttpException(body, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
  }
}

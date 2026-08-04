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
  createRewardRuleSchema,
  type CreateRewardRuleDto,
} from './admin-reward-ops.dto.js';
import { AdminRewardOpsError } from './admin-reward-ops.types.js';
import { AdminRewardOpsService } from './admin-reward-ops.service.js';
import type {
  AdminRewardOpsActor,
  AdminRewardRuleCreateResponse,
  AdminRewardRuleListResponse,
} from './admin-reward-ops.types.js';

/**
 * P7-S6B Admin Reward Configuration adapter endpoints (frozen contract
 * §7.1, decisions P7-OD-04 / P7-OD-05).
 *
 * - `GET .../rules` — selected-market reward schedule projection
 *   (`reward.rule.read`, all admin roles, marketScoped): every rule
 *   version for the server-owned Current Admin Market with exact `%/day`
 *   decimal strings, the §7.1 package references, and the projected
 *   effective windows in market-local time AND resolved UTC.
 * - `POST .../rules` — schedule a new rule version (`reward.rule.schedule`,
 *   SUPER_ADMIN only, marketScoped, mandatory Idempotency-Key + reason).
 *   The adapter validates the §7.1 range/precision/package maxima and the
 *   future market-local 00:00 activation, serializes overlap with an
 *   advisory lock, then delegates the single insert to the frozen Phase 3
 *   owner command unchanged.
 *
 * The market contract is enforced by the canonical RbacGuard
 * (`marketScoped`): the URL market must equal the server-owned Current
 * Admin Market and the actor must hold the market grant; any client-
 * supplied market disagreement returns 409 `MARKET_CONTEXT_MISMATCH`.
 */
@ApiTags('Admin Reward Operations')
@ApiBearerAuth()
@Controller('admin/reward-ops')
@UseGuards(AuthGuard, RbacGuard)
export class AdminRewardOpsController {
  constructor(
    @Inject(AdminRewardOpsService)
    private readonly ops: AdminRewardOpsService,
  ) {}

  @Get('markets/:marketId/rules')
  @RequirePermission('reward.rule.read', { marketScoped: true })
  @ApiOperation({
    summary: 'Selected-market reward schedule with package references.',
    description:
      'Read-only projection of the frozen Phase 3 reward rule versions for the server-owned Current Admin Market. Rates are exact decimal strings in %/day; every version shows the market-local activation time AND the resolved UTC. §7.1 package references (A 0.0125, B 0.025, C/D/E/F 0.05 %/day maxima) are included for the configuration surface. Writing stays on the POST endpoint, which delegates to the frozen Phase 3 owner command.',
  })
  @ApiResponse({ status: 200, description: 'Reward schedule.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({ status: 409, description: 'Market context mismatch.' })
  listRules(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
  ): Promise<AdminRewardRuleListResponse> {
    return this.ops.listRules(marketId);
  }

  @Post('markets/:marketId/rules')
  @RequirePermission('reward.rule.schedule', { marketScoped: true })
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Schedule a reward rule version (Super Admin; future market-local 00:00 only).',
    description:
      'Validates the §7.1 rate contract (0%–0.05%/day, at most six decimals, package A–F maxima), requires a strictly future market-local 00:00 activation (market-local AND resolved UTC are returned), rejects overlapping effective windows, and delegates the insert to the frozen Phase 3 owner command. The Idempotency-Key header is mandatory: same key + same payload replays the original result; same key + different payload returns 409. The reason is mandatory and recorded in the privileged audit trail.',
  })
  @ApiResponse({ status: 201, description: 'Rule version scheduled.' })
  @ApiResponse({ status: 400, description: 'Invalid body or missing key.' })
  @ApiResponse({
    status: 409,
    description: 'Overlap, idempotency conflict, or market context mismatch.',
  })
  @ApiResponse({
    status: 422,
    description:
      'Rate range/precision/package maximum or activation-time violation.',
  })
  createRule(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createRewardRuleSchema))
    input: CreateRewardRuleDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminRewardRuleCreateResponse> {
    return this.handle(() =>
      this.ops.createRule(
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
  ): AdminRewardOpsActor {
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action.',
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

  private requireIdempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (!key || key.length > 200) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
    return key;
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AdminRewardOpsError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'REWARD_MARKET_NOT_FOUND':
        case 'REWARD_RULE_VERSION_NOT_FOUND':
          throw new NotFoundException(body);
        case 'REWARD_RATE_OUT_OF_RANGE':
        case 'REWARD_RATE_PRECISION_EXCEEDED':
        case 'REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT':
        case 'REWARD_RATE_EXCEEDS_PACKAGE_MAX':
        case 'REWARD_ACTIVATION_NOT_FUTURE':
          throw new UnprocessableEntityException(body);
        case 'REWARD_EFFECTIVE_WINDOW_OVERLAP':
        case 'REWARD_IDEMPOTENCY_CONFLICT':
          throw new ConflictException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

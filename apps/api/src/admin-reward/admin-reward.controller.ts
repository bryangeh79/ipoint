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
  Query,
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
  createRuleVersionSchema,
  jobListQuerySchema,
  ruleListQuerySchema,
  type CreateRuleVersionDto,
  type JobListQueryDto,
  type RuleListQueryDto,
} from './admin-reward.dto.js';
import { AdminRewardService } from './admin-reward.service.js';
import { AdminRewardError } from './admin-reward.types.js';
import type {
  AdminRewardActor,
  AdminRewardJobRunDetailResponse,
  AdminRewardJobRunListResponse,
  AdminRewardRuleVersionCreateResponse,
  AdminRewardRuleVersionDetailResponse,
  AdminRewardRuleVersionListResponse,
  AdminRewardVersionHistoryResponse,
} from './admin-reward.types.js';

/**
 * Secured Phase 3 reward-rule owner endpoints (D-052/D-050).
 *
 * The canonical RbacGuard enforces the `reward.rule.schedule` permission
 * (SUPER_ADMIN only, marketScoped) and the server Current Admin Market at
 * the transport boundary; the owner service re-enforces identity,
 * permission, selected market, resource-market consistency, rate bounds,
 * future market-local activation, idempotency, overlap, reason and audit
 * INSIDE the command so no in-process caller can bypass them.
 */
@ApiTags('Admin Rewards')
@ApiBearerAuth()
@Controller('admin/rewards')
@UseGuards(AuthGuard, RbacGuard)
export class AdminRewardController {
  constructor(
    @Inject(AdminRewardService)
    private readonly adminReward: AdminRewardService,
  ) {}

  // ─── Rule Version Endpoints ────────────────────────────────────────

  @Get('rules')
  @RequirePermission('reward.rule.read')
  @ApiOperation({ summary: 'List reward rule versions' })
  @ApiResponse({ status: 200, description: 'Paginated list of rule versions.' })
  listRuleVersions(
    @CurrentActor() actor: RequestActor | undefined,
    @Query(new ZodValidationPipe(ruleListQuerySchema)) query: RuleListQueryDto,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminRewardRuleVersionListResponse> {
    return this.handle(() =>
      this.adminReward.listRuleVersions(
        this.adminActor(actor, request, ip),
        query,
      ),
    );
  }

  @Get('rules/:id')
  @RequirePermission('reward.rule.read')
  @ApiOperation({ summary: 'Get reward rule version detail' })
  @ApiResponse({
    status: 200,
    description: 'Rule version detail with version history.',
  })
  getRuleVersion(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminRewardRuleVersionDetailResponse> {
    return this.handle(() =>
      this.adminReward.getRuleVersion(this.adminActor(actor, request, ip), id),
    );
  }

  @Post('rules')
  @RequirePermission('reward.rule.schedule')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a new reward rule version (secured owner command)',
    description:
      'Secured Phase 3 reward-rule owner command. The Idempotency-Key header is mandatory (same key + same payload replays the original result; same key + different payload returns 409). A reason between 1 and 500 characters is required and stored durably on the version row. The reward rate must be an exact %/day decimal between 0% and 0.05% with at most six decimals. Activation must be at a strictly future market-local 00:00 in the selected market timezone; the response returns the resolved UTC instant AND the market-local wall time. Effective windows are strictly increasing per market (append-only, no overlap).',
  })
  @ApiResponse({
    status: 201,
    description: 'Rule version created with local + UTC activation times.',
  })
  @ApiResponse({ status: 400, description: 'Invalid body, reason, or key.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({
    status: 409,
    description: 'Market context mismatch, overlap, or idempotency conflict.',
  })
  @ApiResponse({
    status: 422,
    description: 'Rate range/precision or activation-time violation.',
  })
  createRuleVersion(
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createRuleVersionSchema))
    input: CreateRuleVersionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminRewardRuleVersionCreateResponse> {
    return this.handle(() =>
      this.adminReward.createRuleVersion(this.adminActor(actor, request, ip), {
        ...input,
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      }),
    );
  }

  @Get('rules/:id/versions')
  @RequirePermission('reward.rule.read')
  @ApiOperation({ summary: 'Get version history for a reward rule' })
  @ApiResponse({ status: 200, description: 'Version history.' })
  getRuleVersionHistory(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminRewardVersionHistoryResponse> {
    return this.handle(() =>
      this.adminReward.getRuleVersionHistory(
        this.adminActor(actor, request, ip),
        id,
      ),
    );
  }

  // ─── Job Run Monitoring ────────────────────────────────────────────

  @Get('jobs')
  @RequirePermission('reward.job.read')
  @ApiOperation({ summary: 'List reward job runs' })
  @ApiResponse({ status: 200, description: 'Paginated list of job runs.' })
  listJobRuns(
    @CurrentActor() actor: RequestActor | undefined,
    @Query(new ZodValidationPipe(jobListQuerySchema)) query: JobListQueryDto,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminRewardJobRunListResponse> {
    return this.handle(() =>
      this.adminReward.listJobRuns(this.adminActor(actor, request, ip), query),
    );
  }

  @Get('jobs/:id')
  @RequirePermission('reward.job.read')
  @ApiOperation({ summary: 'Get reward job run detail' })
  @ApiResponse({ status: 200, description: 'Job run detail with results.' })
  getJobRunDetail(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminRewardJobRunDetailResponse> {
    return this.handle(() =>
      this.adminReward.getJobRunDetail(this.adminActor(actor, request, ip), id),
    );
  }

  // ─── Actor Extraction ──────────────────────────────────────────────

  private adminActor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): AdminRewardActor {
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
        code: 'ADMIN_REWARD_IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
    return key;
  }

  // ─── Error Handling ────────────────────────────────────────────────

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AdminRewardError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'ADMIN_REWARD_RULE_VERSION_NOT_FOUND':
        case 'ADMIN_REWARD_JOB_NOT_FOUND':
        case 'ADMIN_REWARD_MARKET_NOT_FOUND':
          throw new NotFoundException(body);
        case 'ADMIN_REWARD_MARKET_ACCESS_DENIED':
        case 'ADMIN_REWARD_PERMISSION_DENIED':
          throw new ForbiddenException(body);
        case 'ADMIN_REWARD_RULE_VERSION_ARCHIVED':
        case 'ADMIN_REWARD_IDEMPOTENCY_CONFLICT':
        case 'ADMIN_REWARD_MARKET_CONTEXT_MISMATCH':
        case 'ADMIN_REWARD_MARKET_SELECTION_REQUIRED':
        case 'ADMIN_REWARD_EFFECTIVE_WINDOW_OVERLAP':
          throw new ConflictException(body);
        case 'ADMIN_REWARD_IDEMPOTENCY_KEY_REQUIRED':
        case 'ADMIN_REWARD_REASON_REQUIRED':
          throw new BadRequestException(body);
        case 'ADMIN_REWARD_RATE_PRECISION_EXCEEDED':
        case 'ADMIN_REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT':
        case 'ADMIN_REWARD_ACTIVATION_NOT_FUTURE':
          throw new UnprocessableEntityException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

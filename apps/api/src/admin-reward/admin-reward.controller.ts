import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
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
  walletAdjustmentSchema,
  type CreateRuleVersionDto,
  type JobListQueryDto,
  type RuleListQueryDto,
  type WalletAdjustmentDto,
} from './admin-reward.dto.js';
import { AdminRewardService } from './admin-reward.service.js';
import { AdminRewardError } from './admin-reward.types.js';
import type {
  AdminRewardActor,
  AdminRewardJobRunDetailResponse,
  AdminRewardJobRunListResponse,
  AdminRewardRuleVersionDetailResponse,
  AdminRewardRuleVersionListResponse,
  AdminRewardVersionHistoryResponse,
  AdminWalletAdjustmentResponse,
} from './admin-reward.types.js';

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
  @RequirePermission('reward.rule.create')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new reward rule version' })
  @ApiResponse({ status: 201, description: 'Rule version created.' })
  createRuleVersion(
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createRuleVersionSchema))
    input: CreateRuleVersionDto,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminRewardRuleVersionListResponse['items'][number]> {
    return this.handle(() =>
      this.adminReward.createRuleVersion(
        this.adminActor(actor, request, ip),
        input,
      ),
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

  // ─── Wallet Adjustment ─────────────────────────────────────────────

  @Post('wallets/:id/adjustment')
  @RequirePermission('wallet.adjustment.create')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Request a wallet balance adjustment via ledger entry',
  })
  @ApiResponse({
    status: 201,
    description: 'Adjustment created as ledger entry.',
  })
  requestWalletAdjustment(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(walletAdjustmentSchema))
    input: WalletAdjustmentDto,
    @Ip() ip: string,
    @Req() request: Request,
  ): Promise<AdminWalletAdjustmentResponse> {
    return this.handle(() =>
      this.adminReward.requestWalletAdjustment(
        this.adminActor(actor, request, ip),
        id,
        input,
      ),
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
    return {
      adminUserId: actor.adminUserId,
      ipAddress,
      ...(typeof requestId === 'string' ? { requestId } : {}),
    };
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
        case 'ADMIN_REWARD_WALLET_NOT_FOUND':
        case 'ADMIN_REWARD_ADJUSTMENT_NOT_FOUND':
          throw new NotFoundException(body);
        case 'ADMIN_REWARD_MARKET_ACCESS_DENIED':
          throw new ForbiddenException(body);
        case 'ADMIN_REWARD_RULE_VERSION_ARCHIVED':
        case 'ADMIN_REWARD_ADJUSTMENT_INVALID_AMOUNT':
        case 'ADMIN_REWARD_IDEMPOTENCY_CONFLICT':
          throw new ConflictException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

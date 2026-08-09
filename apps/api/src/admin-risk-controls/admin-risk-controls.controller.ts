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
  assignQueueSchema,
  createDefinitionSchema,
  createRunSchema,
  decideQueueSchema,
  listDefinitionsQuerySchema,
  listEventsQuerySchema,
  listQueueQuerySchema,
  listRunsQuerySchema,
  queueActionSchema,
  queueNotesSchema,
  type AssignQueueDto,
  type CreateDefinitionDto,
  type CreateRunDto,
  type DecideQueueDto,
  type ListDefinitionsQueryDto,
  type ListEventsQueryDto,
  type ListQueueQueryDto,
  type ListRunsQueryDto,
  type QueueActionDto,
  type QueueNotesDto,
} from './admin-risk-controls.dto.js';
import { AdminRiskControlsService } from './admin-risk-controls.service.js';
import { RiskError, type RiskActor } from './admin-risk-controls.types.js';

@ApiTags('Admin Risk / Fraud / Operational Controls')
@ApiBearerAuth()
@Controller('admin/risk-controls')
@UseGuards(AuthGuard, RbacGuard)
export class AdminRiskControlsController {
  constructor(
    @Inject(AdminRiskControlsService)
    private readonly service: AdminRiskControlsService,
  ) {}

  // -------------------------------------------------------------------------
  // Indicator definitions
  // -------------------------------------------------------------------------

  @Get('markets/:marketId/definitions')
  @RequirePermission('risk.view', { marketScoped: true })
  @ApiOperation({
    summary:
      'List selected-market risk indicator definitions (current versions by default).',
  })
  listDefinitions(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(listDefinitionsQuerySchema))
    query: ListDefinitionsQueryDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.listDefinitions(
        this.actor(actor, request, ip),
        marketId,
        query,
      ),
    );
  }

  @Post('markets/:marketId/definitions')
  @RequirePermission('risk.review.manage', { marketScoped: true })
  @ApiOperation({
    summary:
      'Create the next version of a selected-market indicator definition (supersedes the current version).',
  })
  @ApiResponse({
    status: 201,
    description: 'Definition version created and audited.',
  })
  createDefinition(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Body(new ZodValidationPipe(createDefinitionSchema))
    input: CreateDefinitionDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.createDefinition(
        this.actor(actor, request, ip),
        marketId,
        input,
        this.key(key),
      ),
    );
  }

  @Get('markets/:marketId/definitions/:definitionId')
  @RequirePermission('risk.view', { marketScoped: true })
  @ApiOperation({
    summary: 'Get one selected-market indicator definition version.',
  })
  getDefinition(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('definitionId', new ParseUUIDPipe()) definitionId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.getDefinition(
        this.actor(actor, request, ip),
        marketId,
        definitionId,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Detection runs
  // -------------------------------------------------------------------------

  @Get('markets/:marketId/runs')
  @RequirePermission('risk.view', { marketScoped: true })
  @ApiOperation({ summary: 'List selected-market detection runs.' })
  listRuns(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(listRunsQuerySchema))
    query: ListRunsQueryDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.listRuns(this.actor(actor, request, ip), marketId, query),
    );
  }

  @Post('markets/:marketId/runs')
  @RequirePermission('risk.review.manage', { marketScoped: true })
  @ApiOperation({ summary: 'Create a PENDING detection run for one category.' })
  @ApiResponse({ status: 201, description: 'Run created and audited.' })
  createRun(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Body(new ZodValidationPipe(createRunSchema)) input: CreateRunDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.createRun(
        this.actor(actor, request, ip),
        marketId,
        input,
        this.key(key),
      ),
    );
  }

  @Get('markets/:marketId/runs/:runId')
  @RequirePermission('risk.view', { marketScoped: true })
  @ApiOperation({
    summary: 'Get one selected-market detection run with its events.',
  })
  getRun(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('runId', new ParseUUIDPipe()) runId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.getRun(this.actor(actor, request, ip), marketId, runId),
    );
  }

  @Post('markets/:marketId/runs/:runId/execute')
  @HttpCode(200)
  @RequirePermission('risk.review.manage', { marketScoped: true })
  @ApiOperation({
    summary:
      'Execute (or re-execute) a run. COMPLETED runs replay the original result; retries are safe and never duplicate events.',
  })
  executeRun(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('runId', new ParseUUIDPipe()) runId: string,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.executeRun(
        this.actor(actor, request, ip),
        marketId,
        runId,
        this.key(key),
      ),
    );
  }

  @Post('markets/:marketId/runs/:runId/cancel')
  @HttpCode(200)
  @RequirePermission('risk.review.manage', { marketScoped: true })
  @ApiOperation({
    summary: 'Cancel a PENDING or RUNNING detection run with reason.',
  })
  cancelRun(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('runId', new ParseUUIDPipe()) runId: string,
    @Body(new ZodValidationPipe(queueActionSchema))
    input: QueueActionDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.cancelRun(
        this.actor(actor, request, ip),
        marketId,
        runId,
        input,
        this.key(key),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Risk events
  // -------------------------------------------------------------------------

  @Get('markets/:marketId/events')
  @RequirePermission('risk.view', { marketScoped: true })
  @ApiOperation({
    summary: 'List selected-market detected risk events (immutable).',
  })
  listEvents(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(listEventsQuerySchema))
    query: ListEventsQueryDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.listEvents(this.actor(actor, request, ip), marketId, query),
    );
  }

  @Get('markets/:marketId/events/:eventId')
  @RequirePermission('risk.view', { marketScoped: true })
  @ApiOperation({ summary: 'Get one immutable risk event.' })
  getEvent(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.getEvent(this.actor(actor, request, ip), marketId, eventId),
    );
  }

  // -------------------------------------------------------------------------
  // Review queue
  // -------------------------------------------------------------------------

  @Get('markets/:marketId/queue')
  @RequirePermission('risk.view', { marketScoped: true })
  @ApiOperation({ summary: 'List the selected-market risk review queue.' })
  listQueue(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(listQueueQuerySchema))
    query: ListQueueQueryDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.listQueue(this.actor(actor, request, ip), marketId, query),
    );
  }

  @Get('markets/:marketId/queue/:taskId')
  @RequirePermission('risk.view', { marketScoped: true })
  @ApiOperation({ summary: 'Get one review task with its event summary.' })
  getTask(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.getTask(this.actor(actor, request, ip), marketId, taskId),
    );
  }

  @Post('markets/:marketId/queue/:taskId/assign')
  @HttpCode(200)
  @RequirePermission('risk.review.manage', { marketScoped: true })
  @ApiOperation({
    summary:
      'Claim (defaults to the actor) or assign an OPEN review task -> IN_REVIEW.',
  })
  assignTask(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body(new ZodValidationPipe(assignQueueSchema)) input: AssignQueueDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.assignTask(
        this.actor(actor, request, ip),
        marketId,
        taskId,
        input,
        this.key(key),
      ),
    );
  }

  @Post('markets/:marketId/queue/:taskId/decide')
  @HttpCode(200)
  @RequirePermission('risk.review.manage', { marketScoped: true })
  @ApiOperation({
    summary:
      'Record a neutral review decision (NO_ACTION / WATCH / ESCALATED) with rationale.',
  })
  decideTask(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body(new ZodValidationPipe(decideQueueSchema)) input: DecideQueueDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.decideTask(
        this.actor(actor, request, ip),
        marketId,
        taskId,
        input,
        this.key(key),
      ),
    );
  }

  @Post('markets/:marketId/queue/:taskId/resolve')
  @HttpCode(200)
  @RequirePermission('risk.review.manage', { marketScoped: true })
  @ApiOperation({
    summary: 'Resolve an IN_REVIEW task (requires a recorded decision).',
  })
  resolveTask(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body(new ZodValidationPipe(queueActionSchema)) input: QueueActionDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.resolveTask(
        this.actor(actor, request, ip),
        marketId,
        taskId,
        input,
        this.key(key),
      ),
    );
  }

  @Post('markets/:marketId/queue/:taskId/notes')
  @HttpCode(200)
  @RequirePermission('risk.review.manage', { marketScoped: true })
  @ApiOperation({
    summary: 'Append an immutable actor-stamped review note.',
  })
  appendTaskNotes(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body(new ZodValidationPipe(queueNotesSchema)) input: QueueNotesDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.appendTaskNotes(
        this.actor(actor, request, ip),
        marketId,
        taskId,
        input,
        this.key(key),
      ),
    );
  }

  private actor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): RiskActor {
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
        code: 'RISK_IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    return value;
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof RiskError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'RISK_NOT_FOUND':
          throw new NotFoundException(body);
        case 'RISK_MARKET_MISMATCH':
          throw new ForbiddenException(body);
        case 'RISK_IDEMPOTENCY_KEY_REQUIRED':
        case 'RISK_INVALID_INPUT':
          throw new BadRequestException(body);
        case 'RISK_INVALID_TRANSITION':
        case 'RISK_STALE_VERSION':
        case 'RISK_IDEMPOTENCY_CONFLICT':
        case 'RISK_RUN_IN_PROGRESS':
        case 'RISK_DUPLICATE':
          throw new ConflictException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

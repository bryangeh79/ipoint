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
  createRunSchema,
  exceptionActionSchema,
  exceptionNotesSchema,
  listExceptionsQuerySchema,
  listRunsQuerySchema,
  type CreateRunDto,
  type ExceptionActionDto,
  type ExceptionNotesDto,
  type ListExceptionsQueryDto,
  type ListRunsQueryDto,
} from './admin-reconciliation-ops.dto.js';
import { AdminReconciliationOpsService } from './admin-reconciliation-ops.service.js';
import {
  ReconciliationError,
  type ReconciliationActor,
} from './admin-reconciliation-ops.types.js';

@ApiTags('Admin Financial Reconciliation')
@ApiBearerAuth()
@Controller('admin/reconciliation')
@UseGuards(AuthGuard, RbacGuard)
export class AdminReconciliationOpsController {
  constructor(
    @Inject(AdminReconciliationOpsService)
    private readonly service: AdminReconciliationOpsService,
  ) {}

  @Get('markets/:marketId/runs')
  @RequirePermission('reconciliation.view', { marketScoped: true })
  @ApiOperation({ summary: 'List selected-market reconciliation runs.' })
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
  @RequirePermission('reconciliation.run', { marketScoped: true })
  @ApiOperation({ summary: 'Create a PENDING reconciliation run.' })
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
  @RequirePermission('reconciliation.view', { marketScoped: true })
  @ApiOperation({ summary: 'Get one selected-market reconciliation run.' })
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

  @Get('markets/:marketId/runs/:runId/items')
  @RequirePermission('reconciliation.view', { marketScoped: true })
  @ApiOperation({
    summary: 'List immutable evidence items of a reconciliation run.',
  })
  listRunItems(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('runId', new ParseUUIDPipe()) runId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.listRunItems(
        this.actor(actor, request, ip),
        marketId,
        runId,
      ),
    );
  }

  @Post('markets/:marketId/runs/:runId/execute')
  @HttpCode(200)
  @RequirePermission('reconciliation.run', { marketScoped: true })
  @ApiOperation({
    summary:
      'Execute (or re-execute) a run. COMPLETED runs replay the original result; retries are safe.',
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
  @RequirePermission('reconciliation.run', { marketScoped: true })
  @ApiOperation({ summary: 'Cancel a PENDING or RUNNING run with reason.' })
  cancelRun(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('runId', new ParseUUIDPipe()) runId: string,
    @Body(new ZodValidationPipe(exceptionActionSchema))
    input: ExceptionActionDto,
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

  @Get('markets/:marketId/exceptions')
  @RequirePermission('reconciliation.view', { marketScoped: true })
  @ApiOperation({ summary: 'List the selected-market exception queue.' })
  listExceptions(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(listExceptionsQuerySchema))
    query: ListExceptionsQueryDto,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.listExceptions(
        this.actor(actor, request, ip),
        marketId,
        query,
      ),
    );
  }

  @Get('markets/:marketId/exceptions/:exceptionId')
  @RequirePermission('reconciliation.view', { marketScoped: true })
  @ApiOperation({ summary: 'Get one reconciliation exception.' })
  getException(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('exceptionId', new ParseUUIDPipe()) exceptionId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.getException(
        this.actor(actor, request, ip),
        marketId,
        exceptionId,
      ),
    );
  }

  @Post('markets/:marketId/exceptions/:exceptionId/acknowledge')
  @HttpCode(200)
  @RequirePermission('reconciliation.exception.manage', {
    marketScoped: true,
  })
  @ApiOperation({ summary: 'Acknowledge an OPEN exception (with reason).' })
  acknowledgeException(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('exceptionId', new ParseUUIDPipe()) exceptionId: string,
    @Body(new ZodValidationPipe(exceptionActionSchema))
    input: ExceptionActionDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.acknowledgeException(
        this.actor(actor, request, ip),
        marketId,
        exceptionId,
        input,
        this.key(key),
      ),
    );
  }

  @Post('markets/:marketId/exceptions/:exceptionId/resolve')
  @HttpCode(200)
  @RequirePermission('reconciliation.exception.manage', {
    marketScoped: true,
  })
  @ApiOperation({
    summary: 'Resolve an ACKNOWLEDGED exception (with reason).',
  })
  resolveException(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('exceptionId', new ParseUUIDPipe()) exceptionId: string,
    @Body(new ZodValidationPipe(exceptionActionSchema))
    input: ExceptionActionDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.resolveException(
        this.actor(actor, request, ip),
        marketId,
        exceptionId,
        input,
        this.key(key),
      ),
    );
  }

  @Post('markets/:marketId/exceptions/:exceptionId/close')
  @HttpCode(200)
  @RequirePermission('reconciliation.exception.manage', {
    marketScoped: true,
  })
  @ApiOperation({ summary: 'Close a RESOLVED exception (with reason).' })
  closeException(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('exceptionId', new ParseUUIDPipe()) exceptionId: string,
    @Body(new ZodValidationPipe(exceptionActionSchema))
    input: ExceptionActionDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.closeException(
        this.actor(actor, request, ip),
        marketId,
        exceptionId,
        input,
        this.key(key),
      ),
    );
  }

  @Post('markets/:marketId/exceptions/:exceptionId/notes')
  @HttpCode(200)
  @RequirePermission('reconciliation.exception.manage', {
    marketScoped: true,
  })
  @ApiOperation({
    summary: 'Append an immutable investigation note to an exception.',
  })
  appendExceptionNotes(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('exceptionId', new ParseUUIDPipe()) exceptionId: string,
    @Body(new ZodValidationPipe(exceptionNotesSchema))
    input: ExceptionNotesDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: RequestActor | undefined,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.handle(() =>
      this.service.appendExceptionNotes(
        this.actor(actor, request, ip),
        marketId,
        exceptionId,
        input,
        this.key(key),
      ),
    );
  }

  private actor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): ReconciliationActor {
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
        code: 'RECONCILIATION_IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    return value;
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ReconciliationError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'RECONCILIATION_NOT_FOUND':
          throw new NotFoundException(body);
        case 'RECONCILIATION_MARKET_MISMATCH':
          throw new ForbiddenException(body);
        case 'RECONCILIATION_IDEMPOTENCY_KEY_REQUIRED':
        case 'RECONCILIATION_INVALID_INPUT':
          throw new BadRequestException(body);
        case 'RECONCILIATION_INVALID_TRANSITION':
        case 'RECONCILIATION_STALE_VERSION':
        case 'RECONCILIATION_IDEMPOTENCY_CONFLICT':
        case 'RECONCILIATION_RUN_IN_PROGRESS':
        case 'RECONCILIATION_DUPLICATE':
          throw new ConflictException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

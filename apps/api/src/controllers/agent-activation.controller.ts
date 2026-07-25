import {
  BadRequestException,
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
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { members } from '@ipoint/database';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AgentActivationService } from '../domain/agent-activation/service.js';
import { AgentActivationError } from '../domain/agent-activation/agent-activation.errors.js';
import {
  applySchema,
  confirmPaymentSchema,
  enrollCourseSchema,
  completeCourseSchema,
  submitApprovalSchema,
  statusQuerySchema,
  type ApplyDto,
  type ConfirmPaymentDto,
  type EnrollCourseDto,
  type CompleteCourseDto,
  type SubmitApprovalDto,
  type StatusQueryDto,
} from './agent-activation.dto.js';

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@ApiTags('Agent Activation')
@ApiBearerAuth()
@Controller('api/v1/agent')
@UseGuards(AuthGuard)
export class AgentActivationController {
  constructor(
    @Inject(AgentActivationService)
    private readonly activation: AgentActivationService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  // ─── Apply ─────────────────────────────────────────────────────

  @Post('apply')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply for agent activation' })
  @ApiResponse({ status: 200, description: 'Activation application created.' })
  async apply(
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(applySchema)) input: ApplyDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    const memberId = await this.resolveMemberId(actor, request, ip);
    return this.handle(() => this.activation.apply(memberId, input.market));
  }

  // ─── Confirm Payment ──────────────────────────────────────────

  @Post('confirm-payment')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm payment for agent activation' })
  @ApiResponse({ status: 200, description: 'Payment confirmed.' })
  async confirmPayment(
    @Body(new ZodValidationPipe(confirmPaymentSchema))
    input: ConfirmPaymentDto,
  ) {
    return this.handle(() =>
      this.activation.confirmPayment(
        input.activationId,
        input.paymentReference,
      ),
    );
  }

  // ─── Enroll Course ────────────────────────────────────────────

  @Post('enroll-course')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enroll in agent training course' })
  @ApiResponse({ status: 200, description: 'Course enrollment recorded.' })
  async enrollCourse(
    @Body(new ZodValidationPipe(enrollCourseSchema)) input: EnrollCourseDto,
  ) {
    return this.handle(() => this.activation.enrollCourse(input.activationId));
  }

  // ─── Complete Course ──────────────────────────────────────────

  @Post('complete-course')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete agent training course' })
  @ApiResponse({ status: 200, description: 'Course completion recorded.' })
  async completeCourse(
    @Body(new ZodValidationPipe(completeCourseSchema))
    input: CompleteCourseDto,
  ) {
    return this.handle(() =>
      this.activation.completeCourse(input.activationId),
    );
  }

  // ─── Submit Approval ──────────────────────────────────────────

  @Post('submit-approval')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit activation for admin approval' })
  @ApiResponse({ status: 200, description: 'Submitted for approval.' })
  async submitApproval(
    @Body(new ZodValidationPipe(submitApprovalSchema))
    input: SubmitApprovalDto,
  ) {
    return this.handle(() =>
      this.activation.submitApproval(input.activationId),
    );
  }

  // ─── Get Status ───────────────────────────────────────────────

  @Get('status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get activation status for the member' })
  @ApiResponse({ status: 200, description: 'Activation status.' })
  async getStatus(
    @CurrentActor() actor: RequestActor | undefined,
    @Query(new ZodValidationPipe(statusQuerySchema)) query: StatusQueryDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    const memberId = await this.resolveMemberId(actor, request, ip);
    return this.handle(() =>
      this.activation.getStatus(memberId, query.market),
    );
  }

  // ─── Get Status By ID ─────────────────────────────────────────

  @Get('status/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get activation status by ID' })
  @ApiResponse({ status: 200, description: 'Activation status.' })
  async getStatusById(@Param('id') id: string) {
    return this.handle(() => this.activation.getStatusById(id));
  }

  // ─── Helpers ──────────────────────────────────────────────────

  /**
   * Resolve member ID from the authenticated actor's account ID.
   */
  private async resolveMemberId(
    actor: RequestActor | undefined,
    _request: Request,
    _ipAddress: string,
  ): Promise<string> {
    if (actor?.type !== 'ACCOUNT' || !actor.accountId) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_INVALID',
        message: 'A valid member session is required.',
      });
    }

    const rows = await this.database.db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.accountId, actor.accountId)))
      .limit(1);

    const member = rows[0];
    if (!member) {
      throw new ForbiddenException({
        code: 'AGENT_ACTIVATION_MEMBER_NOT_FOUND',
        message: 'Member profile not found.',
      });
    }

    return member.id;
  }

  /**
   * Map domain errors to HTTP exceptions.
   */
  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AgentActivationError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'AGENT_ACTIVATION_NOT_FOUND':
          throw new NotFoundException(body);
        case 'AGENT_ACTIVATION_ALREADY_EXISTS':
        case 'AGENT_ACTIVATION_PAYMENT_ALREADY_CONFIRMED':
        case 'AGENT_ACTIVATION_COURSE_ALREADY_COMPLETED':
        case 'AGENT_ACTIVATION_IDEMPOTENCY_CONFLICT':
          throw new ConflictException(body);
        case 'AGENT_ACTIVATION_MISSING_PAYMENT':
        case 'AGENT_ACTIVATION_MISSING_COURSE':
        case 'AGENT_ACTIVATION_MISSING_APPROVAL':
        case 'AGENT_ACTIVATION_FEE_NOT_CONFIGURED':
          throw new BadRequestException(body);
        case 'AGENT_ACTIVATION_INVALID_TRANSITION':
        case 'AGENT_ACTIVATION_INVALID_STATUS':
        case 'AGENT_ACTIVATION_ALREADY_ACTIVE':
        case 'AGENT_ACTIVATION_ALREADY_SUSPENDED':
        case 'AGENT_ACTIVATION_ALREADY_DEACTIVATED':
        case 'AGENT_ACTIVATION_ALREADY_REJECTED':
        case 'AGENT_ACTIVATION_DEACTIVATED_CANNOT_REACTIVATE':
        case 'AGENT_ACTIVATION_REJECTED_CANNOT_TRANSITION':
          throw new ConflictException(body);
        default:
          throw new InternalServerErrorException(body);
      }
    }
  }
}

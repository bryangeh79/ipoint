import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
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
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import { AgentActivationService } from '../domain/agent-activation/service.js';
import { AgentActivationError } from '../domain/agent-activation/agent-activation.errors.js';
import {
  deactivateSchema,
  rejectSchema,
  suspendSchema,
  type DeactivateDto,
  type RejectDto,
  type SuspendDto,
} from './agent-activation.dto.js';

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@ApiTags('Admin Agent Activations')
@ApiBearerAuth()
@Controller('api/v1/admin/agent-activations')
@UseGuards(AuthGuard, RbacGuard)
export class AdminAgentActivationController {
  constructor(
    @Inject(AgentActivationService)
    private readonly activation: AgentActivationService,
  ) {}

  // ─── Approve and Activate ─────────────────────────────────────

  @Post(':id/approve')
  @RequirePermission('agent.activation.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve and activate agent application' })
  @ApiResponse({ status: 200, description: 'Agent activated.' })
  approve(
    @Param('id') id: string,
    @CurrentActor() actor: RequestActor | undefined,
  ) {
    const adminId = this.resolveAdminId(actor);
    return this.handle(() => this.activation.approveAndActivate(id, adminId));
  }

  // ─── Reject ───────────────────────────────────────────────────

  @Post(':id/reject')
  @RequirePermission('agent.activation.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject agent activation application' })
  @ApiResponse({ status: 200, description: 'Application rejected.' })
  reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) input: RejectDto,
    @CurrentActor() actor: RequestActor | undefined,
  ) {
    this.resolveAdminId(actor);
    return this.handle(() => this.activation.reject(id, input.reason));
  }

  // ─── Suspend ──────────────────────────────────────────────────

  @Post(':id/suspend')
  @RequirePermission('agent.activation.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspend an active agent' })
  @ApiResponse({ status: 200, description: 'Agent suspended.' })
  suspend(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(suspendSchema)) input: SuspendDto,
    @CurrentActor() actor: RequestActor | undefined,
  ) {
    this.resolveAdminId(actor);
    return this.handle(() => this.activation.suspend(id, input.reason));
  }

  // ─── Reactivate ───────────────────────────────────────────────

  @Post(':id/reactivate')
  @RequirePermission('agent.activation.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reactivate a suspended agent' })
  @ApiResponse({ status: 200, description: 'Agent reactivated.' })
  reactivate(
    @Param('id') id: string,
    @CurrentActor() actor: RequestActor | undefined,
  ) {
    this.resolveAdminId(actor);
    return this.handle(() => this.activation.reactivate(id));
  }

  // ─── Deactivate ───────────────────────────────────────────────

  @Post(':id/deactivate')
  @RequirePermission('agent.activation.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Permanently deactivate an active agent' })
  @ApiResponse({ status: 200, description: 'Agent deactivated.' })
  deactivate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(deactivateSchema)) input: DeactivateDto,
    @CurrentActor() actor: RequestActor | undefined,
  ) {
    this.resolveAdminId(actor);
    return this.handle(() => this.activation.deactivate(id, input.reason));
  }

  // ─── Helpers ──────────────────────────────────────────────────

  /**
   * Extract and validate the admin user ID from the auth actor.
   */
  private resolveAdminId(actor: RequestActor | undefined): string {
    if (actor?.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new ForbiddenException({
        code: 'AUTH_PERMISSION_DENIED',
        message: 'An administrator session is required.',
      });
    }
    return actor.adminUserId;
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

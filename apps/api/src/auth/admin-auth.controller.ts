import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Ip,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminGuard } from './admin.guard.js';
import {
  adminMfaCodeSchema,
  adminMfaRecoverySchema,
  adminMfaResetSchema,
  adminPasswordSchema,
  adminStepUpStartSchema,
  type AdminMfaCodeDto,
  type AdminMfaRecoveryDto,
  type AdminMfaResetDto,
  type AdminPasswordDto,
  type AdminStepUpStartDto,
} from './auth.dto.js';
import { AuthError } from './auth.errors.js';
import { CurrentActor } from './current-actor.decorator.js';
import type { RequestActor, RequestMetadata } from './auth.types.js';

@ApiTags('Admin MFA')
@Controller('auth/admin')
export class AdminMfaController {
  constructor(
    @Inject(AdminAuthService) private readonly adminAuth: AdminAuthService,
  ) {}

  @Post('mfa/enrollment/start')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async startEnrollment(
    @Body(new ZodValidationPipe(adminPasswordSchema)) input: AdminPasswordDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    const result = await handleAuthError(() =>
      this.adminAuth.startEnrollment(
        input.email,
        input.password,
        requestMetadata(request, ipAddress),
      ),
    );
    return {
      enrollment_challenge_id: result.enrollmentChallenge,
      otpauth_uri: result.otpauthUri,
      expires_at: result.expiresAt,
    };
  }

  @Post('mfa/enrollment/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async confirmEnrollment(
    @Body(new ZodValidationPipe(adminMfaCodeSchema)) input: AdminMfaCodeDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    const result = await handleAuthError(() =>
      this.adminAuth.confirmEnrollment(
        input.challenge_id,
        input.code,
        requestMetadata(request, ipAddress),
      ),
    );
    return { recovery_codes: result.recoveryCodes };
  }

  @Post('login')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async beginLogin(
    @Body(new ZodValidationPipe(adminPasswordSchema)) input: AdminPasswordDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    const result = await handleAuthError(() =>
      this.adminAuth.beginLogin(
        input.email,
        input.password,
        requestMetadata(request, ipAddress),
      ),
    );
    return {
      code: 'MFA_REQUIRED',
      mfa_challenge_id: result.mfaChallenge,
      expires_at: result.expiresAt,
    };
  }

  @Post('mfa/challenge')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async completeLogin(
    @Body(new ZodValidationPipe(adminMfaCodeSchema)) input: AdminMfaCodeDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return handleAuthError(() =>
      this.adminAuth.completeLogin(
        input.challenge_id,
        input.code,
        requestMetadata(request, ipAddress),
      ),
    );
  }

  @Post('mfa/recovery')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async recoverLogin(
    @Body(new ZodValidationPipe(adminMfaRecoverySchema))
    input: AdminMfaRecoveryDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return handleAuthError(() =>
      this.adminAuth.recoverLogin(
        input.challenge_id,
        input.recovery_code,
        requestMetadata(request, ipAddress),
      ),
    );
  }

  @Post('mfa/step-up/challenge')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async beginStepUp(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(adminStepUpStartSchema))
    input: AdminStepUpStartDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    const result = await handleAuthError(() =>
      this.adminAuth.beginStepUp(
        actor,
        {
          actionClass: input.action_class,
          ...(input.market_id ? { marketId: input.market_id } : {}),
          ...(input.target ? { target: input.target } : {}),
        },
        requestMetadata(request, ipAddress),
      ),
    );
    return {
      step_up_challenge_id: result.stepUpChallenge,
      expires_at: result.expiresAt,
    };
  }

  @Post('mfa/step-up/verify')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async verifyStepUp(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(adminMfaCodeSchema)) input: AdminMfaCodeDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    const result = await handleAuthError(() =>
      this.adminAuth.verifyStepUp(
        actor,
        input.challenge_id,
        input.code,
        requestMetadata(request, ipAddress),
      ),
    );
    return { step_up_token: result.stepUpToken, expires_at: result.expiresAt };
  }

  @Post('mfa/reset')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async assistedReset(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(adminMfaResetSchema)) input: AdminMfaResetDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return handleAuthError(() =>
      this.adminAuth.assistedReset(
        actor,
        {
          targetAdminUserId: input.target_admin_user_id,
          confirmingAdminUserId: input.confirming_admin_user_id,
          reason: input.reason,
          caseReference: input.case_reference,
          stepUpToken: input.step_up_token,
        },
        requestMetadata(request, ipAddress),
      ),
    );
  }
}

@ApiTags('Admin Sessions')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/sessions')
export class AdminSessionController {
  constructor(
    @Inject(AdminAuthService) private readonly adminAuth: AdminAuthService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@CurrentActor() actor: RequestActor) {
    return {
      sessions: await handleAuthError(() => this.adminAuth.listSessions(actor)),
    };
  }

  @Get('current')
  @Header('Cache-Control', 'no-store')
  current(@CurrentActor() actor: RequestActor) {
    return {
      valid: true,
      session_id: actor.sessionId,
      admin_user_id: actor.adminUserId,
      mfa_recovery_used: actor.mfaRecoveryUsed ?? false,
    };
  }

  @Delete(':sessionId')
  @HttpCode(204)
  async revokeOne(
    @CurrentActor() actor: RequestActor,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    await handleAuthError(() => this.adminAuth.revokeSession(actor, sessionId));
  }

  @Delete()
  @HttpCode(200)
  async revokeAll(@CurrentActor() actor: RequestActor) {
    return handleAuthError(() => this.adminAuth.revokeAllSessions(actor));
  }
}

async function handleAuthError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    if (error.code === 'AUTH_RATE_LIMITED') {
      throw new HttpException(
        { code: error.code, message: error.message },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (error.code === 'SESSION_NOT_FOUND') {
      throw new NotFoundException({ code: error.code, message: error.message });
    }
    if (
      error.code === 'MFA_ENROLLMENT_REQUIRED' ||
      error.code === 'MFA_FACTOR_DISABLED' ||
      error.code === 'MFA_STEP_UP_REQUIRED' ||
      error.code === 'ADMIN_ACCESS_REMOVED'
    ) {
      throw new ForbiddenException({
        code: error.code,
        message: error.message,
      });
    }
    if (
      error.code === 'AUTH_INVALID_CREDENTIALS' ||
      error.code === 'AUTH_ACCOUNT_INACTIVE' ||
      error.code === 'MFA_REQUIRED' ||
      error.code === 'MFA_CHALLENGE_FAILED' ||
      error.code === 'MFA_RECOVERY_INVALID' ||
      error.code.startsWith('SESSION_')
    ) {
      throw new UnauthorizedException({
        code: error.code,
        message: error.message,
      });
    }
    throw new BadRequestException({ code: error.code, message: error.message });
  }
}

function requestMetadata(request: Request, ipAddress: string): RequestMetadata {
  const requestId = (request as unknown as Record<string, unknown>)[
    'requestId'
  ];
  return {
    ipAddress,
    userAgent: request.headers['user-agent'],
    ...(typeof requestId === 'string' ? { requestId } : {}),
  };
}

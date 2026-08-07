import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Ip,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ConfigService } from '../config/config.service.js';
import {
  issueOtpSchema,
  loginSchema,
  passwordResetCompleteSchema,
  passwordResetInitiateSchema,
  passwordResetVerifySchema,
  refreshSchema,
  registrationCompleteSchema,
  registrationInitiateSchema,
  registrationResendSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  type IssueOtpDto,
  type PasswordResetCompleteDto,
  type PasswordResetInitiateDto,
  type PasswordResetVerifyDto,
  type LoginDto,
  type RefreshDto,
  type RegistrationCompleteDto,
  type RegistrationInitiateDto,
  type RegistrationResendDto,
  type ResetPasswordDto,
  type VerifyOtpDto,
} from './auth.dto.js';
import { AuthError } from './auth.errors.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { RequestMetadata } from './auth.types.js';

// ---------------------------------------------------------------------------
// Shared OpenAPI schema fragments (isolated to this file — not re-exported)
// ---------------------------------------------------------------------------

const tokenResponseSchema = {
  type: 'object' as const,
  properties: {
    accessToken: {
      type: 'string',
      description: 'Opaque 64+ character hex string',
    },
    refreshToken: {
      type: 'string',
      description: 'Opaque 64+ character hex string',
    },
    accessExpiresAt: {
      type: 'string',
      format: 'date-time',
      description: 'Access token expiry (ISO 8601 UTC)',
    },
    refreshExpiresAt: {
      type: 'string',
      format: 'date-time',
      description: 'Refresh token expiry (ISO 8601 UTC)',
    },
  },
};

const otpResponseSchema = {
  type: 'object' as const,
  properties: {
    otp_id: { type: 'string', format: 'uuid', description: 'OTP record ID' },
    expires_at: {
      type: 'string',
      format: 'date-time',
      description: 'OTP expiry (ISO 8601 UTC)',
    },
    delivery_status: {
      type: 'string',
      enum: ['NOT_SENT'],
      description: 'Delivery status',
    },
    development_code: {
      type: 'string',
      description: 'OTP code — only present in non-production environments',
    },
  },
};

const verifyResponseSchema = {
  type: 'object' as const,
  properties: {
    verified: {
      type: 'boolean',
      enum: [true],
      description: 'Always true on success',
    },
  },
};

const registrationCompleteResponseSchema = {
  type: 'object' as const,
  properties: {
    accountId: {
      type: 'string',
      format: 'uuid',
      description: 'New account ID',
    },
    memberId: { type: 'string', format: 'uuid', description: 'New member ID' },
    publicMemberId: {
      type: 'string',
      description: 'Public member identifier (e.g. mem_XXXXXXXX)',
    },
    referralCode: { type: 'string', description: 'Member referral code' },
  },
};

const errorBodySchema = {
  type: 'object' as const,
  properties: {
    error: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'Machine-readable error code' },
        message: { type: 'string', description: 'Human-readable description' },
      },
    },
    requestId: {
      type: 'string',
      format: 'uuid',
      description: 'Correlation ID',
    },
  },
};

const loginBodySchema = {
  type: 'object' as const,
  properties: {
    email: {
      type: 'string',
      format: 'email',
      description: 'Member email address (trimmed, lowercased)',
    },
    password: {
      type: 'string',
      minLength: 12,
      maxLength: 256,
      description: 'Account password',
    },
  },
  required: ['email', 'password'],
};

const refreshBodySchema = {
  type: 'object' as const,
  properties: {
    refresh_token: {
      type: 'string',
      minLength: 32,
      maxLength: 512,
      description: 'Current refresh token',
    },
  },
  required: ['refresh_token'],
};

const registrationInitiateBodySchema = {
  type: 'object' as const,
  properties: {
    email: {
      type: 'string',
      format: 'email',
      description: 'Member email (trimmed, lowercased)',
    },
    password: {
      type: 'string',
      minLength: 12,
      maxLength: 256,
      description: 'Account password',
    },
    account_country: {
      type: 'string',
      pattern: '^[A-Z]{2}$',
      description: 'ISO 3166-1 alpha-2 country code',
    },
    terms_version: {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      description: 'Accepted terms version',
    },
    disclaimer_version: {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      description: 'Accepted disclaimer version',
    },
    privacy_version: {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      description: 'Accepted privacy policy version',
    },
    locale: {
      type: 'string',
      minLength: 2,
      maxLength: 32,
      description: 'Locale (e.g. en-US)',
    },
    referral_code: {
      type: 'string',
      minLength: 8,
      maxLength: 64,
      pattern: '^[A-Za-z0-9]+$',
      description: 'Optional referral code',
      nullable: true,
    },
    idempotency_key: {
      type: 'string',
      minLength: 8,
      maxLength: 128,
      description: 'Optional idempotency key',
    },
  },
  required: [
    'email',
    'password',
    'account_country',
    'terms_version',
    'disclaimer_version',
    'privacy_version',
    'locale',
  ],
};

const verifyOtpBodySchema = {
  type: 'object' as const,
  properties: {
    otp_id: {
      type: 'string',
      format: 'uuid',
      description: 'OTP record ID returned by initiate',
    },
    code: {
      type: 'string',
      pattern: '^\\d{6}$',
      description: '6-digit OTP code',
    },
  },
  required: ['otp_id', 'code'],
};

const registrationCompleteBodySchema = {
  type: 'object' as const,
  properties: {
    otp_id: {
      type: 'string',
      format: 'uuid',
      description: 'OTP record ID (must be verified first)',
    },
    idempotency_key: {
      type: 'string',
      minLength: 8,
      maxLength: 128,
      description: 'Required idempotency key',
    },
  },
  required: ['otp_id', 'idempotency_key'],
};

const resendBodySchema = {
  type: 'object' as const,
  properties: {
    otp_id: {
      type: 'string',
      format: 'uuid',
      description: 'OTP record ID to resend',
    },
  },
  required: ['otp_id'],
};

const passwordResetInitiateBodySchema = {
  type: 'object' as const,
  properties: {
    email: {
      type: 'string',
      format: 'email',
      description: 'Account email (trimmed, lowercased)',
    },
  },
  required: ['email'],
};

const passwordResetCompleteBodySchema = {
  type: 'object' as const,
  properties: {
    otp_id: {
      type: 'string',
      format: 'uuid',
      description: 'OTP record ID (must be verified)',
    },
    new_password: {
      type: 'string',
      minLength: 12,
      maxLength: 256,
      description: 'New account password',
    },
    idempotency_key: {
      type: 'string',
      minLength: 8,
      maxLength: 128,
      description: 'Required idempotency key',
    },
  },
  required: ['otp_id', 'new_password', 'idempotency_key'],
};

const issueOtpBodySchema = {
  type: 'object' as const,
  properties: {
    destination: {
      type: 'string',
      format: 'email',
      description: 'Destination email (trimmed, lowercased)',
    },
    purpose: {
      type: 'string',
      enum: ['EMAIL_VERIFICATION', 'PASSWORD_RESET'],
      description: 'OTP purpose',
    },
  },
  required: ['destination', 'purpose'],
};

const resetPasswordBodySchema = {
  type: 'object' as const,
  properties: {
    otp_id: { type: 'string', format: 'uuid', description: 'OTP record ID' },
    new_password: {
      type: 'string',
      minLength: 12,
      maxLength: 256,
      description: 'New account password',
    },
  },
  required: ['otp_id', 'new_password'],
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Authenticate member and issue session tokens',
    description:
      'Validates email and password credentials, then issues an access token (15 min TTL) and a refresh token (7 day TTL). Returns opaque hex token strings. Composite rate limiting: email-based + IP-based.',
  })
  @ApiBody({ description: 'Login credentials', schema: loginBodySchema })
  @ApiOkResponse({
    description: 'Authentication successful — tokens issued',
    schema: tokenResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description:
      'Invalid credentials (AUTH_INVALID_CREDENTIALS) or account inactive (AUTH_ACCOUNT_INACTIVE)',
    schema: errorBodySchema,
  })
  @ApiForbiddenResponse({
    description: 'Member status is not active (AUTH_MEMBER_INACTIVE)',
    schema: errorBodySchema,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded (AUTH_RATE_LIMITED)',
    schema: errorBodySchema,
  })
  login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.auth.login(input.email, input.password, context(request, ipAddress)),
    );
  }

  @Post('member/login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Authenticate member and issue session tokens (member alias)',
    description:
      'Convenience alias for POST /auth/login. Uses the same credentials, rate limits, and response shape.',
  })
  @ApiBody({ description: 'Login credentials', schema: loginBodySchema })
  @ApiOkResponse({
    description: 'Authentication successful — tokens issued',
    schema: tokenResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description:
      'Invalid credentials (AUTH_INVALID_CREDENTIALS) or account inactive (AUTH_ACCOUNT_INACTIVE)',
    schema: errorBodySchema,
  })
  @ApiForbiddenResponse({
    description: 'Member status is not active (AUTH_MEMBER_INACTIVE)',
    schema: errorBodySchema,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded (AUTH_RATE_LIMITED)',
    schema: errorBodySchema,
  })
  memberLogin(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.login(input, ipAddress, request);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotate refresh token and issue new tokens',
    description:
      'Consumes the current refresh token and issues a new access/refresh token pair. Implements token rotation: replaying a consumed token triggers SESSION_REUSE_DETECTED and revokes the entire session family. IP-based rate limit: 30 req / 60s.',
  })
  @ApiBody({ description: 'Current refresh token', schema: refreshBodySchema })
  @ApiOkResponse({
    description: 'Token rotation successful — new tokens issued',
    schema: tokenResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description:
      'Session invalid (AUTH_SESSION_INVALID) or refresh token reused (SESSION_REUSE_DETECTED)',
    schema: errorBodySchema,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded (AUTH_RATE_LIMITED)',
    schema: errorBodySchema,
  })
  refresh(
    @Body(new ZodValidationPipe(refreshSchema)) input: RefreshDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.auth.rotateRefreshToken(
        input.refresh_token,
        context(request, ipAddress),
      ),
    );
  }

  @Post('member/refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotate refresh token and issue new tokens (member alias)',
    description:
      'Convenience alias for POST /auth/refresh. Uses the same request body, token rotation behavior, and rate limits.',
  })
  @ApiBody({ description: 'Current refresh token', schema: refreshBodySchema })
  @ApiOkResponse({
    description: 'Token rotation successful — new tokens issued',
    schema: tokenResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description:
      'Session invalid (AUTH_SESSION_INVALID) or refresh token reused (SESSION_REUSE_DETECTED)',
    schema: errorBodySchema,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded (AUTH_RATE_LIMITED)',
    schema: errorBodySchema,
  })
  memberRefresh(
    @Body(new ZodValidationPipe(refreshSchema)) input: RefreshDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.refresh(input, ipAddress, request);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revoke current session',
    description:
      'Revokes the session associated with the provided Bearer access token. Requires a valid, non-expired token. Idempotent on replayed tokens (returns 401).',
  })
  @ApiNoContentResponse({
    description: 'Session revoked successfully — no body',
  })
  @ApiUnauthorizedResponse({
    description:
      'Token invalid, expired, or already revoked (AUTH_SESSION_INVALID)',
    schema: errorBodySchema,
  })
  async logout(
    @Headers('authorization') authorization: string,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.handle(() =>
      this.auth.logout(authorization.slice(7), context(request, ipAddress)),
    );
  }

  @Post('member/logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revoke current session (member alias)',
    description:
      'Convenience alias for POST /auth/logout. Requires a valid Bearer access token.',
  })
  @ApiNoContentResponse({
    description: 'Session revoked successfully — no body',
  })
  @ApiUnauthorizedResponse({
    description:
      'Token invalid, expired, or already revoked (AUTH_SESSION_INVALID)',
    schema: errorBodySchema,
  })
  async memberLogout(
    @Headers('authorization') authorization: string,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.logout(authorization, ipAddress, request);
  }

  @Post('otp/issue')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Issue a generic OTP',
    description:
      'Generates and returns an OTP for the given destination and purpose. Rate-limited by IP + destination: 5 req / 3600s window. Supports purposes: EMAIL_VERIFICATION, PASSWORD_RESET.',
  })
  @ApiBody({ description: 'OTP issue parameters', schema: issueOtpBodySchema })
  @ApiAcceptedResponse({
    description: 'OTP issued successfully',
    schema: otpResponseSchema,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded (AUTH_RATE_LIMITED)',
    schema: errorBodySchema,
  })
  async issueOtp(
    @Body(new ZodValidationPipe(issueOtpSchema)) input: IssueOtpDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    const metadata = context(request, ipAddress);
    const otp = await this.handle(() =>
      input.purpose === 'PASSWORD_RESET'
        ? this.auth.issuePasswordResetOtp(input.destination, metadata)
        : this.auth.issueOtp({
            destination: input.destination,
            purpose: input.purpose,
            metadata,
          }),
    );
    const exposeDevelopmentCode =
      this.config.isDevelopment || this.config.isTest;
    return {
      otp_id: otp.id,
      expires_at: otp.expiresAt,
      delivery_status: 'NOT_SENT' as const,
      ...(exposeDevelopmentCode ? { development_code: otp.code } : {}),
    };
  }

  @Post('registration/initiate')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Initiate member registration',
    description:
      'Creates a pending registration record and issues an OTP to verify the email address. Supports optional idempotency key. Composite rate limiting: email-based + IP-based. The OTP is returned in the response in non-production environments.',
  })
  @ApiBody({
    description: 'Registration initiation parameters',
    schema: registrationInitiateBodySchema,
  })
  @ApiAcceptedResponse({
    description: 'Registration initiated — OTP issued',
    schema: otpResponseSchema,
  })
  @ApiBadRequestResponse({
    description: 'Zod validation failure (VALIDATION_ERROR)',
    schema: errorBodySchema,
  })
  @ApiConflictResponse({
    description:
      'Email already registered (AUTH_MEMBER_ALREADY_EXISTS) or idempotency key conflict (AUTH_IDEMPOTENCY_CONFLICT)',
    schema: errorBodySchema,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded (AUTH_RATE_LIMITED)',
    schema: errorBodySchema,
  })
  async initiateRegistration(
    @Body(new ZodValidationPipe(registrationInitiateSchema))
    input: RegistrationInitiateDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    const metadata = context(request, ipAddress);
    const otp = await this.handle(() =>
      this.auth.initiateRegistration(
        {
          email: input.email,
          password: input.password,
          accountCountry: input.account_country,
          referralCode: input.referral_code ?? null,
          termsVersion: input.terms_version,
          disclaimerVersion: input.disclaimer_version,
          privacyVersion: input.privacy_version,
          locale: input.locale,
        },
        metadata,
        input.idempotency_key ?? null,
      ),
    );
    return this.issueOtpResponse(otp);
  }

  @Post('member/register')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Initiate member registration (member alias)',
    description:
      'Convenience alias for POST /auth/registration/initiate. Uses the same request body, validation, and response shape.',
  })
  @ApiBody({
    description: 'Registration initiation parameters',
    schema: registrationInitiateBodySchema,
  })
  @ApiAcceptedResponse({
    description: 'Registration initiated — OTP issued',
    schema: otpResponseSchema,
  })
  @ApiBadRequestResponse({
    description: 'Zod validation failure (VALIDATION_ERROR)',
    schema: errorBodySchema,
  })
  @ApiConflictResponse({
    description:
      'Email already registered (AUTH_MEMBER_ALREADY_EXISTS) or idempotency key conflict (AUTH_IDEMPOTENCY_CONFLICT)',
    schema: errorBodySchema,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded (AUTH_RATE_LIMITED)',
    schema: errorBodySchema,
  })
  async memberInitiateRegistration(
    @Body(new ZodValidationPipe(registrationInitiateSchema))
    input: RegistrationInitiateDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.initiateRegistration(input, ipAddress, request);
  }

  @Post('registration/resend')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Resend registration OTP',
    description:
      'Invalidates the previous OTP and issues a new one for the same registration flow. Subject to a per-OTP cooldown (default 60s). Returns AUTH_OTP_COOLDOWN if the cooldown has not elapsed.',
  })
  @ApiBody({ description: 'OTP record ID to resend', schema: resendBodySchema })
  @ApiAcceptedResponse({
    description: 'New OTP issued',
    schema: otpResponseSchema,
  })
  @ApiBadRequestResponse({
    description:
      'OTP not found, wrong purpose, or already used (AUTH_FLOW_INVALID)',
    schema: errorBodySchema,
  })
  @ApiTooManyRequestsResponse({
    description:
      'Resend cooldown active (AUTH_OTP_COOLDOWN) or rate limit exceeded (AUTH_RATE_LIMITED)',
    schema: errorBodySchema,
  })
  async resendRegistrationOtp(
    @Body(new ZodValidationPipe(registrationResendSchema))
    input: RegistrationResendDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    const otp = await this.handle(() =>
      this.auth.resendRegistrationOtp(
        input.otp_id,
        context(request, ipAddress),
      ),
    );
    return this.issueOtpResponse(otp);
  }

  @Post('member/register/resend-otp')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Resend registration OTP (member alias)',
    description:
      'Convenience alias for POST /auth/registration/resend. Uses the same request body, cooldown behavior, and response shape.',
  })
  @ApiBody({ description: 'OTP record ID to resend', schema: resendBodySchema })
  @ApiAcceptedResponse({
    description: 'New OTP issued',
    schema: otpResponseSchema,
  })
  @ApiBadRequestResponse({
    description:
      'OTP not found, wrong purpose, or already used (AUTH_FLOW_INVALID)',
    schema: errorBodySchema,
  })
  @ApiTooManyRequestsResponse({
    description:
      'Resend cooldown active (AUTH_OTP_COOLDOWN) or rate limit exceeded (AUTH_RATE_LIMITED)',
    schema: errorBodySchema,
  })
  async memberResendRegistrationOtp(
    @Body(new ZodValidationPipe(registrationResendSchema))
    input: RegistrationResendDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.resendRegistrationOtp(input, ipAddress, request);
  }

  @Post('registration/verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify registration OTP',
    description:
      'Validates the OTP code for a registration flow. Idempotent: safe to replay with the same otp_id and code. Tracks attempt count; returns AUTH_OTP_ATTEMPTS_EXHAUSTED after max attempts.',
  })
  @ApiBody({
    description: 'OTP verification parameters',
    schema: verifyOtpBodySchema,
  })
  @ApiOkResponse({
    description: 'OTP verified successfully',
    schema: verifyResponseSchema,
  })
  @ApiBadRequestResponse({
    description:
      'Wrong code (AUTH_OTP_INVALID), OTP expired (AUTH_OTP_EXPIRED), attempts exhausted (AUTH_OTP_ATTEMPTS_EXHAUSTED), or OTP already used (AUTH_FLOW_INVALID)',
    schema: errorBodySchema,
  })
  async verifyRegistrationOtp(
    @Body(new ZodValidationPipe(verifyOtpSchema))
    input: VerifyOtpDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    await this.handle(() =>
      this.auth.verifyRegistrationOtp(
        input.otp_id,
        input.code,
        context(request, ipAddress),
      ),
    );
    return { verified: true };
  }

  @Post('member/register/verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify registration OTP (member alias)',
    description:
      'Convenience alias for POST /auth/registration/verify. Uses the same request body, idempotency behavior, and response shape.',
  })
  @ApiBody({
    description: 'OTP verification parameters',
    schema: verifyOtpBodySchema,
  })
  @ApiOkResponse({
    description: 'OTP verified successfully',
    schema: verifyResponseSchema,
  })
  @ApiBadRequestResponse({
    description:
      'Wrong code (AUTH_OTP_INVALID), OTP expired (AUTH_OTP_EXPIRED), attempts exhausted (AUTH_OTP_ATTEMPTS_EXHAUSTED), or OTP already used (AUTH_FLOW_INVALID)',
    schema: errorBodySchema,
  })
  async memberVerifyRegistrationOtp(
    @Body(new ZodValidationPipe(verifyOtpSchema))
    input: VerifyOtpDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.verifyRegistrationOtp(input, ipAddress, request);
  }

  @Post('registration/complete')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Complete member registration',
    description:
      'Finalizes registration by creating the account, member profile, consent records, and referral chain in a single database transaction. Requires a verified OTP. Idempotency is REQUIRED: provide an idempotency_key for safe replay.',
  })
  @ApiBody({
    description: 'Registration completion parameters',
    schema: registrationCompleteBodySchema,
  })
  @ApiOkResponse({
    description: 'Registration completed successfully',
    schema: registrationCompleteResponseSchema,
  })
  @ApiBadRequestResponse({
    description:
      'Flow invalid (AUTH_FLOW_INVALID: OTP not verified, already used, or purpose mismatch), market invalid (AUTH_MARKET_INVALID), or referral invalid (AUTH_REFERRAL_INVALID)',
    schema: errorBodySchema,
  })
  @ApiConflictResponse({
    description:
      'Email already registered between OTP issue and completion (AUTH_MEMBER_ALREADY_EXISTS) or idempotency key conflict (AUTH_IDEMPOTENCY_CONFLICT)',
    schema: errorBodySchema,
  })
  @ApiInternalServerErrorResponse({
    description:
      'Identifier generation failed (AUTH_IDENTIFIER_GENERATION_FAILED)',
    schema: errorBodySchema,
  })
  async completeRegistration(
    @Body(new ZodValidationPipe(registrationCompleteSchema))
    input: RegistrationCompleteDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.auth.completeRegistration(
        input.otp_id,
        input.idempotency_key,
        context(request, ipAddress),
      ),
    );
  }

  @Post('member/register/complete')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Complete member registration (member alias)',
    description:
      'Convenience alias for POST /auth/registration/complete. Uses the same request body, transactional guarantees, and idempotency requirements.',
  })
  @ApiBody({
    description: 'Registration completion parameters',
    schema: registrationCompleteBodySchema,
  })
  @ApiOkResponse({
    description: 'Registration completed successfully',
    schema: registrationCompleteResponseSchema,
  })
  @ApiBadRequestResponse({
    description:
      'Flow invalid (AUTH_FLOW_INVALID), market invalid (AUTH_MARKET_INVALID), or referral invalid (AUTH_REFERRAL_INVALID)',
    schema: errorBodySchema,
  })
  @ApiConflictResponse({
    description:
      'Email already registered (AUTH_MEMBER_ALREADY_EXISTS) or idempotency key conflict (AUTH_IDEMPOTENCY_CONFLICT)',
    schema: errorBodySchema,
  })
  @ApiInternalServerErrorResponse({
    description:
      'Identifier generation failed (AUTH_IDENTIFIER_GENERATION_FAILED)',
    schema: errorBodySchema,
  })
  async memberCompleteRegistration(
    @Body(new ZodValidationPipe(registrationCompleteSchema))
    input: RegistrationCompleteDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.completeRegistration(input, ipAddress, request);
  }

  @Post('password-reset/initiate')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Initiate password reset',
    description:
      'Issues an OTP for password reset. Returns a neutral response (OTP even for unknown emails) to prevent email enumeration. Composite rate limiting: email-based + IP-based.',
  })
  @ApiBody({
    description: 'Account email for password reset',
    schema: passwordResetInitiateBodySchema,
  })
  @ApiAcceptedResponse({
    description: 'Password reset OTP issued',
    schema: otpResponseSchema,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded (AUTH_RATE_LIMITED)',
    schema: errorBodySchema,
  })
  async initiatePasswordReset(
    @Body(new ZodValidationPipe(passwordResetInitiateSchema))
    input: PasswordResetInitiateDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    const otp = await this.handle(() =>
      this.auth.initiatePasswordReset(input.email, context(request, ipAddress)),
    );
    return this.issueOtpResponse(otp);
  }

  @Post('member/password-reset/request')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Initiate password reset (member alias)',
    description:
      'Convenience alias for POST /auth/password-reset/initiate. Uses the same request body, neutral response behavior, and rate limits.',
  })
  @ApiBody({
    description: 'Account email for password reset',
    schema: passwordResetInitiateBodySchema,
  })
  @ApiAcceptedResponse({
    description: 'Password reset OTP issued',
    schema: otpResponseSchema,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded (AUTH_RATE_LIMITED)',
    schema: errorBodySchema,
  })
  async memberInitiatePasswordReset(
    @Body(new ZodValidationPipe(passwordResetInitiateSchema))
    input: PasswordResetInitiateDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.initiatePasswordReset(input, ipAddress, request);
  }

  @Post('password-reset/verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify password reset OTP',
    description:
      'Validates the OTP code for a password reset flow. Idempotent: safe to replay with the same otp_id and code. Also validates that the OTP purpose is PASSWORD_RESET.',
  })
  @ApiBody({
    description: 'OTP verification parameters',
    schema: verifyOtpBodySchema,
  })
  @ApiOkResponse({
    description: 'OTP verified successfully',
    schema: verifyResponseSchema,
  })
  @ApiBadRequestResponse({
    description:
      'Wrong code (AUTH_OTP_INVALID), OTP expired (AUTH_OTP_EXPIRED), attempts exhausted (AUTH_OTP_ATTEMPTS_EXHAUSTED), OTP already used (AUTH_FLOW_INVALID), or purpose mismatch',
    schema: errorBodySchema,
  })
  async verifyPasswordResetOtp(
    @Body(new ZodValidationPipe(passwordResetVerifySchema))
    input: PasswordResetVerifyDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    await this.handle(() =>
      this.auth.verifyPasswordResetOtp(
        input.otp_id,
        input.code,
        context(request, ipAddress),
      ),
    );
    return { verified: true };
  }

  @Post('member/password-reset/verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify password reset OTP (member alias)',
    description:
      'Convenience alias for POST /auth/password-reset/verify. Uses the same request body, idempotency behavior, and response shape.',
  })
  @ApiBody({
    description: 'OTP verification parameters',
    schema: verifyOtpBodySchema,
  })
  @ApiOkResponse({
    description: 'OTP verified successfully',
    schema: verifyResponseSchema,
  })
  @ApiBadRequestResponse({
    description:
      'Wrong code (AUTH_OTP_INVALID), OTP expired (AUTH_OTP_EXPIRED), attempts exhausted (AUTH_OTP_ATTEMPTS_EXHAUSTED), OTP already used (AUTH_FLOW_INVALID), or purpose mismatch',
    schema: errorBodySchema,
  })
  async memberVerifyPasswordResetOtp(
    @Body(new ZodValidationPipe(passwordResetVerifySchema))
    input: PasswordResetVerifyDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.verifyPasswordResetOtp(input, ipAddress, request);
  }

  @Post('password-reset/complete')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Complete password reset',
    description:
      'Updates the account password, revokes all existing sessions, and consumes the OTP in a single database transaction. Requires a verified OTP and an idempotency key for safe replay.',
  })
  @ApiBody({
    description: 'Password reset completion parameters',
    schema: passwordResetCompleteBodySchema,
  })
  @ApiNoContentResponse({
    description: 'Password reset completed successfully — no body',
  })
  @ApiBadRequestResponse({
    description:
      'Flow invalid (AUTH_FLOW_INVALID: OTP not verified, already used, or missing accountId) or idempotency key conflict (AUTH_IDEMPOTENCY_CONFLICT)',
    schema: errorBodySchema,
  })
  async completePasswordReset(
    @Body(new ZodValidationPipe(passwordResetCompleteSchema))
    input: PasswordResetCompleteDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.handle(() =>
      this.auth.completePasswordReset(
        input.otp_id,
        input.new_password,
        input.idempotency_key,
        context(request, ipAddress),
      ),
    );
  }

  @Post('member/password-reset/complete')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Complete password reset (member alias)',
    description:
      'Convenience alias for POST /auth/password-reset/complete. Uses the same request body, transactional guarantees, and idempotency requirements.',
  })
  @ApiBody({
    description: 'Password reset completion parameters',
    schema: passwordResetCompleteBodySchema,
  })
  @ApiNoContentResponse({
    description: 'Password reset completed successfully — no body',
  })
  @ApiBadRequestResponse({
    description:
      'Flow invalid (AUTH_FLOW_INVALID) or idempotency key conflict (AUTH_IDEMPOTENCY_CONFLICT)',
    schema: errorBodySchema,
  })
  async memberCompletePasswordReset(
    @Body(new ZodValidationPipe(passwordResetCompleteSchema))
    input: PasswordResetCompleteDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.completePasswordReset(input, ipAddress, request);
  }

  @Post('otp/verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify a generic OTP',
    description:
      'Validates any OTP by otp_id and code. Idempotent: safe to replay. Supports all OTP purposes.',
  })
  @ApiBody({
    description: 'OTP verification parameters',
    schema: verifyOtpBodySchema,
  })
  @ApiOkResponse({
    description: 'OTP verified successfully',
    schema: verifyResponseSchema,
  })
  @ApiBadRequestResponse({
    description:
      'Wrong code (AUTH_OTP_INVALID), OTP expired (AUTH_OTP_EXPIRED), attempts exhausted (AUTH_OTP_ATTEMPTS_EXHAUSTED), or OTP already used (AUTH_FLOW_INVALID)',
    schema: errorBodySchema,
  })
  async verifyOtp(
    @Body(new ZodValidationPipe(verifyOtpSchema)) input: VerifyOtpDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    await this.handle(() =>
      this.auth.verifyOtp(
        input.otp_id,
        input.code,
        context(request, ipAddress),
      ),
    );
    return { verified: true };
  }

  @Post('password/reset')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Reset password from a consumed OTP',
    description:
      'Directly resets the password using a previously consumed OTP. Unlike the two-step password-reset flow, this endpoint accepts an otp_id of an already-consumed OTP. IP-based rate limit: 5 req / 3600s window.',
  })
  @ApiBody({
    description: 'Password reset parameters',
    schema: resetPasswordBodySchema,
  })
  @ApiNoContentResponse({
    description: 'Password reset completed successfully — no body',
  })
  @ApiBadRequestResponse({
    description:
      'OTP not found, purpose mismatch, or not consumed (AUTH_OTP_INVALID)',
    schema: errorBodySchema,
  })
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) input: ResetPasswordDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.handle(() =>
      this.auth.resetPasswordFromOtp(
        input.otp_id,
        input.new_password,
        context(request, ipAddress),
      ),
    );
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
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
      if (
        error.code === 'AUTH_INVALID_CREDENTIALS' ||
        error.code === 'AUTH_ACCOUNT_INACTIVE' ||
        error.code === 'AUTH_SESSION_INVALID' ||
        error.code === 'AUTH_REFRESH_REUSED' ||
        error.code === 'SESSION_IDLE_EXPIRED' ||
        error.code === 'SESSION_ABSOLUTE_EXPIRED' ||
        error.code === 'SESSION_FAMILY_EXPIRED' ||
        error.code === 'SESSION_REUSE_DETECTED' ||
        error.code === 'SESSION_REVOKED'
      ) {
        throw new UnauthorizedException({
          code: error.code,
          message: error.message,
        });
      }
      if (error.code === 'AUTH_MEMBER_INACTIVE') {
        throw new ForbiddenException({
          code: error.code,
          message: error.message,
        });
      }
      if (error.code === 'AUTH_OTP_COOLDOWN') {
        throw new HttpException(
          { code: error.code, message: error.message },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (
        error.code === 'AUTH_IDEMPOTENCY_CONFLICT' ||
        error.code === 'AUTH_MEMBER_ALREADY_EXISTS'
      ) {
        throw new HttpException(
          { code: error.code, message: error.message },
          HttpStatus.CONFLICT,
        );
      }
      throw new BadRequestException({
        code: error.code,
        message: error.message,
      });
    }
  }

  private issueOtpResponse(otp: { id: string; code: string; expiresAt: Date }) {
    const exposeDevelopmentCode =
      this.config.isDevelopment || this.config.isTest;
    return {
      otp_id: otp.id,
      expires_at: otp.expiresAt,
      delivery_status: 'NOT_SENT' as const,
      ...(exposeDevelopmentCode ? { development_code: otp.code } : {}),
    };
  }
}

function context(request: Request, ipAddress: string): RequestMetadata {
  const requestId = (request as unknown as Record<string, unknown>)[
    'requestId'
  ];
  return {
    ipAddress,
    userAgent: request.headers['user-agent'],
    ...(typeof requestId === 'string' ? { requestId } : {}),
  };
}

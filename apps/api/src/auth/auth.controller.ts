import {
  BadRequestException,
  Body,
  Controller,
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

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Post('login')
  @Post('member/login')
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.handle(() =>
      this.auth.login(input.email, input.password, context(request, ipAddress)),
    );
  }

  @Post('refresh')
  @Post('member/refresh')
  @HttpCode(200)
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

  @Post('logout')
  @Post('member/logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(
    @Headers('authorization') authorization: string,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.handle(() =>
      this.auth.logout(authorization.slice(7), context(request, ipAddress)),
    );
  }

  @Post('otp/issue')
  @HttpCode(202)
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
  @Post('member/register')
  @HttpCode(202)
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

  @Post('registration/resend')
  @Post('member/register/resend-otp')
  @HttpCode(202)
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

  @Post('registration/verify')
  @Post('member/register/verify')
  @HttpCode(200)
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

  @Post('registration/complete')
  @Post('member/register/complete')
  @HttpCode(200)
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

  @Post('password-reset/initiate')
  @Post('member/password-reset/request')
  @HttpCode(202)
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

  @Post('password-reset/verify')
  @Post('member/password-reset/verify')
  @HttpCode(200)
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

  @Post('password-reset/complete')
  @Post('member/password-reset/complete')
  @HttpCode(204)
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

  @Post('otp/verify')
  @HttpCode(200)
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
        error.code === 'AUTH_MEMBER_INACTIVE' ||
        error.code === 'AUTH_SESSION_INVALID' ||
        error.code === 'AUTH_REFRESH_REUSED'
      ) {
        throw new UnauthorizedException({
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

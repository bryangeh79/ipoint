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
  refreshSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  type IssueOtpDto,
  type LoginDto,
  type RefreshDto,
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
        error.code === 'AUTH_SESSION_INVALID' ||
        error.code === 'AUTH_REFRESH_REUSED'
      ) {
        throw new UnauthorizedException({
          code: error.code,
          message: error.message,
        });
      }
      throw new BadRequestException({
        code: error.code,
        message: error.message,
      });
    }
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

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
  approveSchema,
  kycCaseFilterDto,
  rejectSchema,
  requestMoreInfoSchema,
  requireReverificationSchema,
  startReviewSchema,
  type AdminKycActionDto,
  type KycCaseFilterDto,
} from './admin-kyc.dto.js';
import { AdminKycError } from './admin-kyc.errors.js';
import { AdminKycService } from './admin-kyc.service.js';
import type {
  AdminKycActor,
  AdminKycCaseListResponse,
  AdminKycCaseResponse,
} from './admin-kyc.types.js';

@ApiTags('Admin KYC')
@ApiBearerAuth()
@Controller('admin/kyc/cases')
@UseGuards(AuthGuard, RbacGuard)
@RequirePermission('member.kyc.review')
export class AdminKycController {
  constructor(
    @Inject(AdminKycService) private readonly adminKyc: AdminKycService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List market-authorized member KYC cases' })
  @ApiResponse({ status: 200, description: 'Paginated KYC cases.' })
  listCases(
    @CurrentActor() actor: RequestActor | undefined,
    @Query(new ZodValidationPipe(kycCaseFilterDto)) filters: KycCaseFilterDto,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ): Promise<AdminKycCaseListResponse> {
    return this.handle(() =>
      this.adminKyc.listCases(
        this.adminActor(actor, request, ipAddress),
        filters,
      ),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a member KYC case with documents and history' })
  getCase(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) caseId: string,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ): Promise<AdminKycCaseResponse> {
    return this.handle(() =>
      this.adminKyc.getCase(this.adminActor(actor, request, ipAddress), caseId),
    );
  }

  @Post(':id/start-review')
  @HttpCode(200)
  startReview(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) caseId: string,
    @Body(new ZodValidationPipe(startReviewSchema)) input: AdminKycActionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ): Promise<AdminKycCaseResponse> {
    return this.action(
      actor,
      request,
      ipAddress,
      caseId,
      input,
      idempotencyKey,
      'startReview',
    );
  }

  @Post(':id/request-more-info')
  @HttpCode(200)
  requestMoreInfo(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) caseId: string,
    @Body(new ZodValidationPipe(requestMoreInfoSchema))
    input: AdminKycActionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ): Promise<AdminKycCaseResponse> {
    return this.action(
      actor,
      request,
      ipAddress,
      caseId,
      input,
      idempotencyKey,
      'requestMoreInfo',
    );
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) caseId: string,
    @Body(new ZodValidationPipe(approveSchema)) input: AdminKycActionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ): Promise<AdminKycCaseResponse> {
    return this.action(
      actor,
      request,
      ipAddress,
      caseId,
      input,
      idempotencyKey,
      'approve',
    );
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) caseId: string,
    @Body(new ZodValidationPipe(rejectSchema)) input: AdminKycActionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ): Promise<AdminKycCaseResponse> {
    return this.action(
      actor,
      request,
      ipAddress,
      caseId,
      input,
      idempotencyKey,
      'reject',
    );
  }

  @Post(':id/require-reverification')
  @HttpCode(200)
  requireReverification(
    @CurrentActor() actor: RequestActor | undefined,
    @Param('id', new ParseUUIDPipe()) caseId: string,
    @Body(new ZodValidationPipe(requireReverificationSchema))
    input: AdminKycActionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ): Promise<AdminKycCaseResponse> {
    return this.action(
      actor,
      request,
      ipAddress,
      caseId,
      input,
      idempotencyKey,
      'requireReverification',
    );
  }

  private action(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
    caseId: string,
    input: AdminKycActionDto,
    idempotencyKey: string | undefined,
    method:
      | 'startReview'
      | 'requestMoreInfo'
      | 'approve'
      | 'reject'
      | 'requireReverification',
  ): Promise<AdminKycCaseResponse> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const adminActor = this.adminActor(actor, request, ipAddress);
    return this.handle(() =>
      this.adminKyc[method](adminActor, caseId, input, key),
    );
  }

  private adminActor(
    actor: RequestActor | undefined,
    request: Request,
    ipAddress: string,
  ): AdminKycActor {
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

  private requireIdempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (!key || key.length > 200) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
    return key;
  }

  private async handle<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AdminKycError)) throw error;
      const body = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      switch (error.code) {
        case 'ADMIN_KYC_CASE_NOT_FOUND':
          throw new NotFoundException(body);
        case 'ADMIN_KYC_SELF_REVIEW':
        case 'ADMIN_KYC_MARKET_ACCESS_DENIED':
          throw new ForbiddenException(body);
        case 'ADMIN_KYC_INVALID_STATE':
        case 'ADMIN_KYC_INVALID_TRANSITION':
        case 'ADMIN_KYC_IDEMPOTENCY_CONFLICT':
          throw new ConflictException(body);
      }
    }
  }
}

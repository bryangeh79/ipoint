import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import {
  merchantApplicationQueueSchema,
  merchantListSchema,
  merchantStatusActionSchema,
  reviewMerchantApplicationSchema,
  submitMerchantApplicationSchema,
  type MerchantApplicationQueueDto,
  type MerchantListDto,
  type MerchantStatusActionDto,
  type ReviewMerchantApplicationDto,
  type SubmitMerchantApplicationDto,
} from './dto/application.dto.js';
import {
  addGalleryEntrySchema,
  updateMerchantProfileSchema,
  type AddGalleryEntryDto,
  type UpdateMerchantProfileDto,
} from './dto/profile.dto.js';
import {
  createMerchantDocumentIntentSchema,
  merchantKycQueueSchema,
  reviewMerchantKycSchema,
  submitMerchantKycSchema,
  type CreateMerchantDocumentIntentDto,
  type MerchantKycQueueDto,
  type ReviewMerchantKycDto,
  type SubmitMerchantKycDto,
} from './dto/kyc.dto.js';
import {
  registerMerchantSchema,
  type RegisterMerchantDto,
} from './dto/registration.dto.js';
import { MerchantOwnershipGuard } from './guards/merchant-ownership.guard.js';
import { merchantBadRequest, merchantErrorCodes } from './merchant.errors.js';
import {
  MerchantService,
  requireAccountActor,
  requireAdminActor,
  type MerchantRequestContext,
} from './merchant.service.js';

@Controller()
export class MerchantController {
  constructor(
    @Inject(MerchantService) private readonly merchants: MerchantService,
  ) {}

  @Post('merchant/register')
  register(
    @Body(new ZodValidationPipe(registerMerchantSchema))
    input: RegisterMerchantDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.merchants.register(
      input,
      requireIdempotencyKey(idempotencyKey),
      requestContext(request, ipAddress),
    );
  }

  @Get('merchant/branches/:branchId/profile')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  getProfile(@Param('branchId', new ParseUUIDPipe()) branchId: string) {
    return this.merchants.getProfile(branchId);
  }

  @Patch('merchant/branches/:branchId/profile')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  updateProfile(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(updateMerchantProfileSchema))
    input: UpdateMerchantProfileDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.merchants.updateProfile(
      branchId,
      requireAccountActor(actor),
      input,
      requireIdempotencyKey(idempotencyKey),
      requestContext(request, ipAddress),
    );
  }

  @Post('merchant/branches/:branchId/profile/gallery')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  addGalleryEntry(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(addGalleryEntrySchema))
    input: AddGalleryEntryDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.merchants.addGalleryEntry(
      branchId,
      requireAccountActor(actor),
      input,
      requireIdempotencyKey(idempotencyKey),
      requestContext(request, ipAddress),
    );
  }

  @Post('merchant/branches/:branchId/application/submit')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  submitApplication(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(submitMerchantApplicationSchema))
    input: SubmitMerchantApplicationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.merchants.submitApplication(
      branchId,
      requireAccountActor(actor),
      input,
      requireIdempotencyKey(idempotencyKey),
      requestContext(request, ipAddress),
    );
  }

  @Get('merchant/branches/:branchId/application')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  getApplication(@Param('branchId', new ParseUUIDPipe()) branchId: string) {
    return this.merchants.getApplication(branchId);
  }

  @Post('merchant/branches/:branchId/kyc/submit')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  submitKyc(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(submitMerchantKycSchema))
    input: SubmitMerchantKycDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.merchants.submitKyc(
      branchId,
      requireAccountActor(actor),
      input,
      requireIdempotencyKey(idempotencyKey),
      requestContext(request, ipAddress),
    );
  }

  @Get('merchant/branches/:branchId/kyc')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  getKyc(@Param('branchId', new ParseUUIDPipe()) branchId: string) {
    return this.merchants.getKyc(branchId);
  }

  @Post('merchant/branches/:branchId/documents/upload-intent')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  createDocumentUploadIntent(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createMerchantDocumentIntentSchema))
    input: CreateMerchantDocumentIntentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.merchants.createDocumentUploadIntent(
      branchId,
      requireAccountActor(actor),
      input,
      requireIdempotencyKey(idempotencyKey),
      requestContext(request, ipAddress),
    );
  }

  @Get('merchant/branches/:branchId/documents')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  listDocuments(@Param('branchId', new ParseUUIDPipe()) branchId: string) {
    return this.merchants.listDocuments(branchId);
  }

  @Get('merchant/branches/:branchId/documents/:documentId')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  getDocument(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ) {
    return this.merchants.getDocument(branchId, documentId);
  }

  @Get('merchant/branches/:branchId/documents/:documentId/download-metadata')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  getDocumentDownloadMetadata(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ) {
    return this.merchants.getDocumentDownloadMetadata(branchId, documentId);
  }

  @Get('admin/markets/:marketId/merchants/applications')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.view', { marketScoped: true })
  listApplications(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(merchantApplicationQueueSchema))
    query: MerchantApplicationQueueDto,
  ) {
    return this.merchants.listApplications(marketId, query);
  }

  @Get('admin/markets/:marketId/merchants')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.view', { marketScoped: true })
  listMerchants(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(merchantListSchema)) query: MerchantListDto,
  ) {
    return this.merchants.listMerchants(marketId, query);
  }

  @Get('admin/markets/:marketId/merchants/kyc')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.kyc.view', { marketScoped: true })
  listKycQueue(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Query(new ZodValidationPipe(merchantKycQueueSchema))
    query: MerchantKycQueueDto,
  ) {
    return this.merchants.listKycQueue(marketId, query);
  }

  @Get('admin/markets/:marketId/merchants/:branchId/kyc/review')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.kyc.approve', { marketScoped: true })
  getKycForReview(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.merchants.getKycForReview(
      marketId,
      branchId,
      requireAdminActor(actor),
      requestContext(request, ipAddress),
    );
  }

  @Post('admin/markets/:marketId/merchants/:branchId/kyc/review')
  @HttpCode(200)
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.kyc.approve', { marketScoped: true })
  reviewKyc(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(reviewMerchantKycSchema))
    input: ReviewMerchantKycDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.merchants.reviewKyc(
      marketId,
      branchId,
      requireAdminActor(actor),
      input,
      requireIdempotencyKey(idempotencyKey),
      requestContext(request, ipAddress),
    );
  }

  @Post('admin/markets/:marketId/merchants/:branchId/application/review')
  @HttpCode(200)
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.approve', { marketScoped: true })
  reviewApplication(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(reviewMerchantApplicationSchema))
    input: ReviewMerchantApplicationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.merchants.reviewApplication(
      marketId,
      branchId,
      requireAdminActor(actor),
      input,
      requireIdempotencyKey(idempotencyKey),
      requestContext(request, ipAddress),
    );
  }

  @Post('admin/markets/:marketId/merchants/:branchId/suspend')
  @HttpCode(200)
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.suspend', { marketScoped: true })
  suspend(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(merchantStatusActionSchema))
    input: MerchantStatusActionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.merchants.suspend(
      marketId,
      branchId,
      requireAdminActor(actor),
      input,
      requireIdempotencyKey(idempotencyKey),
      requestContext(request, ipAddress),
    );
  }

  @Post('admin/markets/:marketId/merchants/:branchId/reactivate')
  @HttpCode(200)
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.suspend', { marketScoped: true })
  reactivate(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(merchantStatusActionSchema))
    input: MerchantStatusActionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.merchants.reactivate(
      marketId,
      branchId,
      requireAdminActor(actor),
      input,
      requireIdempotencyKey(idempotencyKey),
      requestContext(request, ipAddress),
    );
  }

  @Post('admin/markets/:marketId/merchants/:branchId/close')
  @HttpCode(200)
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.close', { marketScoped: true })
  close(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(merchantStatusActionSchema))
    input: MerchantStatusActionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    return this.merchants.close(
      marketId,
      branchId,
      requireAdminActor(actor),
      input,
      requireIdempotencyKey(idempotencyKey),
      requestContext(request, ipAddress),
    );
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 200) {
    merchantBadRequest(
      merchantErrorCodes.idempotencyRequired,
      'A valid Idempotency-Key header is required.',
    );
  }
  return key;
}

function requestContext(
  request: Request,
  ipAddress: string,
): MerchantRequestContext {
  const requestId = (request as unknown as Record<string, unknown>)[
    'requestId'
  ];
  return {
    ipAddress,
    userAgent: request.headers['user-agent'],
    ...(typeof requestId === 'string' ? { requestId } : {}),
  };
}

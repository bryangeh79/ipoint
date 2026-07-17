import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  assignPackageSchema,
  createPackageProfileSchema,
  createPackageVersionSchema,
  createSpecialPercentageSchema,
  packageChangeRequestSchema,
  updatePackageVersionSchema,
  type AssignPackageDto,
  type CreatePackageProfileDto,
  type CreatePackageVersionDto,
  type CreateSpecialPercentageDto,
  type PackageChangeRequestDto,
  type UpdatePackageVersionDto,
} from './dto/package.dto.js';
import { MerchantOwnershipGuard } from './guards/merchant-ownership.guard.js';
import {
  requireAccountActor,
  requireAdminActor,
  type MerchantRequestContext,
} from './merchant.service.js';
import { PackageService } from './package.service.js';

@Controller()
export class PackageController {
  constructor(
    @Inject(PackageService) private readonly packages: PackageService,
  ) {}

  @Post('admin/markets/:marketId/packages')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.package.manage', { marketScoped: true })
  createProfile(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createPackageProfileSchema))
    input: CreatePackageProfileDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.packages.createProfile(
      marketId,
      requireAdminActor(actor),
      input,
      requireKey(key),
      context(request, ip),
    );
  }

  @Post('admin/markets/:marketId/packages/:packageId/versions')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.package.manage', { marketScoped: true })
  createVersion(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('packageId', new ParseUUIDPipe()) packageId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createPackageVersionSchema))
    input: CreatePackageVersionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.packages.createVersion(
      marketId,
      packageId,
      requireAdminActor(actor),
      input,
      requireKey(key),
      context(request, ip),
    );
  }

  @Patch(
    'admin/markets/:marketId/packages/:packageId/versions/:versionId/activate',
  )
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.package.manage', { marketScoped: true })
  activateVersion(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('packageId', new ParseUUIDPipe()) packageId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.packages.activateVersion(
      marketId,
      packageId,
      versionId,
      requireAdminActor(actor),
      requireKey(key),
      context(request, ip),
    );
  }

  @Patch('admin/markets/:marketId/packages/:packageId/versions/:versionId')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.package.manage', { marketScoped: true })
  updateVersion(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('packageId', new ParseUUIDPipe()) packageId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(updatePackageVersionSchema))
    input: UpdatePackageVersionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.packages.updateDraftVersion(
      marketId,
      packageId,
      versionId,
      requireAdminActor(actor),
      input,
      requireKey(key),
      context(request, ip),
    );
  }

  @Patch(
    'admin/markets/:marketId/packages/:packageId/versions/:versionId/cancel',
  )
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.package.manage', { marketScoped: true })
  cancelVersion(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('packageId', new ParseUUIDPipe()) packageId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.packages.cancelVersion(
      marketId,
      packageId,
      versionId,
      requireAdminActor(actor),
      requireKey(key),
      context(request, ip),
    );
  }

  @Post('admin/markets/:marketId/special-percentages')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.package.manage', { marketScoped: true })
  createSpecialPercentage(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(createSpecialPercentageSchema))
    input: CreateSpecialPercentageDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.packages.createSpecialPercentage(
      marketId,
      requireAdminActor(actor),
      input,
      requireKey(key),
      context(request, ip),
    );
  }

  @Post('admin/markets/:marketId/merchants/:branchId/packages/assignments')
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.package.manage', { marketScoped: true })
  assign(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(assignPackageSchema)) input: AssignPackageDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.packages.assign(
      marketId,
      branchId,
      requireAdminActor(actor),
      input,
      requireKey(key),
      context(request, ip),
    );
  }

  @Patch(
    'admin/markets/:marketId/merchants/:branchId/packages/assignments/:assignmentId/set-default',
  )
  @UseGuards(AuthGuard, RbacGuard)
  @RequirePermission('merchant.package.manage', { marketScoped: true })
  setDefault(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.packages.setDefault(
      marketId,
      branchId,
      assignmentId,
      requireAdminActor(actor),
      requireKey(key),
      context(request, ip),
    );
  }

  @Get('merchant/branches/:branchId/packages')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  list(@Param('branchId', new ParseUUIDPipe()) branchId: string) {
    return this.packages.listAvailable(branchId);
  }

  @Patch('merchant/branches/:branchId/packages/assignments/:assignmentId/pause')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  pause(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.packages.pause(
      branchId,
      assignmentId,
      requireAccountActor(actor),
      requireKey(key),
      context(request, ip),
    );
  }

  @Patch(
    'merchant/branches/:branchId/packages/assignments/:assignmentId/resume',
  )
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  resume(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.packages.resume(
      branchId,
      assignmentId,
      requireAccountActor(actor),
      requireKey(key),
      context(request, ip),
    );
  }

  @Post('merchant/branches/:branchId/packages/change-requests')
  @UseGuards(AuthGuard, MerchantOwnershipGuard)
  requestChange(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @CurrentActor() actor: RequestActor | undefined,
    @Body(new ZodValidationPipe(packageChangeRequestSchema))
    input: PackageChangeRequestDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.packages.requestChange(
      branchId,
      requireAccountActor(actor),
      input,
      requireKey(key),
      context(request, ip),
    );
  }
}

function requireKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 200) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'A valid Idempotency-Key header is required.',
    });
  }
  return key;
}

function context(request: Request, ipAddress: string): MerchantRequestContext {
  const requestId = (request as unknown as Record<string, unknown>)[
    'requestId'
  ];
  return {
    ipAddress,
    userAgent: request.headers['user-agent'],
    ...(typeof requestId === 'string' ? { requestId } : {}),
  };
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Ip,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../auth/current-actor.decorator.js';
import type { RequestActor } from '../auth/auth.types.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AccessAdministrationService } from './access-administration.service.js';
import {
  adminUserListQuerySchema,
  assignRoleSchema,
  changeAdminStatusSchema,
  createAdminUserSchema,
  marketGrantSchema,
  marketRevokeSchema,
  replaceRolePermissionsSchema,
  roleCommandSchema,
  type AdminUserListQueryDto,
  type AssignRoleDto,
  type ChangeAdminStatusDto,
  type CreateAdminUserDto,
  type MarketGrantDto,
  type MarketRevokeDto,
  type ReplaceRolePermissionsDto,
  type RoleCommandDto,
} from './access-administration.dto.js';
import { RbacGuard, RequirePermission } from './rbac.guard.js';

@ApiTags('Admin Access Administration')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(AuthGuard, RbacGuard)
export class AccessAdministrationController {
  constructor(
    @Inject(AccessAdministrationService)
    private readonly administration: AccessAdministrationService,
  ) {}

  @Get('users')
  @RequirePermission('admin.user.read')
  listUsers(
    @Query(new ZodValidationPipe(adminUserListQuerySchema))
    query: AdminUserListQueryDto,
  ) {
    return this.administration.listAdminUsers(query.limit);
  }

  @Get('users/:adminUserId')
  @RequirePermission('admin.user.read')
  userDetail(@Param('adminUserId') adminUserId: string) {
    return this.administration.getAdminUser(adminUserId);
  }

  @Post('users')
  @RequirePermission('admin.user.manage', {
    targetBodyFields: ['account_id'],
  })
  createUser(
    @CurrentActor() actor: RequestActor,
    @Body(new ZodValidationPipe(createAdminUserSchema))
    input: CreateAdminUserDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    this.requireIdempotencyKey(key);
    return this.administration.createAdminUser(
      { accountId: input.account_id, displayName: input.display_name },
      this.action(actor, input.reason, request, ipAddress),
    );
  }

  @Patch('users/:adminUserId/status')
  @RequirePermission('admin.user.manage', {
    targetParams: ['adminUserId'],
  })
  changeStatus(
    @CurrentActor() actor: RequestActor,
    @Param('adminUserId') adminUserId: string,
    @Body(new ZodValidationPipe(changeAdminStatusSchema))
    input: ChangeAdminStatusDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    this.requireIdempotencyKey(key);
    return this.administration.changeAdminStatus(
      adminUserId,
      { status: input.status, expectedUpdatedAt: input.expected_updated_at },
      this.action(actor, input.reason, request, ipAddress),
    );
  }

  @Get('roles')
  @RequirePermission('rbac.role.read')
  listRoles() {
    return this.administration.listRoleTemplates();
  }

  @Post('users/:adminUserId/roles')
  @RequirePermission('rbac.role.assign', {
    targetParams: ['adminUserId'],
    targetBodyFields: ['role_id'],
  })
  @HttpCode(200)
  async assignRole(
    @CurrentActor() actor: RequestActor,
    @Param('adminUserId') adminUserId: string,
    @Body(new ZodValidationPipe(assignRoleSchema)) input: AssignRoleDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    this.requireIdempotencyKey(key);
    await this.administration.assignRole(
      adminUserId,
      input.role_id,
      this.action(actor, input.reason, request, ipAddress),
    );
    return { adminUserId, roleId: input.role_id, assigned: true };
  }

  @Delete('users/:adminUserId/roles/:roleId')
  @RequirePermission('rbac.role.assign', {
    targetParams: ['adminUserId', 'roleId'],
  })
  async revokeRole(
    @CurrentActor() actor: RequestActor,
    @Param('adminUserId') adminUserId: string,
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(roleCommandSchema)) input: RoleCommandDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    this.requireIdempotencyKey(key);
    const revoked = await this.administration.revokeRole(
      adminUserId,
      roleId,
      this.action(actor, input.reason, request, ipAddress),
    );
    return { adminUserId, roleId, revoked };
  }

  @Get('permissions')
  @RequirePermission('rbac.permission.read')
  listPermissions() {
    return this.administration.listPermissionCatalog();
  }

  @Put('roles/:roleId/permissions')
  @RequirePermission('rbac.permission.assign', {
    targetParams: ['roleId'],
  })
  replaceRolePermissions(
    @CurrentActor() actor: RequestActor,
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(replaceRolePermissionsSchema))
    input: ReplaceRolePermissionsDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    this.requireIdempotencyKey(key);
    return this.administration.replaceRoleTemplatePermissions(
      roleId,
      {
        permissionCodes: input.permission_codes,
        expectedUpdatedAt: input.expected_updated_at,
      },
      this.action(actor, input.reason, request, ipAddress),
    );
  }

  @Get('users/:adminUserId/market-grants')
  @RequirePermission('rbac.market.read')
  listMarketGrants(@Param('adminUserId') adminUserId: string) {
    return this.administration.listMarketGrants(adminUserId);
  }

  @Post('users/:adminUserId/market-grants')
  @RequirePermission('rbac.market.grant', {
    targetParams: ['adminUserId'],
    targetBodyFields: ['market_id'],
  })
  @HttpCode(200)
  async grantMarket(
    @CurrentActor() actor: RequestActor,
    @Param('adminUserId') adminUserId: string,
    @Body(new ZodValidationPipe(marketGrantSchema)) input: MarketGrantDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    this.requireIdempotencyKey(key);
    await this.administration.grantMarketAccess(
      adminUserId,
      input.market_id,
      this.action(actor, input.reason, request, ipAddress),
    );
    return { adminUserId, marketId: input.market_id, granted: true };
  }

  @Delete('users/:adminUserId/market-grants/:marketId')
  @RequirePermission('rbac.market.grant', {
    targetParams: ['adminUserId', 'marketId'],
  })
  async revokeMarket(
    @CurrentActor() actor: RequestActor,
    @Param('adminUserId') adminUserId: string,
    @Param('marketId') marketId: string,
    @Body(new ZodValidationPipe(marketRevokeSchema)) input: MarketRevokeDto,
    @Headers('idempotency-key') key: string | undefined,
    @Ip() ipAddress: string,
    @Req() request: Request,
  ) {
    this.requireIdempotencyKey(key);
    const revoked = await this.administration.revokeMarketAccess(
      adminUserId,
      marketId,
      this.action(actor, input.reason, request, ipAddress),
    );
    return { adminUserId, marketId, revoked };
  }

  private action(
    actor: RequestActor,
    reason: string | undefined,
    request: Request,
    ipAddress: string,
  ) {
    const requestId = (request as unknown as Record<string, unknown>)[
      'requestId'
    ];
    return {
      adminUserId: actor.adminUserId!,
      sessionId: actor.sessionId,
      reason,
      ipAddress,
      userAgent: request.headers['user-agent'],
      ...(typeof requestId === 'string' ? { requestId } : {}),
    };
  }

  private requireIdempotencyKey(value: string | undefined): void {
    if (!value || value.length < 8 || value.length > 128) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'A valid Idempotency-Key header is required.',
      });
    }
  }
}

import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { RbacGuard, RequirePermission } from '../platform-access/rbac.guard.js';
import { AdminMerchantOpsService } from './admin-merchant-ops.service.js';
import type { AdminMerchantBranchDetailDto } from './admin-merchant-ops.types.js';

/**
 * P7-S5B Admin Merchant Operations — selected-market branch-detail read.
 *
 * The market contract is enforced by the same canonical RbacGuard used by
 * the Phase 1 owner controllers: `marketScoped` resolves the server-owned
 * Current Admin Market from the session, verifies the market grant, and
 * rejects any URL/header market mismatch with MARKET_CONTEXT_MISMATCH. The
 * adapter only adds the branch-detail composition the owner does not expose
 * to admin actors; all approved status actions, queues, and MCP surfaces are
 * consumed directly from the owner controllers (no duplicated logic).
 */
@ApiTags('Admin Merchant Operations')
@ApiBearerAuth()
@Controller('admin/markets')
@UseGuards(AuthGuard, RbacGuard)
export class AdminMerchantOpsController {
  constructor(
    @Inject(AdminMerchantOpsService)
    private readonly ops: AdminMerchantOpsService,
  ) {}

  @Get(':marketId/merchants/:branchId/detail')
  @RequirePermission('merchant.view', { marketScoped: true })
  @ApiOperation({
    summary:
      'Selected-market merchant branch detail (profile, application, masked KYC, package history, MCP summary).',
    description:
      'Composition of owner read surfaces, server-scoped to the Current Admin Market. KYC is owner-masked; MCP is account summary + reconciliation + bounded recent ledger (no raw export); package history is a read-only projection of immutable owner history.',
  })
  @ApiResponse({ status: 200, description: 'Branch detail.' })
  @ApiResponse({ status: 403, description: 'Permission or market denied.' })
  @ApiResponse({ status: 404, description: 'Branch not found in market.' })
  @ApiResponse({ status: 409, description: 'Market context mismatch.' })
  branchDetail(
    @Param('marketId', new ParseUUIDPipe()) marketId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ): Promise<AdminMerchantBranchDetailDto> {
    return this.ops.branchDetail(marketId, branchId);
  }
}

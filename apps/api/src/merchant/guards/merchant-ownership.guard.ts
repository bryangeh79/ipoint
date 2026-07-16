import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/auth.guard.js';
import { MerchantService } from '../merchant.service.js';

@Injectable()
export class MerchantOwnershipGuard implements CanActivate {
  constructor(
    @Inject(MerchantService) private readonly merchants: MerchantService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const branchId = request.params?.['branchId'];
    const accountId = request.actor?.accountId;
    const header = request.headers['x-market-id'];
    const marketId = Array.isArray(header) ? header[0] : header;
    if (!accountId || typeof branchId !== 'string') return false;
    await this.merchants.assertOwnership(accountId, branchId, marketId);
    return true;
  }
}

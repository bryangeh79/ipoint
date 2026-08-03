import { NotFoundException } from '@nestjs/common';

/**
 * P7-S5B Admin Merchant Operations — error helpers.
 *
 * The adapter surfaces owner errors unchanged (owner NotFoundException etc.
 * propagate as-is). This module only adds the cross-market isolation error:
 * a branch that exists but belongs to a different market is reported exactly
 * like a missing branch (404), so the read surface never leaks the existence
 * of out-of-market branches.
 */
export function adminMerchantBranchNotFound(): never {
  throw new NotFoundException({
    code: 'MERCHANT_BRANCH_NOT_FOUND',
    message: 'Merchant branch not found.',
  });
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

/**
 * D-051 — Phase 1 special-percentage owner command error codes.
 *
 * Every control of the secured owner command
 * (`PackageService.createSpecialPercentage`) surfaces a typed code so the
 * canonical Phase 1 route and any in-process caller observe the same
 * contract. Codes follow the accepted D-054 owner convention
 * (`COMMISSION_RATE_*` → `SPECIAL_PERCENTAGE_*`).
 */
export const specialPercentageErrorCodes = {
  permissionDenied: 'SPECIAL_PERCENTAGE_PERMISSION_DENIED',
  marketSelectionRequired: 'SPECIAL_PERCENTAGE_MARKET_SELECTION_REQUIRED',
  marketContextMismatch: 'SPECIAL_PERCENTAGE_MARKET_CONTEXT_MISMATCH',
  marketNotFound: 'SPECIAL_PERCENTAGE_MARKET_NOT_FOUND',
  marketAccessDenied: 'SPECIAL_PERCENTAGE_MARKET_ACCESS_DENIED',
  reasonRequired: 'SPECIAL_PERCENTAGE_REASON_REQUIRED',
  idempotencyKeyRequired: 'SPECIAL_PERCENTAGE_IDEMPOTENCY_KEY_REQUIRED',
  idempotencyConflict: 'SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT',
  createFailed: 'SPECIAL_PERCENTAGE_CREATE_FAILED',
} as const;

export function specialPercentagePermissionDenied(): never {
  throw new ForbiddenException({
    code: specialPercentageErrorCodes.permissionDenied,
    message: 'You do not have permission to create a special percentage.',
  });
}

export function specialPercentageMarketSelectionRequired(): never {
  throw new ConflictException({
    code: specialPercentageErrorCodes.marketSelectionRequired,
    message: 'Select an authorized market to continue.',
  });
}

export function specialPercentageMarketContextMismatch(): never {
  throw new ConflictException({
    code: specialPercentageErrorCodes.marketContextMismatch,
    message: 'The selected market changed. Refresh and try again.',
  });
}

export function specialPercentageMarketNotFound(): never {
  throw new NotFoundException({
    code: specialPercentageErrorCodes.marketNotFound,
    message: 'The selected market does not exist or is not active.',
  });
}

export function specialPercentageMarketAccessDenied(): never {
  throw new ForbiddenException({
    code: specialPercentageErrorCodes.marketAccessDenied,
    message: 'You do not have access to this market.',
  });
}

export function specialPercentageReasonRequired(): never {
  throw new BadRequestException({
    code: specialPercentageErrorCodes.reasonRequired,
    message:
      'A reason of 1 to 500 characters is required for this privileged action.',
  });
}

export function specialPercentageIdempotencyKeyRequired(): never {
  throw new BadRequestException({
    code: specialPercentageErrorCodes.idempotencyKeyRequired,
    message: 'A valid Idempotency-Key header is required.',
  });
}

export function specialPercentageIdempotencyConflict(): never {
  throw new ConflictException({
    code: specialPercentageErrorCodes.idempotencyConflict,
    message: 'The Idempotency-Key cannot be reused for this request.',
  });
}

export function specialPercentageCreateFailed(): never {
  throw new ConflictException({
    code: specialPercentageErrorCodes.createFailed,
    message: 'The special percentage could not be created.',
  });
}

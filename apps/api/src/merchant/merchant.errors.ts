import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

export const merchantErrorCodes = {
  branchNotFound: 'MERCHANT_BRANCH_NOT_FOUND',
  ownershipDenied: 'MERCHANT_OWNERSHIP_DENIED',
  marketMismatch: 'MERCHANT_MARKET_MISMATCH',
  invalidTransition: 'MERCHANT_INVALID_TRANSITION',
  idempotencyRequired: 'IDEMPOTENCY_KEY_REQUIRED',
  idempotencyConflict: 'IDEMPOTENCY_KEY_CONFLICT',
  galleryLimit: 'MERCHANT_GALLERY_LIMIT_REACHED',
  registrationConflict: 'MERCHANT_REGISTRATION_CONFLICT',
  otpInvalid: 'MERCHANT_REGISTRATION_OTP_INVALID',
  referralInvalid: 'MERCHANT_REFERRAL_INVALID',
} as const;

export function merchantBadRequest(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

export function merchantConflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

export function merchantForbidden(code: string, message: string): never {
  throw new ForbiddenException({ code, message });
}

export function merchantNotFound(): never {
  throw new NotFoundException({
    code: merchantErrorCodes.branchNotFound,
    message: 'Merchant branch not found.',
  });
}

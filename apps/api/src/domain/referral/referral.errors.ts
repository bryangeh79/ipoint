/**
 * Referral Engine Domain Errors
 *
 * Defines domain-specific error types for referral operations.
 *
 * @packageDocumentation
 */

/* ------------------------------------------------------------------ */
/*  Error Codes                                                        */
/* ------------------------------------------------------------------ */

export type ReferralErrorCode =
  | 'REFERRAL_CODE_NOT_FOUND'
  | 'REFERRAL_SELF_REFERENCE'
  | 'REFERRAL_CYCLE_DETECTED'
  | 'REFERRAL_ALREADY_EXISTS';

/* ------------------------------------------------------------------ */
/*  Error Class                                                        */
/* ------------------------------------------------------------------ */

export class ReferralError extends Error {
  constructor(
    readonly code: ReferralErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ReferralError';
  }
}

/* ------------------------------------------------------------------ */
/*  Factory Functions                                                  */
/* ------------------------------------------------------------------ */

export function referralCodeNotFoundError(referralCode: string): ReferralError {
  return new ReferralError(
    'REFERRAL_CODE_NOT_FOUND',
    `No member found with referral code: ${referralCode}`,
    { referralCode },
  );
}

export function referralSelfReferenceError(): ReferralError {
  return new ReferralError(
    'REFERRAL_SELF_REFERENCE',
    'A member cannot refer themselves.',
  );
}

export function referralCycleDetectedError(): ReferralError {
  return new ReferralError(
    'REFERRAL_CYCLE_DETECTED',
    'This referral would create a cycle in the referral tree.',
  );
}

export function referralAlreadyExistsError(memberId: string): ReferralError {
  return new ReferralError(
    'REFERRAL_ALREADY_EXISTS',
    `Member ${memberId} already has a referrer.`,
    { memberId },
  );
}

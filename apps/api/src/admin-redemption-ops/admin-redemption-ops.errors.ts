import {
  AdminRedemptionOpsError,
  REDEMPTION_RATE_TECHNICAL_DECIMALS,
} from './admin-redemption-ops.types.js';

/** The market does not exist or is not active. */
export function redemptionMarketNotFoundError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_MARKET_NOT_FOUND',
    'The market was not found.',
  );
}

/**
 * The market has no approved redemption rate configuration (§7.2 / D-053
 * §6 — resolved from the canonical `redemption_rate_market_rules` table
 * by the secured owner). This is the explicit blocked state — the surface
 * NEVER falls back to Malaysia or any other market.
 */
export function redemptionRateMarketBlockedError(
  marketCode: string,
): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_RATE_MARKET_BLOCKED',
    `The redemption rate for market ${marketCode} is not configured yet. Initial, Minimum, Maximum, Currency, and Display Unit must be approved before rates can be managed.`,
    { marketCode },
  );
}

/** The rate is below the approved minimum for the market (§7.2). */
export function redemptionRateBelowMinimumError(
  minimumRate?: string,
): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_RATE_BELOW_MINIMUM',
    minimumRate
      ? `The redemption rate is below the approved minimum of ${minimumRate} for this market.`
      : 'The redemption rate is below the approved minimum for this market.',
    minimumRate ? { minimumRate } : undefined,
  );
}

/** The rate is above the approved maximum for the market (§7.2). */
export function redemptionRateAboveMaximumError(
  maximumRate?: string,
): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_RATE_ABOVE_MAXIMUM',
    maximumRate
      ? `The redemption rate is above the approved maximum of ${maximumRate} for this market.`
      : 'The redemption rate is above the approved maximum for this market.',
    maximumRate ? { maximumRate } : undefined,
  );
}

/** The fiat currency does not match the approved market rule (D-053 §6). */
export function redemptionRateCurrencyMismatchError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_RATE_CURRENCY_MISMATCH',
    'The fiat currency does not match the approved market configuration.',
  );
}

/** More than the §7.2 technical ceiling of ten decimals were supplied. */
export function redemptionRatePrecisionExceededError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_RATE_PRECISION_EXCEEDED',
    `The redemption rate supports at most ${REDEMPTION_RATE_TECHNICAL_DECIMALS} decimal places.`,
    { maxDecimals: REDEMPTION_RATE_TECHNICAL_DECIMALS },
  );
}

/** Activation must be at a strictly future market-local 00:00. */
export function redemptionActivationNotFutureError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_ACTIVATION_NOT_FUTURE',
    'Redemption rates activate only at a future market-local 00:00. Same-day or backdated activation is not allowed.',
  );
}

/** The new version would overlap the effective window of an existing version. */
export function redemptionRateOverlapError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_RATE_OVERLAP',
    'The effective window overlaps another redemption rate version for this market.',
  );
}

/** The Idempotency-Key was already used with a different payload. */
export function redemptionIdempotencyConflictError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_IDEMPOTENCY_CONFLICT',
    'The Idempotency-Key was already used with a different payload.',
  );
}

/** The rate version does not exist. */
export function redemptionRateVersionNotFoundError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_RATE_VERSION_NOT_FOUND',
    'The redemption rate version was not found.',
  );
}

// ─── Secured-owner-sourced rejections (D-053, mapped to the S6C external
//     contract — same codes/statuses the pre-rewiring surface used) ────

/** The authenticated admin lacks the redemption.rate.manage permission. */
export function redemptionPermissionDeniedError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'PERMISSION_DENIED',
    'You do not have permission for this action.',
  );
}

/** The admin has no active grant for the selected market. */
export function redemptionMarketAccessDeniedError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'MARKET_ACCESS_DENIED',
    'The administrator does not have access to this market.',
  );
}

/** The actor has no server-owned Current Admin Market selected. */
export function redemptionMarketSelectionRequiredError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'MARKET_SELECTION_REQUIRED',
    'Select an authorized market to continue.',
  );
}

/** The resource market disagrees with the server Current Admin Market. */
export function redemptionMarketContextMismatchError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'MARKET_CONTEXT_MISMATCH',
    'The selected market changed. Refresh and try again.',
  );
}

/** A valid Idempotency-Key is mandatory for every write. */
export function redemptionIdempotencyKeyRequiredError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'IDEMPOTENCY_KEY_REQUIRED',
    'A valid Idempotency-Key header is required.',
  );
}

/** A reason between 1 and 500 characters is mandatory. */
export function redemptionReasonRequiredError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REASON_REQUIRED',
    'A reason between 1 and 500 characters is required.',
  );
}

/** Only a scheduled, not-yet-effective version can be cancelled. */
export function redemptionRateCannotCancelEffectiveError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE',
    'Only a scheduled, not-yet-effective redemption rate version can be cancelled.',
  );
}

/** The version was already cancelled (append-only, at most once). */
export function redemptionRateAlreadyCancelledError(): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_RATE_ALREADY_CANCELLED',
    'This redemption rate version has already been cancelled.',
  );
}

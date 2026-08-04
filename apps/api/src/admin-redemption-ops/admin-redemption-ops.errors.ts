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
 * The market has no approved redemption rate configuration (§7.2). This is
 * the explicit blocked state — the surface NEVER falls back to Malaysia or
 * any other market.
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
  minimumRate: string,
): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_RATE_BELOW_MINIMUM',
    `The redemption rate is below the approved minimum of ${minimumRate} for this market.`,
    { minimumRate },
  );
}

/** The rate is above the approved maximum for the market (§7.2). */
export function redemptionRateAboveMaximumError(
  maximumRate: string,
): AdminRedemptionOpsError {
  return new AdminRedemptionOpsError(
    'REDEMPTION_RATE_ABOVE_MAXIMUM',
    `The redemption rate is above the approved maximum of ${maximumRate} for this market.`,
    { maximumRate },
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

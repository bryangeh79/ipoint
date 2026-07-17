export type AuthErrorCode =
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_ACCOUNT_INACTIVE'
  | 'AUTH_MEMBER_INACTIVE'
  | 'AUTH_MEMBER_ALREADY_EXISTS'
  | 'AUTH_SESSION_INVALID'
  | 'AUTH_REFRESH_REUSED'
  | 'AUTH_OTP_INVALID'
  | 'AUTH_OTP_EXPIRED'
  | 'AUTH_OTP_ATTEMPTS_EXHAUSTED'
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_PASSWORD_WEAK'
  | 'AUTH_IDEMPOTENCY_CONFLICT'
  | 'AUTH_IDEMPOTENCY_REQUIRED'
  | 'AUTH_MARKET_INVALID'
  | 'AUTH_REFERRAL_INVALID'
  | 'AUTH_FLOW_INVALID'
  | 'AUTH_FLOW_EXPIRED'
  | 'AUTH_OTP_COOLDOWN'
  | 'AUTH_IDENTIFIER_GENERATION_FAILED';

export class AuthError extends Error {
  readonly retryAfterSeconds?: number;

  constructor(
    readonly code: AuthErrorCode,
    message: string,
    options: { retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'AuthError';
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export type AuthErrorCode =
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_ACCOUNT_INACTIVE'
  | 'AUTH_SESSION_INVALID'
  | 'AUTH_REFRESH_REUSED'
  | 'AUTH_OTP_INVALID'
  | 'AUTH_OTP_EXPIRED'
  | 'AUTH_OTP_ATTEMPTS_EXHAUSTED'
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_PASSWORD_WEAK';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

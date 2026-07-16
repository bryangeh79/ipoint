import type {
  AccountStatus,
  OtpPurpose,
  OtpRecord,
  PasswordIdentity,
  RequestMetadata,
  SessionRecord,
} from './auth.types.js';

export interface NewSession {
  accountId: string;
  familyId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  metadata: RequestMetadata;
}

export type RotateSessionResult =
  | { kind: 'ROTATED'; sessionId: string; accountId: string }
  | { kind: 'NOT_FOUND' | 'EXPIRED' | 'INACTIVE' | 'REUSED' };

export interface NewOtp {
  id: string;
  accountId: string | null;
  destination: string;
  purpose: OtpPurpose;
  codeHash: string;
  maxAttempts: number;
  expiresAt: Date;
}

export interface AuthStorePort {
  findPasswordIdentity(email: string): Promise<PasswordIdentity | null>;
  setPasswordCredential(accountId: string, secretHash: string): Promise<void>;
  createSession(session: NewSession): Promise<string>;
  findAccessSession(accessTokenHash: string): Promise<SessionRecord | null>;
  rotateSession(
    refreshTokenHash: string,
    replacement: NewSession,
    now: Date,
  ): Promise<RotateSessionResult>;
  revokeSession(
    accessTokenHash: string,
    reason: string,
    now: Date,
  ): Promise<boolean>;
  createOtp(otp: NewOtp): Promise<void>;
  findOtp(id: string): Promise<OtpRecord | null>;
  incrementOtpAttempts(id: string): Promise<number>;
  markOtpVerified(id: string, now: Date): Promise<boolean>;
  consumeOtp(id: string, now: Date): Promise<boolean>;
  resetPasswordWithOtp(
    otpId: string,
    accountId: string,
    secretHash: string,
    now: Date,
  ): Promise<boolean>;
  recordSecurityEvent(input: {
    accountId?: string;
    eventType: string;
    result: 'SUCCESS' | 'FAILURE' | 'DENIED';
    metadata: RequestMetadata;
    details?: Record<string, unknown>;
  }): Promise<void>;
  getAccountStatus(accountId: string): Promise<AccountStatus | null>;
}

export type AccountStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'LOCKED'
  | 'ARCHIVED';

export type MemberStatus =
  | 'PENDING_EMAIL_VERIFICATION'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'CLOSED';

export type OtpPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'STEP_UP';

export interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface RequestActor {
  type: 'ACCOUNT' | 'ADMIN_USER';
  accountId: string;
  sessionId: string;
  adminUserId?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export interface PasswordIdentity {
  accountId: string;
  status: AccountStatus;
  memberId: string | null;
  memberStatus: MemberStatus | null;
  secretHash: string;
}

export interface SessionRecord {
  id: string;
  accountId: string;
  familyId: string;
  status: AccountStatus;
  expiresAt: Date;
  revokedAt: Date | null;
  adminUserId: string | null;
}

export interface OtpRecord {
  id: string;
  accountId: string | null;
  destination: string;
  purpose: OtpPurpose;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  consumedAt: Date | null;
}

export interface MemberEmailOtpRecord {
  id: string;
  purpose: 'REGISTRATION' | 'PASSWORD_RESET';
  memberId: string | null;
  accountId: string | null;
  email: string;
  accountCountry: string | null;
  passwordHash: string | null;
  referralCode: string | null;
  referrerMemberId: string | null;
  termsVersion: string | null;
  disclaimerVersion: string | null;
  privacyVersion: string | null;
  locale: string | null;
  otpHash: string;
  otpVersion: number;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  resendAvailableAt: Date;
  verifiedAt: Date | null;
  usedAt: Date | null;
}

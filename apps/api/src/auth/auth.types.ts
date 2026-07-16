export type AccountStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'LOCKED'
  | 'ARCHIVED';

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

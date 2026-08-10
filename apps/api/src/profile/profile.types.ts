export class ProfileError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProfileError';
    this.code = code;
  }
}

export interface ProfileResponse {
  id: string;
  memberId: string;
  displayName: string | null;
  fullName: string | null;
  phone: string | null;
  phoneNormalized: string | null;
  phoneVerificationStatus: string;
  phoneVerifiedAt: string | null;
  phoneChangedAt: string | null;
  birthDate: string | null;
  address: Record<string, unknown> | null;
  avatarObjectKey: string | null;
  language: string | null;
  locale: string | null;
  marketingOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileInput {
  displayName?: string | null;
  fullName?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  address?: Record<string, unknown> | null;
  avatarObjectKey?: string | null;
  language?: string | null;
  locale?: string | null;
  marketingOptIn?: boolean;
  gender?: string;
}

/**
 * Current-member summary served by GET /members/me (DEF-002 fix).
 * Shape mirrors the member-web `User` contract consumed by AuthProvider.
 */
export interface MemberSelfResponse {
  /** members.id */
  id: string;
  /** accounts.email */
  email: string;
  /** member_profiles.displayName */
  name: string | null;
  /** member_profiles.phone */
  phone: string | null;
  /** accounts.accountCountry */
  countryCode: string;
  /** Derived from the member KYC case status (fallback: kyc_level). */
  kycStatus: 'not_started' | 'pending' | 'approved' | 'rejected';
  /** members.createdAt */
  createdAt: string;
}

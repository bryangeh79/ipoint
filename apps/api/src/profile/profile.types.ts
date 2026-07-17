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

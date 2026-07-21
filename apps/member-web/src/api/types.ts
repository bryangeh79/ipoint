/**
 * Domain types used across member-web pages.
 * These mirror the backend API response shapes.
 */

export interface MemberProfile {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  countryCode?: string;
  kycStatus: KycStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Market {
  id: string;
  code: string;
  name: string;
  currency: string;
  isActive: boolean;
}

export interface Merchant {
  id: string;
  name: string;
  description?: string;
  logoUrl?: string;
  category?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  distance?: number;
  isActive: boolean;
}

export type KycStatus =
  | 'NOT_STARTED'
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'MORE_INFO_REQUIRED'
  | 'REVERIFICATION_REQUIRED';

export type KycIdentificationType =
  | 'PASSPORT'
  | 'NATIONAL_ID'
  | 'DRIVING_LICENSE'
  | 'RESIDENCE_PERMIT'
  | 'OTHER';

export type KycDocumentType =
  | 'IDENTITY_FRONT'
  | 'IDENTITY_BACK'
  | 'PASSPORT'
  | 'PROOF_OF_ADDRESS'
  | 'SELFIE'
  | 'OTHER';

export interface MemberKycDocumentResponse {
  id: string;
  documentType: string;
  mimeType: string;
  size: number;
  checksum: string;
  createdAt: string;
}

export interface MemberKycResponse {
  id: string | null;
  status: KycStatus;
  levelRequested: 'LEVEL_2' | null;
  legalFullName: string | null;
  identificationType: KycIdentificationType | null;
  identificationNumber: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  residentialAddress: Record<string, unknown> | null;
  accountCountrySnapshot: string | null;
  submissionMarketId: string | null;
  consentVersion: string | null;
  submittedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  documents: MemberKycDocumentResponse[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

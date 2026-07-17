export const KYC_STATUSES = [
  'NOT_STARTED',
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'MORE_INFO_REQUIRED',
  'REVERIFICATION_REQUIRED',
] as const;

export type KycStatus = (typeof KYC_STATUSES)[number];

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

export class KycError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'KycError';
  }
}

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

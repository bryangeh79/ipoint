export type CountryChangeStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export interface CountryChangeRequestRow {
  id: string;
  memberId: string;
  accountId: string;
  currentCountry: string;
  requestedCountry: string;
  status: CountryChangeStatus;
  reason: string;
  reviewedByAdminUserId: string | null;
  reviewReason: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CountryChangeRequestResponse {
  id: string;
  currentCountry: string;
  requestedCountry: string;
  status: CountryChangeStatus;
  reason: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AdminKycStatus =
  | 'NOT_STARTED'
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'MORE_INFO_REQUIRED'
  | 'REVERIFICATION_REQUIRED';

export interface AdminKycActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
}

export interface AdminKycMemberInfo {
  publicMemberId: string;
  displayName: string | null;
  email: string;
  accountCountry: string;
  status: string;
  kycLevel: string;
}

export interface AdminKycCaseListItem {
  id: string;
  marketId: string;
  status: AdminKycStatus;
  levelRequested: string;
  member: AdminKycMemberInfo;
  submittedAt: string | null;
  reviewedAt: string | null;
  updatedAt: string;
}

export interface AdminKycDocumentResponse {
  id: string;
  documentType: string;
  mimeType: string;
  size: number;
  checksum: string;
  scanStatus: string;
  createdAt: string;
}

export interface AdminKycHistoryResponse {
  id: string;
  eventType: string;
  actorType: string;
  actorId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface AdminKycCaseResponse extends AdminKycCaseListItem {
  version: number;
  legalFullName: string | null;
  identificationType: string | null;
  identificationNumber: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  residentialAddress: Record<string, unknown> | null;
  accountCountrySnapshot: string | null;
  submissionMarketId: string | null;
  consentVersion: string | null;
  reviewedByAdminUserId: string | null;
  decisionReason: string | null;
  reverificationRequiredAt: string | null;
  createdAt: string;
  documents: AdminKycDocumentResponse[];
  history: AdminKycHistoryResponse[];
}

export interface AdminKycCaseListResponse {
  items: AdminKycCaseListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export type AdminMemberStatus =
  | 'PENDING_EMAIL_VERIFICATION'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'CLOSED';

export type AdminMemberKycLevel = 'NONE' | 'LEVEL_1' | 'LEVEL_2';

export type AdminMemberErrorCode =
  | 'ADMIN_MEMBER_NOT_FOUND'
  | 'ADMIN_MEMBER_INVALID_STATUS'
  | 'ADMIN_MEMBER_STATUS_TRANSITION_FAILED'
  | 'ADMIN_MEMBER_CLOSE_CONFIRMATION_REQUIRED'
  | 'ADMIN_MEMBER_ALREADY_CLOSED'
  | 'ADMIN_MEMBER_NOTE_TOO_LONG'
  | 'ADMIN_MEMBER_NOTE_EMPTY'
  | 'ADMIN_MEMBER_KYC_REVERIFICATION_NOT_ALLOWED'
  | 'ADMIN_MEMBER_MARKET_ACCESS_DENIED'
  | 'ADMIN_MEMBER_IDEMPOTENCY_CONFLICT';

export class AdminMemberError extends Error {
  constructor(
    readonly code: AdminMemberErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AdminMemberError';
  }
}

export interface AdminMemberActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
}

export interface AdminMemberListItem {
  publicMemberId: string;
  displayName: string | null;
  email: string;
  status: AdminMemberStatus;
  kycLevel: AdminMemberKycLevel;
  accountCountry: string;
  currentMarketId: string;
  createdAt: string;
}

export interface AdminMemberListResponse {
  members: AdminMemberListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminMemberDetailResponse extends AdminMemberListItem {
  closedAt: string | null;
  profile: {
    fullName: string | null;
    phone: string | null;
    phoneVerificationStatus: string;
    birthDate: string | null;
    address: Record<string, unknown> | null;
    locale: string | null;
    language: string | null;
  };
  kyc: {
    caseId: string;
    marketId: string;
    status: string;
    levelRequested: string;
    legalFullName: string | null;
    identificationType: string | null;
    identificationNumber: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
    reverificationRequiredAt: string | null;
  } | null;
  marketPreferences: Array<{
    marketId: string;
    marketCode: string;
    isEnabled: boolean;
    isCurrent: boolean;
    sortOrder: number;
    lastSelectedAt: string | null;
  }>;
  notes: Array<{
    id: string;
    adminUserId: string;
    marketId: string;
    content: string;
    isInternal: boolean;
    createdAt: string;
  }>;
  statusHistory: Array<{
    id: string;
    fromStatus: AdminMemberStatus | null;
    toStatus: AdminMemberStatus;
    actorType: string;
    actorId: string | null;
    reason: string | null;
    occurredAt: string;
  }>;
}

export interface AdminMemberNote {
  id: string;
  adminUserId: string;
  marketId: string;
  content: string;
  isInternal: boolean;
  createdAt: string;
}

export interface AdminMemberNotesListResponse {
  notes: AdminMemberNote[];
  total: number;
  page: number;
  pageSize: number;
}

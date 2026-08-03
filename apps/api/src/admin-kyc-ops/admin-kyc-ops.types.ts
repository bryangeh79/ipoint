import type {
  AdminKycActor,
  AdminKycCaseListResponse,
  AdminKycCaseResponse,
} from '../admin-kyc/admin-kyc.types.js';

/**
 * P7-S5C Admin KYC Operations adapter types.
 *
 * The member-side responses reuse the frozen Phase 2 Admin KYC response
 * contracts verbatim (masking, pagination shape, documents metadata,
 * history) and only add the selected-market envelope plus the §6.4
 * evidence-access markers. The merchant-side responses reuse the frozen
 * Phase 1 merchant KYC shapes (queue item, submission detail, review
 * metadata) with the owner's own masking helper applied for the masked
 * summary surfaces. No raw document content, object key, or original
 * filename is ever carried on this surface.
 */

/** Member KYC queue/list: owner contract + server-owned market envelope. */
export interface MemberKycOpsListResponse extends AdminKycCaseListResponse {
  /** Server-owned Current Admin Market the list was bounded to. */
  marketId: string;
}

/**
 * Member KYC case detail/evidence: the frozen owner case response plus the
 * §6.4 evidence-access marker. The detail endpoint returns masked identity
 * fields (masked summary); the evidence endpoint returns the owner response
 * verbatim (minimum evidence) behind the dedicated permission.
 */
export interface MemberKycOpsCaseResponse extends AdminKycCaseResponse {
  evidenceAccess: KycOpsEvidenceAccess;
}

/** Evidence-access marker attached to every case response. */
export interface KycOpsEvidenceAccess {
  /** True when the response is the masked summary (evidence not revealed). */
  masked: boolean;
  /** Raw document content is never served on this surface. */
  rawDocumentContent: false;
  /** Every sensitive evidence view is audited server-side. */
  audited: boolean;
}

export type KycOpsErrorCode = 'KYC_OPS_MARKET_MISMATCH';

export class KycOpsError extends Error {
  constructor(
    readonly code: KycOpsErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'KycOpsError';
  }
}

export interface KycOpsActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
}

/** The adapter actor is structurally identical to the frozen owner actor. */
export function toAdminKycActor(actor: KycOpsActor): AdminKycActor {
  return {
    adminUserId: actor.adminUserId,
    ...(actor.requestId ? { requestId: actor.requestId } : {}),
    ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
  };
}

/* ── Merchant KYC queue / detail / review (Phase 1 shapes reused) ───── */

export interface MerchantKycOpsQueueItemDto {
  submission_id: string;
  branch_id: string;
  merchant_id: string;
  display_name: string;
  status: string;
  submission_version: number;
  submitted_at: string | null;
  reviewed_at: string | null;
}

export interface MerchantKycOpsQueueResponseDto {
  items: MerchantKycOpsQueueItemDto[];
  /** Server-owned Current Admin Market the queue was bounded to. */
  marketId: string;
  limit: number;
  offset: number;
}

export interface MerchantKycOpsReviewInfoDto {
  review_id: string;
  reviewer_id: string;
  decision: string;
  reason: string;
  rejected_fields: string[];
  reviewed_at: string | null;
}

export interface MerchantKycOpsSubmissionDetailDto {
  submission_id: string;
  submission_version: number;
  status: string;
  submitted_at: string | null;
  /** Masked (masked summary) or full (evidence) owner snapshot. */
  data: Record<string, unknown>;
  review: MerchantKycOpsReviewInfoDto | null;
}

export interface MerchantKycOpsDetailResponseDto {
  branch_id: string;
  merchant_id: string;
  market_id: string;
  display_name: string;
  current: MerchantKycOpsSubmissionDetailDto;
  previous: MerchantKycOpsSubmissionDetailDto | null;
  evidenceAccess: KycOpsEvidenceAccess;
}

export interface MerchantKycOpsReviewResultDto {
  review_id: string;
  submission_id: string;
  branch_id: string;
  kyc_status: string;
  operational_status: string;
  reason: string;
  rejected_fields: string[];
  reviewed_at: string | null;
}

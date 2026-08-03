import { Inject, Injectable } from '@nestjs/common';
import {
  merchantBranches,
  merchantKycReviews,
  merchantKycSubmissions,
} from '@ipoint/database';
import { desc, eq, inArray } from 'drizzle-orm';
import { AdminKycService } from '../admin-kyc/admin-kyc.service.js';
import type { KycCaseFilterDto } from '../admin-kyc/admin-kyc.dto.js';
import type { AdminKycCaseResponse } from '../admin-kyc/admin-kyc.types.js';
import { DatabaseService } from '../database/database.service.js';
import { MerchantService } from '../merchant/merchant.service.js';
import { merchantNotFound } from '../merchant/merchant.errors.js';
import type {
  MerchantKycQueueDto,
  ReviewMerchantKycDto,
  SubmitMerchantKycDto,
} from '../merchant/dto/kyc.dto.js';
import { maskMerchantKycSnapshot } from '../merchant/kyc-masking.js';
import { AuditService } from '../platform-access/audit.service.js';
import { kycOpsMarketMismatchError } from './admin-kyc-ops.errors.js';
import type {
  KycOpsActor,
  MemberKycOpsCaseResponse,
  MemberKycOpsListResponse,
  MerchantKycOpsDetailResponseDto,
  MerchantKycOpsQueueResponseDto,
  MerchantKycOpsReviewResultDto,
  MerchantKycOpsSubmissionDetailDto,
} from './admin-kyc-ops.types.js';
import { toAdminKycActor } from './admin-kyc-ops.types.js';

/** Structural type of the frozen owner merchant KYC review detail. */
interface OwnerMerchantKycReviewDetail {
  submission_id: string;
  submission_version: number;
  status: string;
  submitted_at: Date | string | null;
  data: SubmitMerchantKycDto;
  review: {
    review_id: string;
    reviewer_id: string;
    decision: string;
    reason: string;
    rejected_fields: string[];
    reviewed_at: Date | string | null;
  } | null;
  branch_id: string;
  merchant_id: string;
  market_id: string;
  previous: {
    submission_id: string;
    submission_version: number;
    status: string;
    submitted_at: Date | string | null;
    data: SubmitMerchantKycDto;
    review: {
      review_id: string;
      reviewer_id: string;
      decision: string;
      reason: string;
      rejected_fields: string[];
      reviewed_at: Date | string | null;
    } | null;
  } | null;
}

/**
 * P7-S5C Admin KYC Operations adapter service.
 *
 * A thin Phase 7 orchestration layer over the frozen Phase 2 member KYC
 * owner (`AdminKycService`, D-048) and the frozen Phase 1 merchant KYC
 * owner (`MerchantService`). It adds exactly two things the owner surfaces
 * do not provide:
 *
 * 1. The P7-S0 selected-market contract (every read/write bounded to the
 *    server-owned Current Admin Market resolved by the RbacGuard).
 * 2. The frozen contract §6.4 evidence rules: masked identity/contact
 *    summaries by default, no raw document content anywhere, and full
 *    (minimum) evidence only behind the dedicated
 *    `member.kyc.evidence.view` / `merchant.kyc.evidence.view` permissions
 *    (which the canonical guard additionally gates with step-up MFA and a
 *    recorded sensitive-access reason), with an audit-of-view record written
 *    for every detail and every evidence view.
 *
 * All domain behaviour — typed validation, state machine, idempotency,
 * masking of identification numbers/emails, and atomic write-audit — stays
 * inside the owner commands, which are invoked unchanged. The adapter writes
 * no domain table and exposes no raw document content or export.
 */
@Injectable()
export class AdminKycOpsService {
  constructor(
    @Inject(AdminKycService) private readonly memberOwner: AdminKycService,
    @Inject(MerchantService) private readonly merchantOwner: MerchantService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /* ── Member KYC ───────────────────────────────────────────────────── */

  /**
   * Selected-market member KYC queue: the owner list is forced to the
   * server-owned market; a client market filter is structurally impossible.
   */
  async listMemberCases(
    actor: KycOpsActor,
    marketId: string,
    filters: Omit<KycCaseFilterDto, 'marketId'>,
  ): Promise<MemberKycOpsListResponse> {
    const response = await this.memberOwner.listCases(toAdminKycActor(actor), {
      ...filters,
      marketId,
    } as KycCaseFilterDto);
    await this.auditView(
      actor,
      { type: 'kyc_queue', id: marketId },
      marketId,
      'member.kyc.ops.queue.view',
      'Administrator viewed the selected-market member KYC queue.',
    );
    return { ...response, marketId };
  }

  /**
   * Masked member KYC case detail (masked summary for every role). The
   * frozen owner response is masked further for identity/contact fields
   * (legal full name, date of birth, residential address) so Support-role
   * reads never receive raw identity evidence; document rows are metadata
   * only (no content, key, or filename). Every view is audited.
   */
  async getMemberCase(
    actor: KycOpsActor,
    marketId: string,
    caseId: string,
  ): Promise<MemberKycOpsCaseResponse> {
    const detail = await this.memberOwner.getCase(
      toAdminKycActor(actor),
      caseId,
    );
    this.assertSelectedMarket(detail.marketId, marketId);
    await this.auditView(
      actor,
      { type: 'member_kyc_case', id: caseId },
      marketId,
      'member.kyc.ops.view',
      'Administrator viewed a masked member KYC case.',
    );
    return {
      ...detail,
      legalFullName: maskFullName(detail.legalFullName),
      dateOfBirth: null,
      residentialAddress: null,
      evidenceAccess: {
        masked: true,
        rawDocumentContent: false,
        audited: true,
      },
    };
  }

  /**
   * Member KYC evidence: the frozen owner case response verbatim (minimum
   * evidence — the owner masks identification numbers and emails). The
   * canonical guard enforces the dedicated permission, step-up MFA, and the
   * recorded sensitive-access reason before this service runs; every view
   * additionally writes an audit-of-view record.
   */
  async getMemberCaseEvidence(
    actor: KycOpsActor,
    marketId: string,
    caseId: string,
  ): Promise<MemberKycOpsCaseResponse> {
    const detail = await this.memberOwner.getCase(
      toAdminKycActor(actor),
      caseId,
    );
    this.assertSelectedMarket(detail.marketId, marketId);
    await this.auditView(
      actor,
      { type: 'member_kyc_case', id: caseId },
      marketId,
      'member.kyc.ops.evidence.view',
      'Administrator viewed sensitive member KYC evidence.',
    );
    return {
      ...detail,
      evidenceAccess: {
        masked: false,
        rawDocumentContent: false,
        audited: true,
      },
    };
  }

  /**
   * Member KYC review actions — the frozen Phase 2 owner commands invoked
   * unchanged (state machine, idempotency, audit). The actor must hold
   * `member.kyc.decide` (guard) and the case must be in the selected market.
   */
  startReview(
    actor: KycOpsActor,
    marketId: string,
    caseId: string,
    input: { reason: string },
    idempotencyKey: string,
  ): Promise<MemberKycOpsCaseResponse> {
    return this.inSelectedMemberMarket(actor, marketId, caseId, (owner) =>
      owner.startReview(toAdminKycActor(actor), caseId, input, idempotencyKey),
    );
  }

  requestMoreInfo(
    actor: KycOpsActor,
    marketId: string,
    caseId: string,
    input: { reason: string },
    idempotencyKey: string,
  ): Promise<MemberKycOpsCaseResponse> {
    return this.inSelectedMemberMarket(actor, marketId, caseId, (owner) =>
      owner.requestMoreInfo(
        toAdminKycActor(actor),
        caseId,
        input,
        idempotencyKey,
      ),
    );
  }

  approve(
    actor: KycOpsActor,
    marketId: string,
    caseId: string,
    input: { reason: string },
    idempotencyKey: string,
  ): Promise<MemberKycOpsCaseResponse> {
    return this.inSelectedMemberMarket(actor, marketId, caseId, (owner) =>
      owner.approve(toAdminKycActor(actor), caseId, input, idempotencyKey),
    );
  }

  reject(
    actor: KycOpsActor,
    marketId: string,
    caseId: string,
    input: { reason: string },
    idempotencyKey: string,
  ): Promise<MemberKycOpsCaseResponse> {
    return this.inSelectedMemberMarket(actor, marketId, caseId, (owner) =>
      owner.reject(toAdminKycActor(actor), caseId, input, idempotencyKey),
    );
  }

  requireReverification(
    actor: KycOpsActor,
    marketId: string,
    caseId: string,
    input: { reason: string },
    idempotencyKey: string,
  ): Promise<MemberKycOpsCaseResponse> {
    return this.inSelectedMemberMarket(actor, marketId, caseId, (owner) =>
      owner.requireReverification(
        toAdminKycActor(actor),
        caseId,
        input,
        idempotencyKey,
      ),
    );
  }

  /* ── Merchant KYC ─────────────────────────────────────────────────── */

  /**
   * Selected-market merchant KYC submissions queue: the frozen Phase 1 owner
   * queue read is bounded to the server-owned market (deterministic
   * ordering: latest submission version first, newest decision first).
   * Queue rows are masked summaries (no submission payload).
   */
  async listMerchantSubmissions(
    actor: KycOpsActor,
    marketId: string,
    query: MerchantKycQueueDto,
  ): Promise<MerchantKycOpsQueueResponseDto> {
    const items = await this.merchantOwner.listKycQueue(marketId, query);
    await this.auditView(
      actor,
      { type: 'kyc_queue', id: marketId },
      marketId,
      'merchant.kyc.ops.queue.view',
      'Administrator viewed the selected-market merchant KYC queue.',
    );
    return {
      items: items.map((item) => ({
        submission_id: item.submission_id,
        branch_id: item.branch_id,
        merchant_id: item.merchant_id,
        display_name: item.display_name,
        status: item.status,
        submission_version: item.submission_version,
        submitted_at: toIsoString(item.submitted_at),
        reviewed_at: toIsoString(item.reviewed_at),
      })),
      marketId,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /**
   * Masked merchant KYC submission detail. This is a read-only projection
   * over immutable owner-owned rows (the owner exposes no admin masked
   * detail read for Support: `getKycForReview` is the review surface with a
   * review-start side effect, and `getKyc` reveals the full snapshot on
   * RESUBMISSION_REQUIRED). The projection applies the owner's own masking
   * helper (`maskMerchantKycSnapshot`) verbatim — no masking logic is
   * reimplemented — and never returns raw document content. Every view is
   * audited.
   */
  async getMerchantKyc(
    actor: KycOpsActor,
    marketId: string,
    branchId: string,
  ): Promise<MerchantKycOpsDetailResponseDto> {
    const rows = await this.database.db
      .select({
        submission: merchantKycSubmissions,
        branch: merchantBranches,
      })
      .from(merchantKycSubmissions)
      .innerJoin(
        merchantBranches,
        eq(merchantBranches.id, merchantKycSubmissions.merchantBranchId),
      )
      .where(eq(merchantKycSubmissions.merchantBranchId, branchId))
      .orderBy(desc(merchantKycSubmissions.submissionVersion))
      .limit(2);
    const current = rows[0];
    if (!current) merchantNotFound();
    this.assertSelectedMarket(current.branch.marketId, marketId);
    const reviews = await this.database.db
      .select()
      .from(merchantKycReviews)
      .where(
        inArray(
          merchantKycReviews.merchantKycSubmissionId,
          rows.map((row) => row.submission.id),
        ),
      )
      .orderBy(desc(merchantKycReviews.decidedAt));
    const currentReview = reviews.find(
      (review) => review.merchantKycSubmissionId === current.submission.id,
    );
    await this.auditView(
      actor,
      { type: 'merchant_kyc_submission', id: current.submission.id },
      marketId,
      'merchant.kyc.ops.view',
      'Administrator viewed a masked merchant KYC submission.',
    );
    return {
      branch_id: branchId,
      merchant_id: current.branch.merchantId,
      market_id: current.branch.marketId,
      display_name: current.branch.name,
      current: this.submissionDetail(current.submission, currentReview, true),
      previous: rows[1]
        ? this.submissionDetail(
            rows[1].submission,
            reviews.find(
              (review) =>
                review.merchantKycSubmissionId === rows[1]?.submission.id,
            ),
            true,
          )
        : null,
      evidenceAccess: {
        masked: true,
        rawDocumentContent: false,
        audited: true,
      },
    };
  }

  /**
   * Merchant KYC evidence: the frozen Phase 1 owner review detail verbatim
   * (`getKycForReview` — full submission snapshot plus the owner's
   * review-start audit on SUBMITTED cases). The canonical guard enforces the
   * dedicated permission, step-up MFA, and the recorded sensitive-access
   * reason; every view additionally writes an audit-of-view record.
   */
  async getMerchantKycEvidence(
    actor: KycOpsActor,
    marketId: string,
    branchId: string,
  ): Promise<MerchantKycOpsDetailResponseDto> {
    await this.assertMerchantBranchMarket(marketId, branchId);
    const detail = await this.merchantOwner.getKycForReview(
      marketId,
      branchId,
      actor.adminUserId,
      {
        ...(actor.requestId ? { requestId: actor.requestId } : {}),
        ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      },
    );
    await this.auditView(
      actor,
      { type: 'merchant_kyc_submission', id: detail.submission_id },
      marketId,
      'merchant.kyc.ops.evidence.view',
      'Administrator viewed sensitive merchant KYC evidence.',
    );
    const branchRows = await this.database.db
      .select({ name: merchantBranches.name })
      .from(merchantBranches)
      .where(eq(merchantBranches.id, branchId))
      .limit(1);
    return this.toDetailResponse(detail, branchRows[0]?.name ?? '');
  }

  /**
   * Merchant KYC review decision — the frozen Phase 1 owner command invoked
   * unchanged (decision + rejected fields, idempotency, atomic audit and
   * operational-status evaluation). The actor must hold
   * `merchant.kyc.approve` (guard) and the branch must be in the selected
   * market.
   */
  async reviewMerchantKyc(
    actor: KycOpsActor,
    marketId: string,
    branchId: string,
    input: ReviewMerchantKycDto,
    idempotencyKey: string,
  ): Promise<MerchantKycOpsReviewResultDto> {
    await this.assertMerchantBranchMarket(marketId, branchId);
    const result = await this.merchantOwner.reviewKyc(
      marketId,
      branchId,
      actor.adminUserId,
      input,
      idempotencyKey,
      {
        ...(actor.requestId ? { requestId: actor.requestId } : {}),
        ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      },
    );
    return {
      review_id: result.review_id,
      submission_id: result.submission_id,
      branch_id: result.branch_id,
      kyc_status: result.kyc_status,
      operational_status: result.operational_status,
      reason: result.reason,
      rejected_fields: result.rejected_fields,
      reviewed_at: toIsoString(result.reviewed_at),
    };
  }

  /* ── Helpers ──────────────────────────────────────────────────────── */

  private async inSelectedMemberMarket(
    actor: KycOpsActor,
    marketId: string,
    caseId: string,
    run: (owner: AdminKycService) => Promise<AdminKycCaseResponse>,
  ): Promise<MemberKycOpsCaseResponse> {
    const detail = await this.memberOwner.getCase(
      toAdminKycActor(actor),
      caseId,
    );
    this.assertSelectedMarket(detail.marketId, marketId);
    const result = await run(this.memberOwner);
    return {
      ...result,
      evidenceAccess: {
        masked: false,
        rawDocumentContent: false,
        audited: false,
      },
    };
  }

  /** Defense-in-depth branch market check before any merchant delegation. */
  private async assertMerchantBranchMarket(
    marketId: string,
    branchId: string,
  ): Promise<void> {
    const rows = await this.database.db
      .select({ id: merchantBranches.id, marketId: merchantBranches.marketId })
      .from(merchantBranches)
      .where(eq(merchantBranches.id, branchId))
      .limit(1);
    if (!rows[0]) merchantNotFound();
    this.assertSelectedMarket(rows[0].marketId, marketId);
  }

  /**
   * Read-only shaping of an owner submission row into the adapter's
   * submission-detail contract. Masking is always the owner's own helper;
   * the review reason decode is a read-only presentation of the owner's
   * stored `KYC_REVIEW_V1:` format (the owner exposes no admin masked read
   * to reuse for Support-role surfaces).
   */
  private submissionDetail(
    submission: typeof merchantKycSubmissions.$inferSelect,
    review: typeof merchantKycReviews.$inferSelect | undefined,
    mask: boolean,
  ): MerchantKycOpsSubmissionDetailDto {
    const data = submission.submittedData as SubmitMerchantKycDto;
    return {
      submission_id: submission.id,
      submission_version: submission.submissionVersion,
      status: review?.decision ?? submission.status,
      submitted_at: toIsoString(submission.submittedAt),
      data: mask ? maskMerchantKycSnapshot(data) : data,
      review: review
        ? {
            review_id: review.id,
            reviewer_id: review.reviewerAdminUserId,
            decision: review.decision,
            reason:
              decodeKycReviewReason(review.reason)?.reason ?? review.reason,
            rejected_fields:
              decodeKycReviewReason(review.reason)?.rejectedFields ?? [],
            reviewed_at: toIsoString(review.decidedAt),
          }
        : null,
    };
  }

  /** Shape the frozen owner review detail into the adapter contract. */
  private toDetailResponse(
    detail: OwnerMerchantKycReviewDetail,
    displayName: string,
  ): MerchantKycOpsDetailResponseDto {
    return {
      branch_id: detail.branch_id,
      merchant_id: detail.merchant_id,
      market_id: detail.market_id,
      display_name: displayName,
      current: {
        submission_id: detail.submission_id,
        submission_version: detail.submission_version,
        status: detail.status,
        submitted_at: toIsoString(detail.submitted_at),
        data: detail.data as unknown as Record<string, unknown>,
        review: detail.review
          ? {
              review_id: detail.review.review_id,
              reviewer_id: detail.review.reviewer_id,
              decision: detail.review.decision,
              reason: detail.review.reason,
              rejected_fields: detail.review.rejected_fields,
              reviewed_at: toIsoString(detail.review.reviewed_at),
            }
          : null,
      },
      previous: detail.previous
        ? {
            submission_id: detail.previous.submission_id,
            submission_version: detail.previous.submission_version,
            status: detail.previous.status,
            submitted_at: toIsoString(detail.previous.submitted_at),
            data: detail.previous.data as unknown as Record<string, unknown>,
            review: detail.previous.review
              ? {
                  review_id: detail.previous.review.review_id,
                  reviewer_id: detail.previous.review.reviewer_id,
                  decision: detail.previous.review.decision,
                  reason: detail.previous.review.reason,
                  rejected_fields: detail.previous.review.rejected_fields,
                  reviewed_at: toIsoString(detail.previous.review.reviewed_at),
                }
              : null,
          }
        : null,
      evidenceAccess: {
        masked: false,
        rawDocumentContent: false,
        audited: true,
      },
    };
  }

  private assertSelectedMarket(caseMarketId: string, marketId: string): void {
    if (caseMarketId !== marketId) throw kycOpsMarketMismatchError();
  }

  /**
   * Audit-of-view through the canonical AuditService (the owner audit
   * trail). The record carries the same internal entity type/id the owner
   * uses for its write-audit so the future Audit Viewer correlates views and
   * owner actions on one entity.
   */
  private async auditView(
    actor: KycOpsActor,
    entity: { type: string; id: string },
    marketId: string,
    action: string,
    summary: string,
  ): Promise<void> {
    await this.audit.recordPrivilegedAction({
      actor: { type: 'ADMIN_USER', id: actor.adminUserId },
      action,
      entity: { type: entity.type, id: entity.id },
      marketId,
      result: 'SUCCESS',
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      summary,
    });
  }
}

/** Mask a full name to first-letter-per-word summaries (KYC adapter). */
export function maskFullName(value: string | null): string | null {
  if (!value) return null;
  const masked = value
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .map((word) => `${word[0]}***`)
    .join(' ');
  return masked.length > 0 ? masked : null;
}

/** Read-only decode of the owner's stored `KYC_REVIEW_V1:` reason format. */
function decodeKycReviewReason(
  value: string,
): { reason: string; rejectedFields: string[] } | null {
  const prefix = 'KYC_REVIEW_V1:';
  if (!value.startsWith(prefix)) return null;
  try {
    const parsed = JSON.parse(value.slice(prefix.length)) as {
      reason?: unknown;
      rejectedFields?: unknown;
    };
    if (
      typeof parsed.reason !== 'string' ||
      !Array.isArray(parsed.rejectedFields) ||
      !parsed.rejectedFields.every((field) => typeof field === 'string')
    ) {
      return null;
    }
    return { reason: parsed.reason, rejectedFields: parsed.rejectedFields };
  } catch {
    return null;
  }
}

function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

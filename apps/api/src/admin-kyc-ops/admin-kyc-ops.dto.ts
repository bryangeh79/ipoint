import {
  approveSchema,
  kycCaseFilterDto,
  rejectSchema,
  requestMoreInfoSchema,
  requireReverificationSchema,
  startReviewSchema,
} from '../admin-kyc/admin-kyc.dto.js';
import {
  merchantKycQueueSchema,
  reviewMerchantKycSchema,
} from '../merchant/dto/kyc.dto.js';

/**
 * P7-S5C Admin KYC Operations query DTOs.
 *
 * The member KYC list schema is the frozen Phase 2 schema reused verbatim,
 * minus the client-supplied `marketId` filter: the adapter derives the
 * market exclusively from the server-owned Current Admin Market resolved by
 * the P7-S2 RbacGuard, so no client input can re-scope a read to another
 * market. Action bodies are the frozen owner schemas imported verbatim
 * (reason-only, strict), so the owner commands receive byte-identical
 * payloads. The merchant KYC queue/review schemas are the frozen Phase 1
 * schemas imported verbatim.
 */

export const memberKycOpsListQuerySchema = kycCaseFilterDto.omit({
  marketId: true,
});

export const merchantKycOpsQueueQuerySchema = merchantKycQueueSchema;

export const memberKycOpsActionSchemas = {
  'start-review': startReviewSchema,
  'request-more-info': requestMoreInfoSchema,
  approve: approveSchema,
  reject: rejectSchema,
  'require-reverification': requireReverificationSchema,
} as const;

export const merchantKycOpsReviewSchema = reviewMerchantKycSchema;

export type MemberKycOpsListQueryDto = ReturnType<
  typeof memberKycOpsListQuerySchema.parse
>;

export type MerchantKycOpsQueueQueryDto = ReturnType<
  typeof merchantKycOpsQueueQuerySchema.parse
>;

export type MemberKycOpsActionDto = ReturnType<
  (typeof memberKycOpsActionSchemas)['start-review']['parse']
>;

export type MerchantKycOpsReviewDto = ReturnType<
  typeof merchantKycOpsReviewSchema.parse
>;

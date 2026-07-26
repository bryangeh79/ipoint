import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
} from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  transactionAuditReferences,
  transactionIdempotencyRecords,
  transactionMcpDebits,
  transactionPreviewSessions,
  transactionRewardLinks,
  transactions,
  transactionServiceFees,
} from '@ipoint/database';
import { Decimal } from 'decimal.js';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { ConfigService } from '../config/config.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type {
  TransactionConfirmDto,
  TransactionConfirmResponse,
  TransactionPreviewDto,
  TransactionPreviewResponse,
} from './transaction.dto.js';
import { TransactionConfirmationRewardWriter } from './transaction-confirmation-reward.writer.js';
import { TransactionCommissionIntegrator } from './transaction-commission.integrator.js';
import {
  transactionBadRequest,
  transactionConflict,
  transactionErrorCodes,
  transactionForbidden,
  transactionNotFound,
} from './transaction.errors.js';
import { TRANSACTION_EXECUTION_OPTIONS } from './transaction-reliability.js';

interface MerchantContext {
  [key: string]: unknown;
  branchId: string;
  merchantAccountId: string;
  marketId: string;
  marketCode: string;
  currencyCode: string;
  timezone: string;
  status: string;
}

interface MarketSettings {
  [key: string]: unknown;
  currencyCode: string;
  currencyScale: number;
  minimumAmount: string;
  maximumAmount: string;
}

interface PackageRow {
  [key: string]: unknown;
  assignmentId: string;
  assignmentVersion: number;
  serviceFeeVersionId: string | null;
  specialPercentageId: string | null;
  packageName: string | null;
  specialName: string | null;
  rate: string;
}

interface MemberRow {
  [key: string]: unknown;
  memberId: string;
  publicMemberId: string;
  memberStatus: string;
  qrStatus: string;
  expiresAt: Date | string | null;
}

interface RewardRuleRow {
  [key: string]: unknown;
  id: string;
  rewardRate: string;
  capType: 'NONE' | 'FLAT' | 'RATIO';
  capValue: string;
  minimumReward: string;
}

interface ConfirmPreviewRow {
  [key: string]: unknown;
  id: string;
  status: string;
  merchantBranchId: string;
  merchantAccountId: string;
  createdByStaffAccountId: string;
  memberId: string;
  protectedMemberReference: string;
  marketId: string;
  currency: string;
  currencyScale: number;
  purchaseAmount: string;
  transactionNote: string | null;
  merchantPackageAssignmentId: string;
  merchantPackageVersion: number;
  merchantPackageSnapshot: Record<string, unknown>;
  serviceFeeRate: string;
  serviceFeeAmount: string;
  estimatedMcpDebit: string;
  rewardRuleVersionId: string;
  rewardRate: string;
  rewardPrincipal: string;
  rewardCap: string;
  dailyRewardAmount: string;
  rewardStartBusinessDate: string;
  marketTimezone: string;
  roundingMode: string;
  previewedAt: Date | string;
  expiresAt: Date | string | null;
  merchantStatus: string;
  publicMerchantId: string;
  merchantName: string;
  branchName: string;
  marketCode: string;
  memberStatus: string;
  memberDisplayName: string | null;
}

interface McpAccountRow {
  [key: string]: unknown;
  id: string;
  availableBalance: string;
  status: string;
}

interface McpPostingRow {
  [key: string]: unknown;
  entryId: string;
  projectedAvailableBalance: string;
}

interface AdvisoryLockRow {
  [key: string]: unknown;
  acquired: boolean;
}

export interface TransactionRequestContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TransactionConfirmationRewardWriter)
    private readonly rewardWriter: TransactionConfirmationRewardWriter,
    @Inject(TransactionCommissionIntegrator)
    private readonly commissionIntegrator: TransactionCommissionIntegrator,
  ) {}

  async createPreview(
    staffAccountId: string,
    input: TransactionPreviewDto,
    idempotencyKey: string,
    marketContext: string | undefined,
    requestContext: TransactionRequestContext = {},
  ): Promise<TransactionPreviewResponse> {
    const now = new Date();
    const keyHash = sha256(idempotencyKey);
    const requestHash = sha256(canonicalJson(input));
    const merchant = await this.resolveMerchantContext(
      staffAccountId,
      marketContext,
    );
    this.assertMerchantActive(merchant);
    this.assertMarketNotTampered(input.marketId, merchant.marketId);

    const priorRecords = await this.database.db
      .select({
        requestHash: transactionIdempotencyRecords.requestHash,
        status: transactionIdempotencyRecords.status,
        response: transactionIdempotencyRecords.response,
      })
      .from(transactionIdempotencyRecords)
      .where(
        and(
          eq(transactionIdempotencyRecords.merchantBranchId, merchant.branchId),
          eq(transactionIdempotencyRecords.operation, 'PREVIEW'),
          eq(transactionIdempotencyRecords.keyHash, keyHash),
        ),
      )
      .limit(1);
    const priorRecord = priorRecords[0];
    if (priorRecord) {
      this.assertIdempotencyMatch(priorRecord.requestHash, requestHash);
      if (priorRecord.status === 'COMPLETED' && priorRecord.response) {
        return this.sanitizePreviewResponse(priorRecord.response);
      }
      transactionConflict(
        transactionErrorCodes.confirmationFailed,
        'The transaction preview idempotency record is not replayable.',
      );
    }

    const settings = await this.resolveMarketSettings(merchant.marketId);
    if (settings.currencyCode !== merchant.currencyCode) {
      transactionConflict(
        transactionErrorCodes.settingsMissing,
        'Transaction settings currency does not match the merchant market.',
      );
    }
    const amount = this.validateAmount(input.amount, settings);
    const member = await this.resolveMember(input.memberQrToken, now);
    const selectedPackage = await this.resolvePackage(
      merchant.branchId,
      merchant.marketId,
      input.packageId,
      now,
    );
    const mcpBalance = await this.resolveMcpBalance(
      merchant.branchId,
      merchant.marketId,
    );
    const rewardRule = await this.resolveRewardRule(merchant.marketId, now);

    const serviceFeeAmount = amount
      .mul(selectedPackage.rate)
      .div(100)
      .toDecimalPlaces(settings.currencyScale, Decimal.ROUND_HALF_UP);
    const rewardCap = this.calculateRewardCap(amount, rewardRule);
    const dailyRewardAmount = this.calculateDailyReward(
      amount,
      rewardRule,
      rewardCap,
    );
    const estimatedBalanceAfter = new Decimal(mcpBalance).minus(
      serviceFeeAmount,
    );
    const createdAt = now;
    const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1000);
    const rewardStartDate = nextBusinessDate(createdAt, merchant.timezone);
    const protectedMemberReference = maskMemberReference(member.publicMemberId);
    const normalizedAmount = amount.toFixed(settings.currencyScale);
    const normalizedFee = serviceFeeAmount.toFixed(settings.currencyScale);
    const normalizedBalance = new Decimal(mcpBalance).toFixed(
      settings.currencyScale,
    );
    const normalizedBalanceAfter = estimatedBalanceAfter.toFixed(
      settings.currencyScale,
    );
    const mcpSufficient = estimatedBalanceAfter.gte(0);
    const mcpShortfall = Decimal.max(
      new Decimal(0),
      serviceFeeAmount.minus(mcpBalance),
    ).toFixed(settings.currencyScale);
    const normalizedRewardCap = rewardCap.toFixed(10);
    const normalizedDailyReward = dailyRewardAmount.toFixed(10);
    const packageName =
      selectedPackage.packageName ??
      selectedPackage.specialName ??
      'Custom package';
    const packageSnapshot = {
      assignmentId: selectedPackage.assignmentId,
      assignmentVersion: selectedPackage.assignmentVersion,
      serviceFeeVersionId: selectedPackage.serviceFeeVersionId,
      specialPercentageId: selectedPackage.specialPercentageId,
      name: packageName,
      rate: selectedPackage.rate,
    };

    return this.database.runTransaction(async (tx) => {
      const idempotencyRows = await tx
        .insert(transactionIdempotencyRecords)
        .values({
          merchantBranchId: merchant.branchId,
          operation: 'PREVIEW',
          keyHash,
          requestHash,
          status: 'IN_PROGRESS',
          requestId: requestContext.requestId,
          createdAt,
          updatedAt: createdAt,
        })
        .onConflictDoNothing({
          target: [
            transactionIdempotencyRecords.merchantBranchId,
            transactionIdempotencyRecords.operation,
            transactionIdempotencyRecords.keyHash,
          ],
        })
        .returning({ id: transactionIdempotencyRecords.id });
      const idempotencyRecordId = idempotencyRows[0]?.id;
      if (!idempotencyRecordId) {
        const existingRows = await tx
          .select({
            id: transactionIdempotencyRecords.id,
            requestHash: transactionIdempotencyRecords.requestHash,
            status: transactionIdempotencyRecords.status,
            response: transactionIdempotencyRecords.response,
          })
          .from(transactionIdempotencyRecords)
          .where(
            and(
              eq(
                transactionIdempotencyRecords.merchantBranchId,
                merchant.branchId,
              ),
              eq(transactionIdempotencyRecords.operation, 'PREVIEW'),
              eq(transactionIdempotencyRecords.keyHash, keyHash),
            ),
          )
          .limit(1);
        const existing = existingRows[0];
        if (!existing) {
          transactionConflict(
            transactionErrorCodes.confirmationFailed,
            'The transaction preview idempotency record could not be resolved.',
          );
        }
        this.assertIdempotencyMatch(existing.requestHash, requestHash);
        if (existing.status === 'COMPLETED' && existing.response) {
          return this.sanitizePreviewResponse(existing.response);
        }
        transactionConflict(
          transactionErrorCodes.confirmationFailed,
          'The transaction preview idempotency record is not replayable.',
        );
      }

      const inserted = await tx
        .insert(transactionPreviewSessions)
        .values({
          status: 'PREVIEWED',
          merchantBranchId: merchant.branchId,
          merchantAccountId: merchant.merchantAccountId,
          createdByStaffAccountId: staffAccountId,
          memberId: member.memberId,
          protectedMemberReference,
          marketId: merchant.marketId,
          currency: settings.currencyCode,
          purchaseAmount: normalizedAmount,
          transactionNote: input.transactionNote,
          merchantPackageAssignmentId: selectedPackage.assignmentId,
          merchantPackageVersion: selectedPackage.assignmentVersion,
          merchantPackageSnapshot: packageSnapshot,
          serviceFeeRate: selectedPackage.rate,
          serviceFeeAmount: normalizedFee,
          estimatedMcpDebit: normalizedFee,
          rewardRuleVersionId: rewardRule.id,
          rewardRate: rewardRule.rewardRate,
          rewardPrincipal: normalizedAmount,
          rewardCap: normalizedRewardCap,
          dailyRewardAmount: normalizedDailyReward,
          rewardStartBusinessDate: rewardStartDate,
          marketTimezone: merchant.timezone,
          roundingMode: 'HALF_UP',
          previewedAt: createdAt,
          expiresAt,
          createdAt,
          updatedAt: createdAt,
        })
        .returning({ id: transactionPreviewSessions.id });
      const previewSessionId = inserted[0]?.id;
      if (!previewSessionId) {
        transactionConflict(
          transactionErrorCodes.previewCreationFailed,
          'The transaction preview could not be created.',
        );
      }

      const response: TransactionPreviewResponse = {
        previewSessionId: this.encodePreviewReference(previewSessionId),
        protectedMemberReference,
        amount: normalizedAmount,
        currency: settings.currencyCode,
        selectedPackage: {
          name: packageName,
          rate: selectedPackage.rate,
        },
        serviceFeeRate: selectedPackage.rate,
        estimatedMcpDebit: normalizedFee,
        currentMcpBalance: normalizedBalance,
        estimatedMcpBalanceAfter: normalizedBalanceAfter,
        mcpSufficient,
        confirmAllowed: mcpSufficient,
        mcpShortfall,
        rewardRate: rewardRule.rewardRate,
        expectedDailyRewardAmount: normalizedDailyReward,
        rewardCap: normalizedRewardCap,
        rewardStartDate,
        transactionMarket: {
          code: merchant.marketCode,
          timezone: merchant.timezone,
        },
        previewExpiresAt: expiresAt.toISOString(),
      };

      const auditLogId = await this.audit.appendWithinTransactionWithId(tx, {
        actor: { type: 'ACCOUNT', id: staffAccountId },
        action: 'TRANSACTION_PREVIEW_CREATED',
        entity: { type: 'transaction_preview', id: previewSessionId },
        marketId: merchant.marketId,
        after: {
          previewSessionId,
          merchantBranchId: merchant.branchId,
          protectedMemberReference,
          amount: normalizedAmount,
          currency: settings.currencyCode,
          packageAssignmentId: selectedPackage.assignmentId,
          expiresAt: expiresAt.toISOString(),
        },
        result: 'SUCCESS',
        requestId: requestContext.requestId,
        ipAddress: requestContext.ipAddress,
        summary: 'Merchant transaction preview created.',
      });
      await tx.insert(transactionAuditReferences).values({
        eventType: 'PREVIEW_CREATED',
        auditLogId,
        previewSessionId,
        idempotencyRecordId,
        previewCreatorAccountId: staffAccountId,
        merchantAccountId: merchant.merchantAccountId,
        staffAccountId,
        protectedMemberReference,
        marketId: merchant.marketId,
        currency: settings.currencyCode,
        purchaseAmount: normalizedAmount,
        merchantPackageAssignmentId: selectedPackage.assignmentId,
        merchantPackageVersion: selectedPackage.assignmentVersion,
        serviceFeeRate: selectedPackage.rate,
        rewardRuleVersionId: rewardRule.id,
        requestId: requestContext.requestId,
        clientChannel: 'MERCHANT_API',
        previewedAt: createdAt,
        createdAt,
      });

      await tx
        .update(transactionIdempotencyRecords)
        .set({
          status: 'COMPLETED',
          previewSessionId,
          response,
          statusCode: 201,
          updatedAt: createdAt,
        })
        .where(eq(transactionIdempotencyRecords.id, idempotencyRecordId));

      return response;
    }, TRANSACTION_EXECUTION_OPTIONS);
  }

  async confirm(
    staffAccountId: string,
    previewReference: string,
    input: TransactionConfirmDto,
    idempotencyKey: string,
    requestContext: TransactionRequestContext = {},
  ): Promise<TransactionConfirmResponse> {
    const keyHash = sha256(idempotencyKey);
    const requestHash = sha256(canonicalJson(input));
    const previewSessionId = this.decodePreviewReference(previewReference);
    const txResult = await this.database.runTransaction(async (tx) => {
      const now = new Date();
      const lockResult = await tx.execute<AdvisoryLockRow>(sql`
        SELECT pg_try_advisory_xact_lock(
          hashtextextended(${previewSessionId}, 0)
        ) AS acquired
      `);
      const lockWasContended = lockResult.rows[0]?.acquired !== true;
      if (lockWasContended) {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${previewSessionId}, 0))
        `);
      }
      const previewResult = await tx.execute<ConfirmPreviewRow>(sql`
        SELECT
          preview.id,
          preview.status::text AS status,
          preview.merchant_branch_id AS "merchantBranchId",
          preview.merchant_account_id AS "merchantAccountId",
          preview.created_by_staff_account_id AS "createdByStaffAccountId",
          preview.member_id AS "memberId",
          preview.protected_member_reference AS "protectedMemberReference",
          preview.market_id AS "marketId",
          preview.currency,
          market_settings.currency_scale AS "currencyScale",
          preview.purchase_amount AS "purchaseAmount",
          preview.transaction_note AS "transactionNote",
          preview.merchant_package_assignment_id AS "merchantPackageAssignmentId",
          preview.merchant_package_version AS "merchantPackageVersion",
          preview.merchant_package_snapshot AS "merchantPackageSnapshot",
          preview.service_fee_rate AS "serviceFeeRate",
          preview.service_fee_amount AS "serviceFeeAmount",
          preview.estimated_mcp_debit AS "estimatedMcpDebit",
          preview.reward_rule_version_id AS "rewardRuleVersionId",
          preview.reward_rate AS "rewardRate",
          preview.reward_principal AS "rewardPrincipal",
          preview.reward_cap AS "rewardCap",
          preview.daily_reward_amount AS "dailyRewardAmount",
          preview.reward_start_business_date::text AS "rewardStartBusinessDate",
          preview.market_timezone AS "marketTimezone",
          preview.rounding_mode AS "roundingMode",
          preview.previewed_at AS "previewedAt",
          preview.expires_at AS "expiresAt",
          branch.status::text AS "merchantStatus",
          branch.merchant_id AS "publicMerchantId",
          merchant_group.name AS "merchantName",
          branch.name AS "branchName",
          market.code AS "marketCode",
          member.status::text AS "memberStatus",
          member_profile.display_name AS "memberDisplayName"
        FROM transaction_preview_sessions preview
        JOIN merchant_branches branch
          ON branch.id = preview.merchant_branch_id
         AND branch.market_id = preview.market_id
        JOIN merchant_groups merchant_group
          ON merchant_group.id = branch.merchant_group_id
        JOIN merchant_account_access merchant_access
          ON merchant_access.merchant_group_id = merchant_group.id
         AND merchant_access.account_id = ${staffAccountId}
        JOIN markets market ON market.id = preview.market_id
        JOIN market_transaction_settings market_settings
          ON market_settings.market_id = preview.market_id
         AND market_settings.currency_code = preview.currency
        JOIN members member ON member.id = preview.member_id
        LEFT JOIN member_profiles member_profile
          ON member_profile.member_id = member.id
        WHERE preview.id = ${previewSessionId}
        FOR UPDATE OF preview
      `);
      const preview = previewResult.rows[0];
      if (!preview) {
        transactionNotFound(
          transactionErrorCodes.previewNotFound,
          'The transaction preview was not found or is not accessible.',
        );
      }

      const priorRows = await tx
        .select({
          id: transactionIdempotencyRecords.id,
          requestHash: transactionIdempotencyRecords.requestHash,
          previewSessionId: transactionIdempotencyRecords.previewSessionId,
          status: transactionIdempotencyRecords.status,
          response: transactionIdempotencyRecords.response,
          transactionId: transactionIdempotencyRecords.transactionId,
        })
        .from(transactionIdempotencyRecords)
        .where(
          and(
            eq(
              transactionIdempotencyRecords.merchantBranchId,
              preview.merchantBranchId,
            ),
            eq(transactionIdempotencyRecords.operation, 'CONFIRM'),
            eq(transactionIdempotencyRecords.keyHash, keyHash),
          ),
        )
        .limit(1);
      const prior = priorRows[0];
      if (prior) {
        this.assertIdempotencyMatch(
          prior.requestHash,
          requestHash,
          prior.previewSessionId,
          previewSessionId,
        );
        if (prior.status === 'COMPLETED' && prior.response) {
          return {
            response: sanitizeConfirmResponse(prior.response),
            confirmedId: prior.transactionId,
          };
        }
        transactionConflict(
          transactionErrorCodes.confirmationFailed,
          'The transaction confirmation idempotency record is not replayable.',
        );
      }

      if (preview.status === 'CONFIRMED') {
        if (lockWasContended) {
          const completedRows = await tx
            .select({
              transactionId: transactionIdempotencyRecords.transactionId,
              response: transactionIdempotencyRecords.response,
            })
            .from(transactionIdempotencyRecords)
            .where(
              and(
                eq(
                  transactionIdempotencyRecords.merchantBranchId,
                  preview.merchantBranchId,
                ),
                eq(transactionIdempotencyRecords.operation, 'CONFIRM'),
                eq(
                  transactionIdempotencyRecords.previewSessionId,
                  previewSessionId,
                ),
                eq(transactionIdempotencyRecords.status, 'COMPLETED'),
              ),
            )
            .limit(1);
          const completed = completedRows[0];
          if (completed?.transactionId && completed.response) {
            await tx.insert(transactionIdempotencyRecords).values({
              merchantBranchId: preview.merchantBranchId,
              operation: 'CONFIRM',
              keyHash,
              requestHash,
              status: 'COMPLETED',
              previewSessionId,
              transactionId: completed.transactionId,
              response: sanitizeConfirmResponse(completed.response),
              statusCode: 201,
              requestId: requestContext.requestId,
              createdAt: now,
              updatedAt: now,
            });
            return {
              response: sanitizeConfirmResponse(completed.response),
              confirmedId: completed.transactionId,
            };
          }
        }
        transactionConflict(
          transactionErrorCodes.previewAlreadyConfirmed,
          'The transaction preview has already been confirmed.',
        );
      }
      if (
        preview.status === 'EXPIRED' ||
        !preview.expiresAt ||
        new Date(preview.expiresAt).getTime() <= now.getTime()
      ) {
        transactionConflict(
          transactionErrorCodes.previewExpired,
          'The transaction preview has expired.',
        );
      }
      if (preview.status !== 'PREVIEWED') {
        transactionConflict(
          transactionErrorCodes.previewInvalidState,
          'The transaction preview is not confirmable.',
        );
      }
      if (preview.merchantStatus !== 'ACTIVE') {
        transactionForbidden(
          transactionErrorCodes.merchantInactive,
          'Only an active merchant may confirm a transaction.',
        );
      }
      if (preview.memberStatus !== 'ACTIVE') {
        transactionForbidden(
          transactionErrorCodes.memberInactive,
          'Only an active member may participate in a transaction.',
        );
      }

      const idempotencyRows = await tx
        .insert(transactionIdempotencyRecords)
        .values({
          merchantBranchId: preview.merchantBranchId,
          operation: 'CONFIRM',
          keyHash,
          requestHash,
          status: 'IN_PROGRESS',
          previewSessionId,
          requestId: requestContext.requestId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [
            transactionIdempotencyRecords.merchantBranchId,
            transactionIdempotencyRecords.operation,
            transactionIdempotencyRecords.keyHash,
          ],
        })
        .returning({ id: transactionIdempotencyRecords.id });
      const idempotencyRecordId = idempotencyRows[0]?.id;
      if (!idempotencyRecordId) {
        const conflictingRows = await tx
          .select({
            requestHash: transactionIdempotencyRecords.requestHash,
            previewSessionId: transactionIdempotencyRecords.previewSessionId,
            status: transactionIdempotencyRecords.status,
            response: transactionIdempotencyRecords.response,
            transactionId: transactionIdempotencyRecords.transactionId,
          })
          .from(transactionIdempotencyRecords)
          .where(
            and(
              eq(
                transactionIdempotencyRecords.merchantBranchId,
                preview.merchantBranchId,
              ),
              eq(transactionIdempotencyRecords.operation, 'CONFIRM'),
              eq(transactionIdempotencyRecords.keyHash, keyHash),
            ),
          )
          .limit(1);
        const conflicting = conflictingRows[0];
        if (!conflicting) {
          transactionConflict(
            transactionErrorCodes.confirmationFailed,
            'The transaction confirmation idempotency record could not be resolved.',
          );
        }
        this.assertIdempotencyMatch(
          conflicting.requestHash,
          requestHash,
          conflicting.previewSessionId,
          previewSessionId,
        );
        if (conflicting.status === 'COMPLETED' && conflicting.response) {
          return {
            response: sanitizeConfirmResponse(conflicting.response),
            confirmedId: conflicting.transactionId,
          };
        }
        transactionConflict(
          transactionErrorCodes.confirmationFailed,
          'The transaction confirmation idempotency record is not replayable.',
        );
      }

      const mcpResult = await tx.execute<McpAccountRow>(sql`
        SELECT
          id,
          available_balance AS "availableBalance",
          status::text AS status
        FROM mcp_accounts
        WHERE merchant_branch_id = ${preview.merchantBranchId}
          AND market_id = ${preview.marketId}
        FOR UPDATE
      `);
      const mcpAccount = mcpResult.rows[0];
      if (!mcpAccount || mcpAccount.status !== 'ACTIVE') {
        transactionNotFound(
          transactionErrorCodes.mcpAccountMissing,
          'The merchant MCP account is not available for transaction confirmation.',
        );
      }
      if (
        new Decimal(mcpAccount.availableBalance).lt(preview.estimatedMcpDebit)
      ) {
        transactionConflict(
          transactionErrorCodes.insufficientMcp,
          'The merchant MCP balance is insufficient to confirm this transaction.',
        );
      }

      const transactionRows = await tx
        .insert(transactions)
        .values({
          previewSessionId: preview.id,
          merchantReceiptNumber: input.merchantReceiptNumber,
          status: 'CONFIRMED',
          merchantBranchId: preview.merchantBranchId,
          merchantAccountId: preview.merchantAccountId,
          confirmedByStaffAccountId: staffAccountId,
          memberId: preview.memberId,
          protectedMemberReference: preview.protectedMemberReference,
          marketId: preview.marketId,
          currency: preview.currency,
          purchaseAmount: preview.purchaseAmount,
          transactionNote: preview.transactionNote,
          merchantPackageAssignmentId: preview.merchantPackageAssignmentId,
          merchantPackageVersion: preview.merchantPackageVersion,
          merchantPackageSnapshot: preview.merchantPackageSnapshot,
          rewardRuleVersionId: preview.rewardRuleVersionId,
          rewardRate: preview.rewardRate,
          rewardPrincipal: preview.rewardPrincipal,
          rewardCap: preview.rewardCap,
          dailyRewardAmount: preview.dailyRewardAmount,
          rewardStartBusinessDate: preview.rewardStartBusinessDate,
          marketTimezone: preview.marketTimezone,
          roundingMode: 'HALF_UP',
          confirmedAt: now,
          createdAt: now,
        })
        .returning({
          id: transactions.id,
          transactionNumber: transactions.transactionNumber,
        });
      const confirmedTransaction = transactionRows[0];
      if (!confirmedTransaction) {
        transactionConflict(
          transactionErrorCodes.confirmationFailed,
          'The confirmed transaction could not be created.',
        );
      }

      await tx.insert(transactionServiceFees).values({
        transactionId: confirmedTransaction.id,
        marketId: preview.marketId,
        currency: preview.currency,
        rate: preview.serviceFeeRate,
        principal: preview.purchaseAmount,
        amount: preview.serviceFeeAmount,
        createdAt: now,
      });

      const mcpPayloadHash = createHash('sha256')
        .update(
          JSON.stringify({
            transactionId: confirmedTransaction.id,
            mcpAccountId: mcpAccount.id,
            amount: preview.estimatedMcpDebit,
            marketId: preview.marketId,
          }),
          'utf8',
        )
        .digest('hex');
      const mcpPostingResult = await tx.execute<McpPostingRow>(sql`
        SELECT
          entry_id AS "entryId",
          projected_available_balance AS "projectedAvailableBalance"
        FROM append_mcp_ledger_entry(
          ${mcpAccount.id}::uuid,
          'TRANSACTION_DEDUCTION'::mcp_entry_type,
          'DEBIT'::mcp_direction,
          ${preview.estimatedMcpDebit}::numeric,
          ${new Decimal(preview.estimatedMcpDebit).negated().toFixed(10)}::numeric,
          ${new Decimal(preview.estimatedMcpDebit).negated().toFixed(10)}::numeric,
          'TRANSACTION',
          ${confirmedTransaction.id},
          ${`transaction:confirm:${confirmedTransaction.id}`},
          ${mcpPayloadHash},
          'ACCOUNT',
          ${staffAccountId},
          'TRANSACTION_CONFIRMATION',
          ${now},
          NULL,
          ${JSON.stringify({
            previewSessionId: preview.id,
            marketId: preview.marketId,
          })}::jsonb
        )
      `);
      const mcpPosting = mcpPostingResult.rows[0];
      if (!mcpPosting) {
        transactionConflict(
          transactionErrorCodes.confirmationFailed,
          'The MCP debit could not be recorded.',
        );
      }

      await tx.insert(transactionMcpDebits).values({
        transactionId: confirmedTransaction.id,
        marketId: preview.marketId,
        mcpAccountId: mcpAccount.id,
        mcpLedgerEntryId: mcpPosting.entryId,
        amount: preview.estimatedMcpDebit,
        balanceAfter: mcpPosting.projectedAvailableBalance,
        createdAt: now,
      });

      const reward =
        await this.rewardWriter.createRewardEntitlementInTransaction(tx, {
          transactionId: confirmedTransaction.id,
          memberId: preview.memberId,
          marketId: preview.marketId,
          merchantBranchId: preview.merchantBranchId,
          amount: preview.purchaseAmount,
          currency: preview.currency,
          transactionTime: now,
          packageSnapshot: preview.merchantPackageSnapshot,
          serviceFeeRate: preview.serviceFeeRate,
          serviceFeeAmount: preview.serviceFeeAmount,
          rewardRuleVersionId: preview.rewardRuleVersionId,
          rewardRate: preview.rewardRate,
          dailyRewardAmount: preview.dailyRewardAmount,
          rewardCap: preview.rewardCap,
          rewardStartBusinessDate: preview.rewardStartBusinessDate,
          marketTimezone: preview.marketTimezone,
        });
      await tx.insert(transactionRewardLinks).values({
        transactionId: confirmedTransaction.id,
        rewardSourceId: reward.sourceId,
        rewardPlanId: reward.planId,
        rewardRuleVersionId: preview.rewardRuleVersionId,
        createdAt: now,
      });

      const transactionNumber =
        confirmedTransaction.transactionNumber.toString();
      const auditLogId = await this.audit.appendWithinTransactionWithId(tx, {
        actor: { type: 'ACCOUNT', id: staffAccountId },
        action: 'TRANSACTION_CONFIRMED',
        entity: { type: 'transaction', id: confirmedTransaction.id },
        marketId: preview.marketId,
        after: {
          transactionNumber,
          previewSessionId: preview.id,
          merchantPublicId: preview.publicMerchantId,
          protectedMemberReference: preview.protectedMemberReference,
          amount: preview.purchaseAmount,
          currency: preview.currency,
          serviceFeeAmount: preview.serviceFeeAmount,
          mcpDeducted: preview.estimatedMcpDebit,
          mcpBalanceAfter: mcpPosting.projectedAvailableBalance,
          rewardRuleVersionId: preview.rewardRuleVersionId,
          dailyRewardAmount: preview.dailyRewardAmount,
          rewardStartBusinessDate: preview.rewardStartBusinessDate,
        },
        result: 'SUCCESS',
        requestId: requestContext.requestId,
        ipAddress: requestContext.ipAddress,
        summary: `Merchant transaction ${transactionNumber} confirmed.`,
      });
      await tx.insert(transactionAuditReferences).values({
        eventType: 'CONFIRMED',
        auditLogId,
        previewSessionId: preview.id,
        transactionId: confirmedTransaction.id,
        idempotencyRecordId,
        previewCreatorAccountId: preview.createdByStaffAccountId,
        confirmerAccountId: staffAccountId,
        merchantAccountId: preview.merchantAccountId,
        staffAccountId,
        protectedMemberReference: preview.protectedMemberReference,
        marketId: preview.marketId,
        currency: preview.currency,
        purchaseAmount: preview.purchaseAmount,
        merchantPackageAssignmentId: preview.merchantPackageAssignmentId,
        merchantPackageVersion: preview.merchantPackageVersion,
        serviceFeeRate: preview.serviceFeeRate,
        rewardRuleVersionId: preview.rewardRuleVersionId,
        requestId: requestContext.requestId,
        clientChannel: 'MERCHANT_API',
        previewedAt: new Date(preview.previewedAt),
        confirmedAt: now,
        createdAt: now,
      });

      await tx
        .update(transactionPreviewSessions)
        .set({
          status: 'CONFIRMED',
          confirmedAt: now,
          expiresAt: null,
          updatedAt: now,
        })
        .where(eq(transactionPreviewSessions.id, preview.id));

      const merchant = {
        merchantId: preview.publicMerchantId,
        merchantName: preview.merchantName,
        branchName: preview.branchName,
      };
      const market = { marketCode: preview.marketCode };
      const transactionTime = now.toISOString();
      const purchaseAmount = new Decimal(preview.purchaseAmount).toFixed(
        preview.currencyScale,
      );
      const serviceFeeAmount = new Decimal(preview.serviceFeeAmount).toFixed(
        preview.currencyScale,
      );
      const mcpDeducted = new Decimal(preview.estimatedMcpDebit).toFixed(
        preview.currencyScale,
      );
      const mcpBalanceAfter = new Decimal(
        mcpPosting.projectedAvailableBalance,
      ).toFixed(preview.currencyScale);
      const packageName =
        typeof preview.merchantPackageSnapshot['name'] === 'string'
          ? preview.merchantPackageSnapshot['name']
          : 'Custom package';
      const receiptData = {
        transactionNumber,
        status: 'CONFIRMED' as const,
        merchant,
        member: {
          maskedReference: preview.protectedMemberReference,
          displayName: preview.memberDisplayName,
        },
        market,
        currency: preview.currency,
        purchaseAmount,
        package: {
          packageName,
          serviceFeeRate: preview.serviceFeeRate,
        },
        serviceFeeAmount,
        reward: {
          rewardRate: preview.rewardRate,
          dailyRewardAmount: preview.dailyRewardAmount,
          rewardCap: preview.rewardCap,
          rewardStartBusinessDate: preview.rewardStartBusinessDate,
        },
        merchantReceiptNumber: input.merchantReceiptNumber ?? null,
        transactionNote: preview.transactionNote,
        transactionTime,
      };

      const response: TransactionConfirmResponse = {
        transactionNumber,
        status: 'CONFIRMED',
        transactionTime,
        merchant,
        market,
        currency: preview.currency,
        amount: purchaseAmount,
        serviceFee: serviceFeeAmount,
        mcpDeducted,
        mcpBalanceAfter,
        dailyRewardAmount: preview.dailyRewardAmount,
        rewardCap: preview.rewardCap,
        rewardStartBusinessDate: preview.rewardStartBusinessDate,
        receiptData,
      };

      await tx
        .update(transactionIdempotencyRecords)
        .set({
          status: 'COMPLETED',
          transactionId: confirmedTransaction.id,
          response,
          statusCode: 201,
          updatedAt: now,
        })
        .where(eq(transactionIdempotencyRecords.id, idempotencyRecordId));

      return { response, confirmedId: confirmedTransaction.id };
    }, TRANSACTION_EXECUTION_OPTIONS);

    // Post-commit: trigger commission processing (idempotent, retryable)
    setImmediate(() => {
      this.triggerCommissions(txResult).catch((err) => {
        this.logger.error(
          `Commission processing failed: ${(err as Error).message}`,
        );
      });
    });

    return txResult.response;
  }

  private async triggerCommissions(result: {
    response: TransactionConfirmResponse;
    confirmedId: string | null;
  }): Promise<void> {
    try {
      if (!result.confirmedId) {
        this.logger.warn(
          'Cannot trigger commissions: no transaction ID available from idempotency replay',
        );
        return;
      }
      await this.commissionIntegrator.processTransactionCommissions(
        result.confirmedId,
      );
    } catch (err) {
      this.logger.error(
        `Commission processing failed for transaction ${result.confirmedId}: ${(err as Error).message}`,
      );
    }
  }

  private assertIdempotencyMatch(
    storedRequestHash: string,
    requestHash: string,
    storedPreviewSessionId?: string | null,
    previewSessionId?: string,
  ): void {
    if (
      storedRequestHash !== requestHash ||
      (previewSessionId !== undefined &&
        storedPreviewSessionId !== previewSessionId)
    ) {
      transactionConflict(
        transactionErrorCodes.idempotencyMismatch,
        'The Idempotency-Key was already used with a different payload.',
      );
    }
  }

  private sanitizePreviewResponse(value: unknown): TransactionPreviewResponse {
    const stored = value as { previewSessionId?: unknown };
    if (typeof stored.previewSessionId !== 'string') {
      transactionConflict(
        transactionErrorCodes.previewCreationFailed,
        'The stored transaction preview response is invalid.',
      );
    }
    const reference = !isUuid(stored.previewSessionId)
      ? stored.previewSessionId
      : this.encodePreviewReference(stored.previewSessionId);
    return sanitizePreviewResponse(value, reference);
  }

  private encodePreviewReference(previewSessionId: string): string {
    const key = this.previewReferenceKey();
    const iv = createHmac('sha256', key)
      .update(previewSessionId, 'utf8')
      .digest()
      .subarray(0, 12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(previewSessionId, 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([
      Buffer.from([1]),
      iv,
      encrypted,
      cipher.getAuthTag(),
    ]).toString('base64url');
  }

  private decodePreviewReference(reference: string): string {
    if (isUuid(reference)) return reference;
    try {
      const payload = Buffer.from(reference, 'base64url');
      if (payload.length < 30 || payload[0] !== 1) throw new Error();
      const iv = payload.subarray(1, 13);
      const tag = payload.subarray(payload.length - 16);
      const encrypted = payload.subarray(13, payload.length - 16);
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.previewReferenceKey(),
        iv,
      );
      decipher.setAuthTag(tag);
      const previewSessionId = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');
      if (!isUuid(previewSessionId)) throw new Error();
      return previewSessionId;
    } catch {
      transactionNotFound(
        transactionErrorCodes.previewNotFound,
        'The transaction preview was not found or is not accessible.',
      );
    }
  }

  private previewReferenceKey(): Buffer {
    return createHash('sha256')
      .update('ipoint:transaction-preview-reference:v1\0', 'utf8')
      .update(this.config.authOtpPepper, 'utf8')
      .digest();
  }

  private async resolveMerchantContext(
    staffAccountId: string,
    marketContext?: string,
  ): Promise<MerchantContext> {
    const result = await this.database.db.execute<MerchantContext>(sql`
      SELECT
        b.id AS "branchId",
        g.account_id AS "merchantAccountId",
        b.market_id AS "marketId",
        m.code AS "marketCode",
        m.currency_code AS "currencyCode",
        m.timezone,
        b.status::text AS status
      FROM merchant_account_access merchant_access
      JOIN merchant_groups g ON g.id = merchant_access.merchant_group_id
      JOIN merchant_branches b ON b.merchant_group_id = g.id
      JOIN markets m ON m.id = b.market_id
      WHERE merchant_access.account_id = ${staffAccountId}
        AND merchant_access.access_type::text IN (
          'PRIMARY_OWNER',
          'OWNER',
          'ADMIN',
          'CASHIER'
        )
      ORDER BY b.created_at, b.id
    `);
    const accessible = result.rows;
    if (accessible.length === 0) {
      transactionForbidden(
        transactionErrorCodes.merchantAccessDenied,
        'The authenticated account is not authorized for a merchant branch.',
      );
    }
    const scoped = marketContext
      ? accessible.filter((row) => row.marketId === marketContext)
      : accessible;
    if (marketContext && scoped.length === 0) {
      transactionForbidden(
        transactionErrorCodes.marketMismatch,
        'The requested market does not match an authorized merchant branch.',
      );
    }
    if (scoped.length !== 1) {
      transactionConflict(
        transactionErrorCodes.merchantContextAmbiguous,
        'The authenticated account must resolve to exactly one merchant branch in the requested market.',
      );
    }
    return scoped[0]!;
  }

  private assertMerchantActive(merchant: MerchantContext): void {
    if (merchant.status !== 'ACTIVE') {
      transactionForbidden(
        transactionErrorCodes.merchantInactive,
        'Only an active merchant may create a transaction preview.',
      );
    }
  }

  private assertMarketNotTampered(
    requestedMarketId: string | undefined,
    merchantMarketId: string,
  ): void {
    if (requestedMarketId && requestedMarketId !== merchantMarketId) {
      transactionForbidden(
        transactionErrorCodes.marketMismatch,
        'Transaction market is determined by the authenticated merchant.',
      );
    }
  }

  private async resolveMarketSettings(
    marketId: string,
  ): Promise<MarketSettings> {
    const result = await this.database.db.execute<MarketSettings>(sql`
      SELECT
        currency_code AS "currencyCode",
        currency_scale AS "currencyScale",
        minimum_transaction_amount AS "minimumAmount",
        maximum_transaction_amount AS "maximumAmount"
      FROM market_transaction_settings
      WHERE market_id = ${marketId}
      LIMIT 1
    `);
    const settings = result.rows[0];
    if (!settings) {
      transactionNotFound(
        transactionErrorCodes.settingsMissing,
        'Transaction settings are not configured for the merchant market.',
      );
    }
    return settings;
  }

  private validateAmount(rawAmount: string, settings: MarketSettings): Decimal {
    let amount: Decimal;
    try {
      amount = new Decimal(rawAmount);
    } catch {
      transactionBadRequest(
        transactionErrorCodes.amountInvalid,
        'Transaction amount must be a valid decimal.',
      );
    }
    if (!amount.isFinite() || amount.lte(0)) {
      transactionBadRequest(
        transactionErrorCodes.amountInvalid,
        'Transaction amount must be greater than zero.',
      );
    }
    if (amount.decimalPlaces() > settings.currencyScale) {
      transactionBadRequest(
        transactionErrorCodes.amountScaleInvalid,
        'Transaction amount exceeds the market currency scale.',
      );
    }
    if (amount.lt(settings.minimumAmount)) {
      transactionBadRequest(
        transactionErrorCodes.amountBelowMinimum,
        'Transaction amount is below the configured market minimum.',
      );
    }
    if (amount.gt(settings.maximumAmount)) {
      transactionBadRequest(
        transactionErrorCodes.amountAboveMaximum,
        'Transaction amount is above the configured market maximum.',
      );
    }
    return amount;
  }

  private async resolveMember(
    rawQrToken: string,
    now: Date,
  ): Promise<MemberRow> {
    const tokenHash = createHash('sha256')
      .update(rawQrToken, 'utf8')
      .digest('hex');
    const result = await this.database.db.execute<MemberRow>(sql`
      SELECT
        member.id AS "memberId",
        member.public_member_id AS "publicMemberId",
        member.status::text AS "memberStatus",
        qr.status::text AS "qrStatus",
        qr.expires_at AS "expiresAt"
      FROM member_qr_identities qr
      JOIN members member ON member.id = qr.member_id
      WHERE qr.token_hash = ${tokenHash}
      LIMIT 1
    `);
    const member = result.rows[0];
    if (!member || member.qrStatus !== 'ACTIVE') {
      transactionNotFound(
        transactionErrorCodes.qrInvalid,
        'The Member QR token is invalid.',
      );
    }
    if (
      member.expiresAt &&
      new Date(member.expiresAt).getTime() <= now.getTime()
    ) {
      transactionBadRequest(
        transactionErrorCodes.qrExpired,
        'The Member QR token has expired.',
      );
    }
    if (member.memberStatus !== 'ACTIVE') {
      transactionForbidden(
        transactionErrorCodes.memberInactive,
        'Only an active member may participate in a transaction preview.',
      );
    }
    return member;
  }

  private async resolvePackage(
    branchId: string,
    marketId: string,
    requestedPackageId: string | undefined,
    now: Date,
  ): Promise<PackageRow> {
    const result = await this.database.db.execute<PackageRow>(sql`
      SELECT
        assignment.id AS "assignmentId",
        assignment.version AS "assignmentVersion",
        assignment.service_fee_version_id AS "serviceFeeVersionId",
        assignment.special_percentage_id AS "specialPercentageId",
        profile.name AS "packageName",
        special.description AS "specialName",
        COALESCE(version.rate, special.rate) AS rate
      FROM merchant_package_assignments assignment
      LEFT JOIN service_fee_versions version
        ON version.id = assignment.service_fee_version_id
      LEFT JOIN service_fee_profiles profile
        ON profile.id = version.service_fee_profile_id
      LEFT JOIN special_percentages special
        ON special.id = assignment.special_percentage_id
      WHERE assignment.merchant_branch_id = ${branchId}
        AND assignment.status = 'ACTIVE'
        AND (
          (
            version.id IS NOT NULL
            AND version.status = 'ACTIVE'
            AND version.effective_from <= ${now}
            AND (version.effective_to IS NULL OR version.effective_to > ${now})
            AND (version.market_id IS NULL OR version.market_id = ${marketId})
            AND (profile.market_id IS NULL OR profile.market_id = ${marketId})
          )
          OR (
            special.id IS NOT NULL
            AND (special.market_id IS NULL OR special.market_id = ${marketId})
          )
        )
      ORDER BY assignment.is_default DESC, assignment.created_at, assignment.id
    `);
    const packages = result.rows;
    if (packages.length === 0) {
      transactionNotFound(
        transactionErrorCodes.packageMissing,
        'The merchant has no active package for this transaction.',
      );
    }
    if (packages.length > 1 && !requestedPackageId) {
      transactionBadRequest(
        transactionErrorCodes.packageSelectionRequired,
        'A package selection is required when multiple packages are active.',
      );
    }
    if (requestedPackageId) {
      const selected = packages.find(
        (item) => item.assignmentId === requestedPackageId,
      );
      if (!selected) {
        transactionBadRequest(
          transactionErrorCodes.packageInvalid,
          'The selected package is not active for this merchant.',
        );
      }
      return selected;
    }
    return packages[0]!;
  }

  private async resolveMcpBalance(
    branchId: string,
    marketId: string,
  ): Promise<string> {
    const result = await this.database.db.execute<{ availableBalance: string }>(
      sql`
        SELECT available_balance AS "availableBalance"
        FROM mcp_accounts
        WHERE merchant_branch_id = ${branchId}
          AND market_id = ${marketId}
        LIMIT 1
      `,
    );
    const account = result.rows[0];
    if (!account) {
      transactionNotFound(
        transactionErrorCodes.mcpAccountMissing,
        'The merchant MCP account is not available.',
      );
    }
    return account.availableBalance;
  }

  private async resolveRewardRule(
    marketId: string,
    now: Date,
  ): Promise<RewardRuleRow> {
    const result = await this.database.db.execute<RewardRuleRow>(sql`
      SELECT
        id,
        reward_rate AS "rewardRate",
        cap_type::text AS "capType",
        cap_value AS "capValue",
        minimum_reward AS "minimumReward"
      FROM reward_rule_versions
      WHERE market_id = ${marketId}
        AND archived_at IS NULL
        AND effective_from <= ${now}
        AND (effective_to IS NULL OR effective_to > ${now})
      ORDER BY effective_from DESC, created_at DESC
      LIMIT 1
    `);
    const rule = result.rows[0];
    if (!rule) {
      transactionNotFound(
        transactionErrorCodes.rewardRuleMissing,
        'No effective reward rule is configured for the merchant market.',
      );
    }
    return rule;
  }

  private calculateRewardCap(amount: Decimal, rule: RewardRuleRow): Decimal {
    if (rule.capType === 'FLAT') {
      return new Decimal(rule.capValue).toDecimalPlaces(
        10,
        Decimal.ROUND_HALF_UP,
      );
    }
    if (rule.capType === 'RATIO') {
      return amount
        .mul(rule.capValue)
        .toDecimalPlaces(10, Decimal.ROUND_HALF_UP);
    }
    transactionConflict(
      transactionErrorCodes.rewardRuleInvalid,
      'The effective reward rule must define a transaction reward cap.',
    );
  }

  private calculateDailyReward(
    amount: Decimal,
    rule: RewardRuleRow,
    rewardCap: Decimal,
  ): Decimal {
    let daily = amount
      .mul(rule.rewardRate)
      .div(100)
      .toDecimalPlaces(10, Decimal.ROUND_HALF_UP);
    const minimum = new Decimal(rule.minimumReward);
    if (daily.lt(minimum)) daily = minimum;
    if (daily.gt(rewardCap)) daily = rewardCap;
    return daily.toDecimalPlaces(10, Decimal.ROUND_HALF_UP);
  }
}

function maskMemberReference(publicMemberId: string): string {
  if (publicMemberId.length <= 6) return `${publicMemberId.slice(0, 1)}***`;
  return `${publicMemberId.slice(0, 3)}***${publicMemberId.slice(-3)}`;
}

function nextBusinessDate(at: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(at);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value)) ?? 'null';
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJsonValue(item)]),
    );
  }
  return value;
}

function sanitizePreviewResponse(
  value: unknown,
  publicReference: string,
): TransactionPreviewResponse {
  const response = value as TransactionPreviewResponse & {
    selectedPackage?: Record<string, unknown>;
    transactionMarket?: Record<string, unknown>;
  };
  const selectedPackage = response.selectedPackage ?? {};
  const transactionMarket = response.transactionMarket ?? {};
  return {
    ...response,
    previewSessionId: publicReference,
    selectedPackage: {
      name: String(selectedPackage['name'] ?? 'Custom package'),
      rate: String(selectedPackage['rate'] ?? ''),
    },
    transactionMarket: {
      code: String(transactionMarket['code'] ?? ''),
      timezone: String(transactionMarket['timezone'] ?? ''),
    },
  };
}

function sanitizeConfirmResponse(value: unknown): TransactionConfirmResponse {
  const stored = value as TransactionConfirmResponse & Record<string, unknown>;
  const safeResponse = { ...stored };
  Reflect.deleteProperty(safeResponse, 'rewardRuleVersion');
  const safeMerchant = { ...stored.merchant };
  Reflect.deleteProperty(safeMerchant, 'branchId');
  const safeReceipt = { ...stored.receiptData };
  const safePackage = { ...stored.receiptData.package };
  Reflect.deleteProperty(safePackage, 'packageId');
  const safeReward = { ...stored.receiptData.reward };
  Reflect.deleteProperty(safeReward, 'rewardRuleVersionId');
  return {
    ...safeResponse,
    merchant: safeMerchant,
    receiptData: {
      ...safeReceipt,
      merchant: safeMerchant,
      package: safePackage,
      reward: safeReward,
    },
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

/**
 * Transaction → Commission Integrator
 *
 * Reliable, idempotent post-commit integration between Phase 4
 * Transaction CONFIRMED and Phase 5 Commission processing.
 *
 * Fires after the confirmation transaction has committed:
 * 1. Member Consumption G1 / G2
 * 2. Merchant Recruitment G1
 *
 * Each commission type uses its own canonical_processing_key derived
 * from the transaction ID, ensuring exactly-once semantics on replay.
 *
 * Processing failures are logged but do NOT roll back the original
 * transaction. Admin can retry via the reprocess endpoint.
 *
 * @packageDocumentation
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { MemberConsumptionCommissionService } from '../domain/commission/member-consumption.service.js';
import { MerchantRecruitmentCommissionService } from '../domain/commission/merchant-recruitment.service.js';

@Injectable()
export class TransactionCommissionIntegrator {
  private readonly logger = new Logger(TransactionCommissionIntegrator.name);

  constructor(
    @Inject(MemberConsumptionCommissionService)
    private readonly memberConsumption: MemberConsumptionCommissionService,
    @Inject(MerchantRecruitmentCommissionService)
    private readonly merchantRecruitment: MerchantRecruitmentCommissionService,
  ) {}

  /**
   * Process all commission types for a confirmed transaction.
   *
   * Called post-commit. Each commission type is independently idempotent
   * via canonical_processing_key. Failures are logged but do NOT affect
   * the original confirmed transaction.
   */
  async processTransactionCommissions(transactionId: string): Promise<{
    consumptionResult: unknown;
    recruitmentResult: unknown;
    error?: string;
  }> {
    const results: {
      consumptionResult: unknown;
      recruitmentResult: unknown;
      error?: string;
    } = {
      consumptionResult: null,
      recruitmentResult: null,
    };

    // 1. Member Consumption G1/G2
    try {
      results.consumptionResult =
        await this.memberConsumption.processMemberConsumption(transactionId);
      this.logger.log(
        `Member consumption commission processed for transaction ${transactionId}`,
      );
    } catch (error) {
      const message = `Member consumption commission failed for transaction ${transactionId}: ${(error as Error).message}`;
      this.logger.error(message, (error as Error).stack);
      results.error = message;
    }

    // 2. Merchant Recruitment G1
    try {
      results.recruitmentResult =
        await this.merchantRecruitment.processMerchantRecruitment(
          transactionId,
        );
      this.logger.log(
        `Merchant recruitment commission processed for transaction ${transactionId}`,
      );
    } catch (error) {
      const message = `Merchant recruitment commission failed for transaction ${transactionId}: ${(error as Error).message}`;
      this.logger.error(message, (error as Error).stack);
      results.error = results.error ? `${results.error}; ${message}` : message;
    }

    return results;
  }
}

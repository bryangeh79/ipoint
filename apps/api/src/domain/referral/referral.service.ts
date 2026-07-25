/**
 * Referral Engine Domain Service
 *
 * Core referral logic: register referrals, query referral trees,
 * and resolve referrer relationships. The referral relationship is
 * PERMANENTLY IMMUTABLE once established (D-15 frozen).
 *
 * Key business rules enforced:
 * - No self-referral
 * - No cycles (DAG enforcement)
 * - One referrer per member
 * - Referral code is permanent
 * - No compression
 * - No beneficiary substitution
 * - Anonymized tree (no raw member IDs)
 *
 * @packageDocumentation
 */

import { Inject, Injectable } from '@nestjs/common';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { members, memberReferrals, agentActivations } from '@ipoint/database';
import type { ReferralTreeResponse } from '@ipoint/types';
import {
  ReferralError,
  referralSelfReferenceError,
  referralCycleDetectedError,
  referralCodeNotFoundError,
  referralAlreadyExistsError,
} from './referral.errors.js';

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

@Injectable()
export class ReferralService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /* ================================================================ */
  /*  COMMAND METHODS                                                  */
  /* ================================================================ */

  /**
   * Register a referral relationship.
   *
   * Called during member registration to link the new member (referee)
   * to an existing member by referral code.
   *
   * @param refereeId - UUID of the new member being referred
   * @param referralCode - Referral code of the existing referrer member
   * @returns The created referral relationship record
   * @throws {ReferralError} On self-referral, cycle, missing code, or duplicate
   */
  async registerReferral(
    refereeId: string,
    referralCode: string,
  ): Promise<{
    id: string;
    refereeId: string;
    referrerId: string;
    referralCodeSnapshot: string;
  }> {
    // 1. Look up member by referral_code
    const referrerRows = await this.database.db
      .select({ id: members.id, referralCode: members.referralCode })
      .from(members)
      .where(eq(members.referralCode, referralCode))
      .limit(1);

    const referrerMember = referrerRows[0];
    if (!referrerMember) {
      throw referralCodeNotFoundError(referralCode);
    }

    const referrerId = referrerMember.id;

    // 2. Reject self-referral
    if (refereeId === referrerId) {
      throw referralSelfReferenceError();
    }

    // 3. Check that referee doesn't already have a referrer
    const existingRows = await this.database.db
      .select({ id: memberReferrals.id })
      .from(memberReferrals)
      .where(
        and(
          eq(memberReferrals.memberId, refereeId),
          eq(memberReferrals.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    if (existingRows[0]) {
      throw referralAlreadyExistsError(refereeId);
    }

    // 4. Detect cycles: walk up referrer chain from referrer
    //    If the referee is found anywhere in the referrer's ancestor chain,
    //    the new relationship would create a cycle.
    await this.detectCycle(this.database.db, referrerId, refereeId);

    // 5. Insert the referral relationship
    const insertedRows = await this.database.db
      .insert(memberReferrals)
      .values({
        memberId: refereeId,
        referrerMemberId: referrerId,
        referralCodeSnapshot: referralCode,
        source: 'REGISTRATION',
        status: 'ACTIVE',
      })
      .returning({
        id: memberReferrals.id,
        refereeId: memberReferrals.memberId,
        referrerId: memberReferrals.referrerMemberId,
        referralCodeSnapshot: memberReferrals.referralCodeSnapshot,
      });

    const inserted = insertedRows[0];
    if (!inserted) {
      throw new Error('Referral relationship insert returned no row.');
    }

    return inserted;
  }

  /**
   * Get the anonymized referral tree for a member.
   *
   * Returns counts of direct (G1) and indirect (G2) referrals,
   * plus the number of agents in each generation. No raw member IDs
   * are exposed.
   *
   * @param memberId - UUID of the member
   * @param depth - Tree depth (1 or 2). Defaults to 2.
   * @returns Anonymized tree response
   */
  async getReferralTree(
    memberId: string,
    depth: number = 2,
  ): Promise<ReferralTreeResponse> {
    // Resolve member's own referral code
    const memberRows = await this.database.db
      .select({ referralCode: members.referralCode })
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);

    const myCode = memberRows[0]?.referralCode ?? '';

    // Resolve referrer
    const referrerResult = await this.getReferrerInternal(memberId);

    // Query G1 referees (direct referrals)
    const g1Referrals = await this.database.db
      .select({ memberId: memberReferrals.memberId })
      .from(memberReferrals)
      .where(
        and(
          eq(memberReferrals.referrerMemberId, memberId),
          eq(memberReferrals.status, 'ACTIVE'),
        ),
      );

    const g1Count = g1Referrals.length;
    const g1MemberIds = g1Referrals.map((r) => r.memberId);

    // Count G1 agents
    const g1AgentRows = g1MemberIds.length
      ? await this.database.db
          .select({ count: sql<number>`count(*)::int` })
          .from(agentActivations)
          .where(
            and(
              inArray(agentActivations.memberId, g1MemberIds),
              eq(agentActivations.status, 'ACTIVE'),
            ),
          )
      : [{ count: 0 }];
    const g1Agents = Number(g1AgentRows[0]?.count ?? 0);

    let g2Count = 0;
    let g2Agents = 0;

    if (depth >= 2 && g1MemberIds.length > 0) {
      // Query G2 referees (referrals of G1 members)
      const g2Referrals = await this.database.db
        .select({ memberId: memberReferrals.memberId })
        .from(memberReferrals)
        .where(
          and(
            inArray(memberReferrals.referrerMemberId, g1MemberIds),
            eq(memberReferrals.status, 'ACTIVE'),
          ),
        );

      g2Count = g2Referrals.length;
      const g2MemberIds = g2Referrals.map((r) => r.memberId);

      if (g2MemberIds.length > 0) {
        const g2AgentRows = await this.database.db
          .select({ count: sql<number>`count(*)::int` })
          .from(agentActivations)
          .where(
            and(
              inArray(agentActivations.memberId, g2MemberIds),
              eq(agentActivations.status, 'ACTIVE'),
            ),
          );
        g2Agents = Number(g2AgentRows[0]?.count ?? 0);
      }
    }

    return {
      myCode,
      referrer: referrerResult,
      referrals: {
        g1Count,
        g2Count,
        g1Agents,
        g2Agents,
      },
    };
  }

  /**
   * Get the immediate referrer for a member.
   *
   * @param memberId - UUID of the member
   * @returns Referrer info with masked reference, or null
   */
  async getReferrer(
    memberId: string,
  ): Promise<{ maskedReference: string; isAgent: boolean } | null> {
    return this.getReferrerInternal(memberId);
  }

  /**
   * Check if a member has a referrer.
   *
   * @param memberId - UUID of the member
   * @returns True if the member has an active referrer
   */
  async hasReferrer(memberId: string): Promise<boolean> {
    const rows = await this.database.db
      .select({ id: memberReferrals.id })
      .from(memberReferrals)
      .where(
        and(
          eq(memberReferrals.memberId, memberId),
          eq(memberReferrals.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  /* ================================================================ */
  /*  PRIVATE HELPERS                                                   */
  /* ================================================================ */

  /**
   * Walk up the referrer chain to detect whether a cycle would be
   * introduced by setting `candidateChild` as the referrer of
   * `candidateParent`.
   *
   * If the chain from `candidateChild` upwards reaches
   * `candidateParent`, a cycle would be created and we throw.
   */
  private async detectCycle(
    db: DatabaseService['db'],
    candidateReferrerId: string,
    candidateRefereeId: string,
    maxDepth: number = 10,
  ): Promise<void> {
    let currentMemberId = candidateReferrerId;
    let depth = 0;

    while (depth < maxDepth) {
      // Walk up the referrer chain
      const rows = await db
        .select({ referrerMemberId: memberReferrals.referrerMemberId })
        .from(memberReferrals)
        .where(
          and(
            eq(memberReferrals.memberId, currentMemberId),
            eq(memberReferrals.status, 'ACTIVE'),
          ),
        )
        .limit(1);

      const referrerId = rows[0]?.referrerMemberId;
      if (!referrerId) {
        // Reached the top of the tree — no cycle
        return;
      }

      if (referrerId === candidateRefereeId) {
        throw referralCycleDetectedError();
      }

      currentMemberId = referrerId;
      depth++;
    }

    // Exceeded max depth — treat as cycle to prevent very deep chains
    throw referralCycleDetectedError();
  }

  /**
   * Internal helper to resolve referrer info for a member.
   */
  private async getReferrerInternal(
    memberId: string,
  ): Promise<{ maskedReference: string; isAgent: boolean } | null> {
    const rows = await this.database.db
      .select({
        referrerMemberId: memberReferrals.referrerMemberId,
        referralCodeSnapshot: memberReferrals.referralCodeSnapshot,
      })
      .from(memberReferrals)
      .where(
        and(
          eq(memberReferrals.memberId, memberId),
          eq(memberReferrals.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    const referral = rows[0];
    if (!referral) return null;

    // Check if referrer is an agent
    const agentRows = await this.database.db
      .select({ id: agentActivations.id })
      .from(agentActivations)
      .where(
        and(
          eq(agentActivations.memberId, referral.referrerMemberId),
          eq(agentActivations.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    return {
      maskedReference: maskReference(referral.referralCodeSnapshot),
      isAgent: agentRows.length > 0,
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Mask a referral code for display (e.g. "JOHNDOE" → "JO****OE").
 */
function maskReference(code: string): string {
  if (code.length <= 2) return `${code.slice(0, 1)}*`;
  return `${code.slice(0, 2)}${'*'.repeat(Math.min(code.length - 4, 4))}${code.slice(-2)}`;
}

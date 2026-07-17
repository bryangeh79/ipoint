import { Inject, Injectable } from '@nestjs/common';
import {
  accounts,
  memberAccountCountryChangeRequests,
  members,
} from '@ipoint/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { CountryChangeError } from './country-change.errors.js';
import type {
  CountryChangeRequestResponse,
  CountryChangeRequestRow,
} from './country-change.types.js';

@Injectable()
export class CountryChangeService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /**
   * Resolve the member ID from an account ID.
   * There is a 1:1 relationship between members and accounts.
   */
  private async resolveMemberId(accountId: string): Promise<string> {
    const rows = await this.database.db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.accountId, accountId))
      .limit(1);

    const member = rows[0];
    if (!member) {
      throw new CountryChangeError(
        'COUNTRY_CHANGE_MEMBER_NOT_FOUND',
        'Member not found.',
      );
    }

    return member.id;
  }

  /**
   * View pending or cancelled country change requests for the current member.
   * Returns the most recent requests ordered by submittedAt descending.
   */
  async findRequests(
    accountId: string,
  ): Promise<CountryChangeRequestResponse[]> {
    const memberId = await this.resolveMemberId(accountId);

    const rows = await this.database.db
      .select()
      .from(memberAccountCountryChangeRequests)
      .where(
        and(
          eq(memberAccountCountryChangeRequests.memberId, memberId),
          sql`${memberAccountCountryChangeRequests.status} IN ('PENDING', 'CANCELLED')`,
        ),
      )
      .orderBy(desc(memberAccountCountryChangeRequests.submittedAt));

    return rows.map(
      (row: CountryChangeRequestRow): CountryChangeRequestResponse =>
        this.toResponse(row),
    );
  }

  /**
   * Submit a new country change request.
   * Validates: member exists, requested country differs from current,
   * no pending request already exists.
   */
  async submit(
    accountId: string,
    requestedCountry: string,
    reason: string,
  ): Promise<CountryChangeRequestResponse> {
    const memberId = await this.resolveMemberId(accountId);

    // Get current country from account
    const accountRows = await this.database.db
      .select({ accountCountry: accounts.accountCountry })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);

    const account = accountRows[0];
    if (!account) {
      throw new CountryChangeError(
        'COUNTRY_CHANGE_MEMBER_NOT_FOUND',
        'Account not found.',
      );
    }

    const currentCountry = account.accountCountry;

    // Must be different country
    if (currentCountry === requestedCountry) {
      throw new CountryChangeError(
        'COUNTRY_CHANGE_COUNTRY_SAME',
        'The requested country is the same as the current country.',
      );
    }

    // Check no pending request exists (DB unique partial index also enforces this)
    const pendingRows = await this.database.db
      .select({ id: memberAccountCountryChangeRequests.id })
      .from(memberAccountCountryChangeRequests)
      .where(
        and(
          eq(memberAccountCountryChangeRequests.memberId, memberId),
          eq(memberAccountCountryChangeRequests.status, 'PENDING'),
        ),
      )
      .limit(1);

    if (pendingRows[0]) {
      throw new CountryChangeError(
        'COUNTRY_CHANGE_ALREADY_PENDING',
        'A country change request is already pending.',
      );
    }

    // Insert the request
    const inserted = await this.database.db
      .insert(memberAccountCountryChangeRequests)
      .values({
        memberId,
        accountId,
        currentCountry,
        requestedCountry,
        status: 'PENDING',
        reason,
      })
      .returning();

    const row = inserted[0] as CountryChangeRequestRow | undefined;
    if (!row) {
      throw new Error('Failed to create country change request.');
    }

    return this.toResponse(row);
  }

  /**
   * Cancel a pending country change request.
   * Only PENDING requests can be cancelled.
   */
  async cancel(accountId: string): Promise<CountryChangeRequestResponse> {
    const memberId = await this.resolveMemberId(accountId);

    // Find the pending request
    const rows = await this.database.db
      .select()
      .from(memberAccountCountryChangeRequests)
      .where(
        and(
          eq(memberAccountCountryChangeRequests.memberId, memberId),
          eq(memberAccountCountryChangeRequests.status, 'PENDING'),
        ),
      )
      .limit(1);

    const request = rows[0] as CountryChangeRequestRow | undefined;

    if (!request) {
      throw new CountryChangeError(
        'COUNTRY_CHANGE_NOT_FOUND',
        'No pending country change request found.',
      );
    }

    // Business rule: Only PENDING can be cancelled
    const now = new Date();

    const updated = await this.database.db
      .update(memberAccountCountryChangeRequests)
      .set({ status: 'CANCELLED', updatedAt: now })
      .where(
        and(
          eq(memberAccountCountryChangeRequests.id, request.id),
          eq(memberAccountCountryChangeRequests.status, 'PENDING'),
        ),
      )
      .returning();

    const row = updated[0] as CountryChangeRequestRow | undefined;
    if (!row) {
      throw new CountryChangeError(
        'COUNTRY_CHANGE_NOT_FOUND',
        'Failed to cancel the request.',
      );
    }

    return this.toResponse(row);
  }

  private toResponse(
    row: CountryChangeRequestRow,
  ): CountryChangeRequestResponse {
    return {
      id: row.id,
      currentCountry: row.currentCountry,
      requestedCountry: row.requestedCountry,
      status: row.status,
      reason: row.reason,
      submittedAt: row.submittedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewedBy: row.reviewedByAdminUserId ?? null,
      reviewReason: row.reviewReason ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

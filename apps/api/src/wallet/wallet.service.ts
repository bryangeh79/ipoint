import { Inject, Injectable } from '@nestjs/common';
import { memberWalletAccounts, memberWalletEntries } from '@ipoint/database';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { ConfigService } from '../config/config.service.js';
import {
  walletNotFoundError,
  invalidAmountError,
  walletEntryNotFoundError,
} from './wallet.errors.js';
import type {
  WalletAccountResponse,
  WalletEntryResponse,
  PaginatedWalletEntriesResponse,
  CreateLedgerEntryParams,
} from './wallet.types.js';

@Injectable()
export class WalletService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private toWalletResponse(
    row: typeof memberWalletAccounts.$inferSelect,
  ): WalletAccountResponse {
    return {
      id: row.id,
      memberId: row.memberId,
      marketId: row.marketId,
      pendingBalance: row.pendingBalance,
      availableBalance: row.availableBalance,
      reversedBalance: row.reversedBalance,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toEntryResponse(
    row: typeof memberWalletEntries.$inferSelect,
  ): WalletEntryResponse {
    return {
      id: row.id,
      walletAccountId: row.walletAccountId,
      memberId: row.memberId,
      marketId: row.marketId,
      entrySequence: Number(row.entrySequence),
      entryType: row.entryType,
      amount: row.amount,
      balanceBefore: row.balanceBefore,
      balanceAfter: row.balanceAfter,
      idempotencyKey: row.idempotencyKey,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      description: row.description,
      reason: row.reason,
      actorId: row.actorId,
      marketTimezone: row.marketTimezone,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Get or create a wallet for a member + market pair.
   * Returns the wallet if it already exists.
   */
  async getOrCreateWallet(
    memberId: string,
    marketId: string,
  ): Promise<WalletAccountResponse> {
    const existing = await this.database.db
      .select()
      .from(memberWalletAccounts)
      .where(
        and(
          eq(memberWalletAccounts.memberId, memberId),
          eq(memberWalletAccounts.marketId, marketId),
        ),
      )
      .limit(1);

    const foundWallet = existing[0];
    if (foundWallet) {
      return this.toWalletResponse(foundWallet);
    }

    const inserted = await this.database.db
      .insert(memberWalletAccounts)
      .values({
        memberId,
        marketId,
      })
      .returning();

    const createdWallet = inserted[0];
    if (!createdWallet) {
      throw walletNotFoundError();
    }

    return this.toWalletResponse(createdWallet);
  }

  /**
   * Get a specific wallet by memberId + marketId.
   */
  async getWallet(
    memberId: string,
    marketId: string,
  ): Promise<WalletAccountResponse> {
    const rows = await this.database.db
      .select()
      .from(memberWalletAccounts)
      .where(
        and(
          eq(memberWalletAccounts.memberId, memberId),
          eq(memberWalletAccounts.marketId, marketId),
        ),
      )
      .limit(1);

    const walletRow = rows[0];
    if (!walletRow) throw walletNotFoundError();
    return this.toWalletResponse(walletRow);
  }

  /**
   * Get all wallets for a member.
   */
  async getWallets(memberId: string): Promise<WalletAccountResponse[]> {
    const rows = await this.database.db
      .select()
      .from(memberWalletAccounts)
      .where(eq(memberWalletAccounts.memberId, memberId))
      .orderBy(memberWalletAccounts.createdAt);

    return rows.map((row) => this.toWalletResponse(row));
  }

  /**
   * Get the computed balance for a wallet from the sum of all entries.
   * Returns the balance as stored on the wallet account.
   */
  async getBalance(walletId: string): Promise<{
    pending: string;
    available: string;
    reversed: string;
  }> {
    const rows = await this.database.db
      .select({
        pendingBalance: memberWalletAccounts.pendingBalance,
        availableBalance: memberWalletAccounts.availableBalance,
        reversedBalance: memberWalletAccounts.reversedBalance,
      })
      .from(memberWalletAccounts)
      .where(eq(memberWalletAccounts.id, walletId))
      .limit(1);

    const balanceRow = rows[0];
    if (!balanceRow) throw walletNotFoundError();

    return {
      pending: balanceRow.pendingBalance,
      available: balanceRow.availableBalance,
      reversed: balanceRow.reversedBalance,
    };
  }

  /**
   * Create a ledger entry for a wallet.
   * This is the ONLY way to change a wallet's balance.
   * The entry is immutable — no updates, no deletes.
   * Corrections must use compensating entries.
   *
   * Idempotency: If an entry with the same idempotencyKey already exists,
   * it returns the existing entry instead of creating a duplicate.
   */
  async createLedgerEntry(
    params: CreateLedgerEntryParams,
  ): Promise<WalletEntryResponse> {
    if (Number(params.amount) <= 0) throw invalidAmountError();

    return this.database.runTransaction(async (tx) => {
      // Check for duplicate idempotency key (global uniqueness)
      const existingEntry = await tx
        .select()
        .from(memberWalletEntries)
        .where(eq(memberWalletEntries.idempotencyKey, params.idempotencyKey))
        .limit(1);

      const duplicateEntry = existingEntry[0];
      if (duplicateEntry) {
        return this.toEntryResponse(duplicateEntry);
      }

      // Get or create the wallet account with row-level lock
      const wallets = await tx
        .select()
        .from(memberWalletAccounts)
        .where(
          and(
            eq(memberWalletAccounts.memberId, params.memberId),
            eq(memberWalletAccounts.marketId, params.marketId),
          ),
        )
        .for('update')
        .limit(1);

      let wallet: typeof memberWalletAccounts.$inferSelect;
      if (!wallets[0]) {
        // Create wallet atomically
        const inserted = await tx
          .insert(memberWalletAccounts)
          .values({
            memberId: params.memberId,
            marketId: params.marketId,
          })
          .returning();

        if (!inserted[0]) {
          throw walletNotFoundError();
        }

        wallet = inserted[0];
      } else {
        wallet = wallets[0];
      }

      // Determine the balance delta for this entry type
      const amountNum = params.amount;
      const zero = '0';

      let pendingDelta: string;
      let availableDelta: string;
      let reversedDelta: string;

      switch (params.entryType) {
        case 'PENDING':
          pendingDelta = amountNum;
          availableDelta = zero;
          reversedDelta = zero;
          break;
        case 'AVAILABLE':
          pendingDelta = `-${amountNum}`;
          availableDelta = amountNum;
          reversedDelta = zero;
          break;
        case 'REVERSED':
          pendingDelta = `-${amountNum}`;
          availableDelta = zero;
          reversedDelta = amountNum;
          break;
        case 'COMPENSATION':
          pendingDelta = zero;
          availableDelta = amountNum;
          reversedDelta = zero;
          break;
        case 'ADJUSTMENT':
          pendingDelta = zero;
          availableDelta = amountNum;
          reversedDelta = zero;
          break;
        default:
          throw invalidAmountError();
      }

      // Compute new balances using decimal addition via SQL
      const newPending = sql`CAST(${memberWalletAccounts.pendingBalance} AS numeric(38,10)) + CAST(${pendingDelta} AS numeric(38,10))`;
      const newAvailable = sql`CAST(${memberWalletAccounts.availableBalance} AS numeric(38,10)) + CAST(${availableDelta} AS numeric(38,10))`;
      const newReversed = sql`CAST(${memberWalletAccounts.reversedBalance} AS numeric(38,10)) + CAST(${reversedDelta} AS numeric(38,10))`;

      // Compute balance before (current snapshot before update)
      const balanceBefore = wallet.pendingBalance;

      // Get next sequence number
      const maxSeqResult = await tx
        .select({
          maxSeq: sql<bigint>`COALESCE(MAX(${memberWalletEntries.entrySequence}), 0) + 1`,
        })
        .from(memberWalletEntries)
        .where(eq(memberWalletEntries.walletAccountId, wallet.id));

      const nextSeq = BigInt(String(maxSeqResult[0]?.maxSeq ?? 1));

      // Update wallet balances
      const updatedWallets = await tx
        .update(memberWalletAccounts)
        .set({
          pendingBalance: newPending,
          availableBalance: newAvailable,
          reversedBalance: newReversed,
          version: sql`${memberWalletAccounts.version} + 1`,
          updatedAt: sql`NOW()`,
        })
        .where(
          and(
            eq(memberWalletAccounts.id, wallet.id),
            eq(memberWalletAccounts.version, wallet.version),
          ),
        )
        .returning();

      if (!updatedWallets[0]) {
        // Optimistic lock failure — version mismatch
        // This means concurrent modification; re-run the transaction
        throw new Error('Concurrent wallet update detected. Please retry.');
      }

      const updatedWallet = updatedWallets[0];

      // Insert the immutable ledger entry
      const entries = await tx
        .insert(memberWalletEntries)
        .values({
          walletAccountId: wallet.id,
          memberId: params.memberId,
          marketId: params.marketId,
          entrySequence: nextSeq,
          entryType: params.entryType,
          amount: params.amount,
          balanceBefore: balanceBefore,
          balanceAfter: updatedWallet.pendingBalance,
          idempotencyKey: params.idempotencyKey,
          referenceType: params.referenceType ?? null,
          referenceId: params.referenceId ?? null,
          description: params.description ?? null,
          reason: params.reason ?? null,
          actorId: params.actorId ?? null,
          marketTimezone: params.marketTimezone ?? null,
        })
        .returning();

      if (!entries[0]) {
        throw walletEntryNotFoundError();
      }

      return this.toEntryResponse(entries[0]);
    });
  }

  /**
   * Get paginated ledger entries for a wallet.
   */
  async getEntries(
    walletId: string,
    pagination: { limit: number; offset: number },
  ): Promise<PaginatedWalletEntriesResponse> {
    // Verify wallet exists
    const walletCheck = await this.database.db
      .select({ id: memberWalletAccounts.id })
      .from(memberWalletAccounts)
      .where(eq(memberWalletAccounts.id, walletId))
      .limit(1);

    if (!walletCheck[0]) throw walletNotFoundError();

    const [entries, countResult] = await Promise.all([
      this.database.db
        .select()
        .from(memberWalletEntries)
        .where(eq(memberWalletEntries.walletAccountId, walletId))
        .orderBy(sql`${memberWalletEntries.entrySequence} DESC`)
        .limit(pagination.limit)
        .offset(pagination.offset),
      this.database.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(memberWalletEntries)
        .where(eq(memberWalletEntries.walletAccountId, walletId)),
    ]);

    return {
      entries: entries.map((e) => this.toEntryResponse(e)),
      total: Number(countResult[0]?.count ?? 0),
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }

  /**
   * Get a single ledger entry by ID.
   */
  async getEntry(
    walletId: string,
    entryId: string,
  ): Promise<WalletEntryResponse> {
    const rows = await this.database.db
      .select()
      .from(memberWalletEntries)
      .where(
        and(
          eq(memberWalletEntries.walletAccountId, walletId),
          eq(memberWalletEntries.id, entryId),
        ),
      )
      .limit(1);

    const entryRow = rows[0];
    if (!entryRow) {
      throw walletEntryNotFoundError();
    }

    return this.toEntryResponse(entryRow);
  }
}

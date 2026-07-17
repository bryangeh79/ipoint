import { createHash } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  adminUsers,
  mcpAccounts,
  mcpLedgerEntries,
  mcpRechargeRequests,
  merchantBranches,
  type Database,
} from '@ipoint/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type {
  CreateRechargeDto,
  LedgerQueryDto,
  ReviewRechargeDto,
} from './dto/mcp.dto.js';
import type { MerchantRequestContext } from './merchant.service.js';

type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

@Injectable()
export class McpService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async summary(branchId: string) {
    const account = await this.accountForBranch(this.database.db, branchId);
    return this.accountView(account);
  }

  async ledger(branchId: string, query: LedgerQueryDto) {
    const account = await this.accountForBranch(this.database.db, branchId);
    return this.ledgerForAccount(account.id, query);
  }

  async adminAccount(marketId: string, accountId: string) {
    const account = await this.accountById(
      this.database.db,
      accountId,
      marketId,
    );
    return this.accountView(account);
  }

  async adminLedger(
    marketId: string,
    accountId: string,
    query: LedgerQueryDto,
  ) {
    await this.accountById(this.database.db, accountId, marketId);
    return this.ledgerForAccount(accountId, query);
  }

  async reconcile(marketId: string, accountId: string) {
    const account = await this.accountById(
      this.database.db,
      accountId,
      marketId,
    );
    const result = await this.database.db.execute(sql`
      SELECT COALESCE(sum(balance_delta), 0)::text AS total,
             COALESCE(sum(available_delta), 0)::text AS available,
             count(*)::int AS entries
      FROM mcp_ledger_entries WHERE mcp_account_id = ${accountId}
    `);
    const computed = result.rows[0] as {
      total: string;
      available: string;
      entries: number;
    };
    return {
      account_id: accountId,
      stored: {
        total: account.totalBalance,
        available: account.availableBalance,
      },
      computed,
      matches:
        normalize(account.totalBalance) === normalize(computed.total) &&
        normalize(account.availableBalance) === normalize(computed.available),
    };
  }

  async createRecharge(
    marketId: string,
    branchId: string,
    adminUserId: string,
    input: CreateRechargeDto,
    key: string,
    context: MerchantRequestContext,
  ) {
    const payloadHash = hash({ amount: input.amount, reason: input.reason });
    try {
      return await this.database.db.transaction(async (tx) => {
        const account = await this.accountForBranch(tx, branchId, marketId);
        const admin = await this.admin(tx, adminUserId);
        const rows = await tx
          .insert(mcpRechargeRequests)
          .values({
            mcpAccountId: account.id,
            marketId,
            requestedByAccountId: admin.accountId,
            amount: input.amount,
            channel: 'ADMIN_MANUAL',
            idempotencyKey: key,
            payloadHash,
          })
          .returning();
        const request = required(rows[0]);
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ADMIN_USER', id: adminUserId },
          action: 'MCP_RECHARGE_REQUESTED',
          entity: { type: 'MCP_RECHARGE_REQUEST', id: request.id },
          marketId,
          after: request,
          reason: input.reason,
          result: 'SUCCESS',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          summary: 'MCP recharge request created.',
        });
        return request;
      });
    } catch (error) {
      if (databaseCode(error) !== '23505') throw error;
      const account = await this.accountForBranch(
        this.database.db,
        branchId,
        marketId,
      );
      const rows = await this.database.db
        .select()
        .from(mcpRechargeRequests)
        .where(
          and(
            eq(mcpRechargeRequests.mcpAccountId, account.id),
            eq(mcpRechargeRequests.idempotencyKey, key),
          ),
        )
        .limit(1);
      const existing = rows[0];
      if (existing?.payloadHash === payloadHash) return existing;
      throw this.idempotencyConflict();
    }
  }

  async reviewRecharge(
    marketId: string,
    requestId: string,
    adminUserId: string,
    input: ReviewRechargeDto,
    context: MerchantRequestContext,
  ) {
    const reviewHash = hash(input);
    return this.database.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT * FROM mcp_recharge_requests
        WHERE id = ${requestId} AND market_id = ${marketId} FOR UPDATE
      `);
      const request = locked.rows[0] as Record<string, unknown> | undefined;
      if (!request)
        throw new NotFoundException({ code: 'MCP_RECHARGE_NOT_FOUND' });
      if (request['status'] !== 'PENDING') {
        if (request['review_payload_hash'] === reviewHash) return request;
        throw this.idempotencyConflict();
      }
      await this.admin(tx, adminUserId);
      let ledgerEntryId: string | undefined;
      if (input.decision === 'COMPLETED') {
        const postingHash = hash({ requestId, amount: request['amount'] });
        const posting = await tx.execute(sql`
          SELECT * FROM append_mcp_ledger_entry(
            ${String(request['mcp_account_id'])}::uuid, 'RECHARGE'::mcp_entry_type,
            'CREDIT'::mcp_direction, ${String(request['amount'])}::numeric,
            ${String(request['amount'])}::numeric, ${String(request['amount'])}::numeric,
            'RECHARGE_REQUEST', ${requestId}, ${`recharge:${requestId}`}, ${postingHash},
            'ADMIN_USER', ${adminUserId}, ${input.reason}, now()
          )
        `);
        ledgerEntryId = String(posting.rows[0]?.['entry_id']);
      }
      const rows = await tx
        .update(mcpRechargeRequests)
        .set({
          status: input.decision,
          reviewedByAdminUserId: adminUserId,
          reviewReason: input.reason,
          reviewPayloadHash: reviewHash,
          ledgerEntryId,
          updatedAt: new Date(),
        })
        .where(eq(mcpRechargeRequests.id, requestId))
        .returning();
      const updated = required(rows[0]);
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: adminUserId },
        action:
          input.decision === 'COMPLETED'
            ? 'MCP_RECHARGE_COMPLETED'
            : 'MCP_RECHARGE_FAILED',
        entity: { type: 'MCP_RECHARGE_REQUEST', id: requestId },
        marketId,
        before: request,
        after: updated,
        reason: input.reason,
        result: 'SUCCESS',
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        summary: `MCP recharge ${input.decision.toLowerCase()}.`,
      });
      return updated;
    });
  }

  private async ledgerForAccount(accountId: string, query: LedgerQueryDto) {
    const items = await this.database.db
      .select()
      .from(mcpLedgerEntries)
      .where(eq(mcpLedgerEntries.mcpAccountId, accountId))
      .orderBy(desc(mcpLedgerEntries.sequence))
      .limit(query.limit)
      .offset(query.offset);
    return {
      items: items.map((item) => ({
        ...item,
        sequence: item.sequence.toString(),
      })),
      limit: query.limit,
      offset: query.offset,
    };
  }

  private accountView(account: typeof mcpAccounts.$inferSelect) {
    return {
      id: account.id,
      branch_id: account.merchantBranchId,
      market_id: account.marketId,
      available_balance: account.availableBalance,
      total_balance: account.totalBalance,
      status: account.status,
      version: account.version,
    };
  }

  private async accountForBranch(
    tx: DatabaseTransaction | Database,
    branchId: string,
    marketId?: string,
  ) {
    const rows = await tx
      .select({
        account: mcpAccounts,
        branchMarketId: merchantBranches.marketId,
      })
      .from(mcpAccounts)
      .innerJoin(
        merchantBranches,
        eq(merchantBranches.id, mcpAccounts.merchantBranchId),
      )
      .where(eq(mcpAccounts.merchantBranchId, branchId))
      .limit(1);
    const row = rows[0];
    if (!row || (marketId && row.branchMarketId !== marketId))
      throw new NotFoundException({ code: 'MCP_ACCOUNT_NOT_FOUND' });
    return row.account;
  }

  private async accountById(
    tx: DatabaseTransaction | Database,
    accountId: string,
    marketId: string,
  ) {
    const rows = await tx
      .select()
      .from(mcpAccounts)
      .where(
        and(eq(mcpAccounts.id, accountId), eq(mcpAccounts.marketId, marketId)),
      )
      .limit(1);
    const account = rows[0];
    if (!account)
      throw new NotFoundException({ code: 'MCP_ACCOUNT_NOT_FOUND' });
    return account;
  }

  private async admin(tx: DatabaseTransaction, adminUserId: string) {
    const rows = await tx
      .select({ accountId: adminUsers.accountId })
      .from(adminUsers)
      .where(eq(adminUsers.id, adminUserId))
      .limit(1);
    const admin = rows[0];
    if (!admin) throw new NotFoundException({ code: 'ADMIN_NOT_FOUND' });
    return admin;
  }

  private idempotencyConflict() {
    return new ConflictException({
      code: 'MCP_IDEMPOTENCY_CONFLICT',
      message: 'The idempotency key was reused with a different payload.',
    });
  }
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function normalize(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  return (
    BigInt(whole) * 10_000_000_000n +
    BigInt(fraction.padEnd(10, '0'))
  ).toString();
}
function required<T>(value: T | undefined): T {
  if (!value) throw new Error('Expected database row.');
  return value;
}
function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  return databaseCode((error as { cause?: unknown }).cause);
}

import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  adminUsers,
  mcpAccounts,
  mcpAdjustmentDecisions,
  mcpAdjustmentRequests,
  mcpLedgerEntries,
  mcpRechargeRequests,
  mcpRefundRequests,
  merchantBranches,
  type Database,
} from '@ipoint/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type {
  CreateRechargeDto,
  CreateAdjustmentDto,
  AdjustmentDecisionDto,
  AdjustmentActionDto,
  CreateRefundDto,
  LedgerQueryDto,
  ReviewRechargeDto,
  ReviewRefundDto,
} from './dto/mcp.dto.js';
import {
  MerchantService,
  type MerchantRequestContext,
} from './merchant.service.js';

type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

@Injectable()
export class McpService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MerchantService) private readonly merchants: MerchantService,
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
    const result = await this.database.db.transaction(async (tx) => {
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
    if (input.decision === 'COMPLETED') {
      const value = result as unknown as Record<string, unknown>;
      const rawMcpAccountId =
        value['mcpAccountId'] ?? value['mcp_account_id'];
      const mcpAccountId =
        typeof rawMcpAccountId === 'string' ? rawMcpAccountId : '';
      const account = await this.accountById(
        this.database.db,
        mcpAccountId,
        marketId,
      );
      await this.merchants.reevaluateOperationalStatus(
        account.merchantBranchId,
        { type: 'ADMIN_USER', id: adminUserId },
        'MCP recharge completion reevaluated activation policy.',
      );
    }
    return result;
  }

  async createAdjustment(
    marketId: string,
    accountId: string,
    adminUserId: string,
    input: CreateAdjustmentDto,
    key: string,
    context: MerchantRequestContext,
  ) {
    const payloadHash = hash(input);
    try {
      return await this.database.db.transaction(async (tx) => {
        await this.accountById(tx, accountId, marketId);
        await this.admin(tx, adminUserId);
        const rows = await tx
          .insert(mcpAdjustmentRequests)
          .values({
            mcpAccountId: accountId,
            marketId,
            makerAdminUserId: adminUserId,
            entryType: input.type,
            amount: input.amount,
            reason: input.reason,
            evidence: input.evidence,
            idempotencyKey: key,
            payloadHash,
          })
          .returning();
        const request = required(rows[0]);
        await this.governanceAudit(
          tx,
          adminUserId,
          marketId,
          'MCP_ADJUSTMENT_CREATED',
          'MCP_ADJUSTMENT_REQUEST',
          request.id,
          input.reason,
          request,
          context,
        );
        return request;
      });
    } catch (error) {
      if (databaseCode(error) !== '23505') throw error;
      const rows = await this.database.db
        .select()
        .from(mcpAdjustmentRequests)
        .where(
          and(
            eq(mcpAdjustmentRequests.mcpAccountId, accountId),
            eq(mcpAdjustmentRequests.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (rows[0]?.payloadHash === payloadHash) return rows[0];
      throw this.idempotencyConflict();
    }
  }

  async createAdjustmentForBranch(
    marketId: string,
    branchId: string,
    adminUserId: string,
    input: CreateAdjustmentDto,
    key: string,
    context: MerchantRequestContext,
  ) {
    const account = await this.accountForBranch(
      this.database.db,
      branchId,
      marketId,
    );
    return this.createAdjustment(
      marketId,
      account.id,
      adminUserId,
      input,
      key,
      context,
    );
  }

  async submitAdjustment(
    marketId: string,
    requestId: string,
    adminUserId: string,
    context: MerchantRequestContext,
  ) {
    return this.database.db.transaction(async (tx) => {
      const request = await this.lockAdjustment(tx, marketId, requestId);
      if (request.maker_admin_user_id !== adminUserId)
        throw new ForbiddenException({ code: 'MCP_ADJUSTMENT_MAKER_REQUIRED' });
      if (request.status !== 'DRAFT') throw this.stateConflict();
      const rows = await tx
        .update(mcpAdjustmentRequests)
        .set({
          status: 'PENDING_APPROVAL',
          version: sql`${mcpAdjustmentRequests.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(mcpAdjustmentRequests.id, requestId))
        .returning();
      const updated = required(rows[0]);
      await this.governanceAudit(
        tx,
        adminUserId,
        marketId,
        'MCP_ADJUSTMENT_SUBMITTED',
        'MCP_ADJUSTMENT_REQUEST',
        requestId,
        String(request.reason),
        updated,
        context,
      );
      return updated;
    });
  }

  async decideAdjustment(
    marketId: string,
    requestId: string,
    checkerId: string,
    input: AdjustmentDecisionDto,
    context: MerchantRequestContext,
  ) {
    const decided = await this.approveAdjustment(
      marketId,
      requestId,
      checkerId,
      input,
      context,
    );
    if (input.decision === 'REJECTED') return decided;
    return this.executeAdjustment(
      marketId,
      requestId,
      checkerId,
      { reason: input.reason },
      context,
    );
  }

  async approveAdjustment(
    marketId: string,
    requestId: string,
    checkerId: string,
    input: AdjustmentDecisionDto,
    context: MerchantRequestContext,
  ) {
    return this.database.db.transaction(async (tx) => {
      const request = await this.lockAdjustment(tx, marketId, requestId);
      if (request.maker_admin_user_id === checkerId)
        throw new ForbiddenException({
          code: 'MCP_MAKER_CHECKER_CONFLICT',
          message: 'Maker cannot check their own request.',
        });
      if (request.status !== 'PENDING_APPROVAL') throw this.stateConflict();
      await this.admin(tx, checkerId);
      await this.accountById(tx, String(request.mcp_account_id), marketId);
      await tx.insert(mcpAdjustmentDecisions).values({
        adjustmentRequestId: requestId,
        marketId,
        checkerAdminUserId: checkerId,
        decision: input.decision,
        reason: input.reason,
      });
      const rows = await tx
        .update(mcpAdjustmentRequests)
        .set({
          status: input.decision,
          version: sql`${mcpAdjustmentRequests.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(mcpAdjustmentRequests.id, requestId))
        .returning();
      const updated = required(rows[0]);
      await this.governanceAudit(
        tx,
        checkerId,
        marketId,
        `MCP_ADJUSTMENT_${input.decision}`,
        'MCP_ADJUSTMENT_REQUEST',
        requestId,
        input.reason,
        updated,
        context,
      );
      return updated;
    });
  }

  async executeAdjustment(
    marketId: string,
    requestId: string,
    executorId: string,
    input: AdjustmentActionDto,
    context: MerchantRequestContext,
  ) {
    return this.database.db.transaction(async (tx) => {
      const request = await this.lockAdjustment(tx, marketId, requestId);
      if (request.status === 'EXECUTED') return request;
      if (request.status !== 'APPROVED') throw this.stateConflict();
      if (request.maker_admin_user_id === executorId)
        throw new ForbiddenException({
          code: 'MCP_MAKER_CHECKER_CONFLICT',
          message: 'Maker cannot execute their own request.',
        });
      await this.admin(tx, executorId);
      await this.accountById(tx, String(request.mcp_account_id), marketId);
      const debit = request.entry_type === 'MANUAL_DEBIT';
      const delta = debit
        ? `-${String(request.amount)}`
        : String(request.amount);
      const posting = await tx.execute(sql`
        SELECT * FROM append_mcp_ledger_entry(
          ${String(request.mcp_account_id)}::uuid, ${String(request.entry_type)}::mcp_entry_type,
          ${debit ? 'DEBIT' : 'CREDIT'}::mcp_direction, ${String(request.amount)}::numeric,
          ${delta}::numeric, ${delta}::numeric, 'ADJUSTMENT_REQUEST', ${requestId},
          ${`adjustment:${requestId}`}, ${hash({ requestId, amount: request.amount, type: request.entry_type })},
          'ADMIN_USER', ${executorId}, ${input.reason}, now())
      `);
      const ledgerEntryId = String(posting.rows[0]?.['entry_id']);
      const rows = await tx
        .update(mcpAdjustmentRequests)
        .set({
          status: 'EXECUTED',
          ledgerEntryId,
          version: sql`${mcpAdjustmentRequests.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(mcpAdjustmentRequests.id, requestId))
        .returning();
      const updated = required(rows[0]);
      await this.governanceAudit(
        tx,
        executorId,
        marketId,
        'MCP_ADJUSTMENT_EXECUTED',
        'MCP_ADJUSTMENT_REQUEST',
        requestId,
        input.reason,
        updated,
        context,
      );
      return updated;
    });
  }

  async createRefund(
    branchId: string,
    requesterAccountId: string,
    input: CreateRefundDto,
    key: string,
    context: MerchantRequestContext,
  ) {
    const payloadHash = hash(input);
    try {
      return await this.database.db.transaction(async (tx) => {
        const account = await this.accountForBranch(tx, branchId);
        const rows = await tx
          .insert(mcpRefundRequests)
          .values({
            mcpAccountId: account.id,
            marketId: account.marketId,
            requestedByAccountId: requesterAccountId,
            amount: input.amount,
            reason: input.reason,
            idempotencyKey: key,
            payloadHash,
          })
          .returning();
        const request = required(rows[0]);
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ACCOUNT', id: requesterAccountId },
          action: 'MCP_REFUND_REQUESTED',
          entity: { type: 'MCP_REFUND_REQUEST', id: request.id },
          marketId: account.marketId,
          after: request,
          reason: input.reason,
          result: 'SUCCESS',
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          summary: 'Non-cash refund obligation requested.',
        });
        return request;
      });
    } catch (error) {
      if (databaseCode(error) !== '23505') throw error;
      const account = await this.accountForBranch(this.database.db, branchId);
      const rows = await this.database.db
        .select()
        .from(mcpRefundRequests)
        .where(
          and(
            eq(mcpRefundRequests.mcpAccountId, account.id),
            eq(mcpRefundRequests.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (rows[0]?.payloadHash === payloadHash) return rows[0];
      throw this.idempotencyConflict();
    }
  }

  async createAdminRefund(
    marketId: string,
    branchId: string,
    adminUserId: string,
    input: CreateRefundDto,
    key: string,
    context: MerchantRequestContext,
  ) {
    const adminRows = await this.database.db
      .select({ accountId: adminUsers.accountId })
      .from(adminUsers)
      .where(eq(adminUsers.id, adminUserId))
      .limit(1);
    const admin = adminRows[0];
    if (!admin) throw new NotFoundException({ code: 'ADMIN_NOT_FOUND' });
    await this.accountForBranch(this.database.db, branchId, marketId);
    return this.createRefund(branchId, admin.accountId, input, key, context);
  }

  async reviewRefund(
    marketId: string,
    requestId: string,
    adminUserId: string,
    input: ReviewRefundDto,
    context: MerchantRequestContext,
  ) {
    return this.database.db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT * FROM mcp_refund_requests WHERE id = ${requestId} AND market_id = ${marketId} FOR UPDATE`,
      );
      const request = locked.rows[0] as Record<string, unknown> | undefined;
      if (!request)
        throw new NotFoundException({ code: 'MCP_REFUND_NOT_FOUND' });
      await this.admin(tx, adminUserId);
      if (
        (request['status'] === 'PENDING' &&
          input.decision !== 'UNDER_REVIEW') ||
        (request['status'] === 'UNDER_REVIEW' &&
          input.decision === 'UNDER_REVIEW') ||
        !['PENDING', 'UNDER_REVIEW'].includes(String(request['status']))
      )
        throw this.stateConflict();
      let ledgerEntryId: string | undefined;
      if (input.decision === 'APPROVED') {
        const amount = String(request['amount']);
        const posting = await tx.execute(sql`
          SELECT * FROM append_mcp_ledger_entry(
            ${String(request['mcp_account_id'])}::uuid, 'REFUND'::mcp_entry_type, 'DEBIT'::mcp_direction,
            ${amount}::numeric, 0, ${`-${amount}`}::numeric, 'REFUND_REQUEST', ${requestId},
            ${`refund:${requestId}`}, ${hash({ requestId, amount })}, 'ADMIN_USER', ${adminUserId},
            ${input.reason}, now(), NULL, ${JSON.stringify({ obligation: 'NON_CASH', reserved: true })}::jsonb)
        `);
        ledgerEntryId = String(posting.rows[0]?.['entry_id']);
      }
      const rows = await tx
        .update(mcpRefundRequests)
        .set({
          status: input.decision,
          reviewedByAdminUserId: adminUserId,
          reviewReason: input.reason,
          ledgerEntryId,
          updatedAt: new Date(),
        })
        .where(eq(mcpRefundRequests.id, requestId))
        .returning();
      const updated = required(rows[0]);
      await this.governanceAudit(
        tx,
        adminUserId,
        marketId,
        `MCP_REFUND_${input.decision}`,
        'MCP_REFUND_REQUEST',
        requestId,
        input.reason,
        updated,
        context,
      );
      return updated;
    });
  }

  private async lockAdjustment(
    tx: DatabaseTransaction,
    marketId: string,
    requestId: string,
  ) {
    const result = await tx.execute(
      sql`SELECT * FROM mcp_adjustment_requests WHERE id = ${requestId} AND market_id = ${marketId} FOR UPDATE`,
    );
    const request = result.rows[0] as Record<string, unknown> | undefined;
    if (!request)
      throw new NotFoundException({ code: 'MCP_ADJUSTMENT_NOT_FOUND' });
    return request;
  }

  private async governanceAudit(
    tx: DatabaseTransaction,
    adminUserId: string,
    marketId: string,
    action: string,
    entityType: string,
    entityId: string,
    reason: string,
    after: unknown,
    context: MerchantRequestContext,
  ) {
    await this.audit.appendWithinTransaction(tx, {
      actor: { type: 'ADMIN_USER', id: adminUserId },
      action,
      entity: { type: entityType, id: entityId },
      marketId,
      after,
      reason,
      result: 'SUCCESS',
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      summary: action.replaceAll('_', ' ').toLowerCase(),
    });
  }

  private stateConflict() {
    return new ConflictException({ code: 'MCP_REQUEST_STATE_CONFLICT' });
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

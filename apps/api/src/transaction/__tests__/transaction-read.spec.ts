import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import {
  parseMemberTransactionListQuery,
  parseMerchantTransactionListQuery,
} from '../transaction-read.dto.js';
import { TransactionReadService } from '../transaction-read.service.js';

const branchId = '11111111-1111-4111-8111-111111111111';
const otherBranchId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const memberId = '44444444-4444-4444-8444-444444444444';
const internalUuid = '55555555-5555-4555-8555-555555555555';

interface ReadRow {
  transactionNumber: string;
  status: 'CONFIRMED';
  publicMerchantId: string;
  merchantName: string;
  branchName: string;
  protectedMemberReference: string;
  memberDisplayName: string | null;
  marketCode: string;
  currency: string;
  purchaseAmount: string;
  packageName: string;
  serviceFeeRate: string;
  serviceFeeAmount: string;
  rewardRate: string;
  dailyRewardAmount: string;
  rewardCap: string;
  rewardStartBusinessDate: string;
  merchantReceiptNumber: string | null;
  transactionNote: string | null;
  transactionTime: Date;
  mcpDeducted: string;
  mcpBalanceAfter: string;
}

type MockRow = ReadRow | { branchId: string } | { memberId: string };
type QueryMock = Mock<
  (sql: string, params?: readonly unknown[]) => Promise<{ rows: MockRow[] }>
>;

describe('P4-S5 transaction history and receipt read models', () => {
  let query: QueryMock;
  let service: TransactionReadService;

  beforeEach(() => {
    query =
      vi.fn<
        (
          sql: string,
          params?: readonly unknown[],
        ) => Promise<{ rows: MockRow[] }>
      >();
    const database = Object.create(
      DatabaseService.prototype,
    ) as DatabaseService;
    const pool = Object.create(null) as object;
    Object.defineProperty(pool, 'query', { value: query });
    Object.defineProperty(database, 'pool', {
      value: pool,
    });
    service = new TransactionReadService(database);
  });

  it('1. lists transactions only from an authorized merchant branch', async () => {
    merchantQueries([row()]);
    const result = await service.listMerchantTransactions(
      accountId,
      merchantQuery(),
    );
    expect(result.items).toHaveLength(1);
    expect(query.mock.calls[1]?.[1]?.[0]).toEqual([branchId]);
  });

  it('2. creates a stable cursor from the final returned row', async () => {
    merchantQueries([row('102'), row('101')]);
    const result = await service.listMerchantTransactions(
      accountId,
      merchantQuery({ limit: '1' }),
    );
    expect(result.items.map((item) => item.transactionNumber)).toEqual(['102']);
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  it('3. retrieves a next page after the prior cursor without duplicates', async () => {
    merchantQueries([row('102'), row('101')]);
    const first = await service.listMerchantTransactions(
      accountId,
      merchantQuery({ limit: '1' }),
    );
    query.mockReset();
    merchantQueries([row('101')]);
    const second = await service.listMerchantTransactions(
      accountId,
      merchantQuery({ limit: '1', cursor: first.nextCursor! }),
    );
    expect(second.items.map((item) => item.transactionNumber)).toEqual(['101']);
    expect(query.mock.calls[1]?.[1]?.[7]).toBe('2026-07-24T10:02:00.000Z');
    expect(query.mock.calls[1]?.[1]?.[8]).toBe('102');
  });

  it('4. applies the merchant status filter', async () => {
    merchantQueries([]);
    await service.listMerchantTransactions(
      accountId,
      merchantQuery({ status: 'CONFIRMED' }),
    );
    expect(query.mock.calls[1]?.[1]?.[1]).toBe('CONFIRMED');
  });

  it('5. applies the merchant market filter', async () => {
    merchantQueries([]);
    await service.listMerchantTransactions(
      accountId,
      merchantQuery({ marketCode: 'my' }),
    );
    expect(query.mock.calls[1]?.[1]?.[2]).toBe('MY');
  });

  it('6. applies an inclusive merchant date range', async () => {
    merchantQueries([]);
    const filters = {
      dateFrom: '2026-07-01T00:00:00.000Z',
      dateTo: '2026-07-31T23:59:59.999Z',
    };
    await service.listMerchantTransactions(accountId, merchantQuery(filters));
    expect(query.mock.calls[1]?.[1]?.slice(3, 5)).toEqual([
      filters.dateFrom,
      filters.dateTo,
    ]);
  });

  it('7. applies the merchant transaction-number filter', async () => {
    merchantQueries([]);
    await service.listMerchantTransactions(
      accountId,
      merchantQuery({ transactionNumber: '123' }),
    );
    expect(query.mock.calls[1]?.[1]?.[6]).toBe('123');
  });

  it('8. applies the merchant receipt-number filter', async () => {
    merchantQueries([]);
    await service.listMerchantTransactions(
      accountId,
      merchantQuery({ merchantReceiptNumber: 'POS-123' }),
    );
    expect(query.mock.calls[1]?.[1]?.[5]).toBe('POS-123');
  });

  it('9. rejects a branch outside the merchant access contract', async () => {
    query.mockResolvedValueOnce({ rows: [{ branchId }] });
    await expect(
      service.listMerchantTransactions(
        accountId,
        merchantQuery({ branchId: otherBranchId }),
      ),
    ).rejects.toSatisfy(
      errorWithCode(ForbiddenException, 'TRANSACTION_MERCHANT_ACCESS_DENIED'),
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('10. scopes merchant reads against access-derived branches', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ branchId }, { branchId: otherBranchId }],
      })
      .mockResolvedValueOnce({ rows: [] });
    await service.listMerchantTransactions(accountId, merchantQuery());
    expect(query.mock.calls[1]?.[1]?.[0]).toEqual([branchId, otherBranchId]);
  });

  it('11. retrieves merchant receipt detail by transaction number', async () => {
    merchantQueries([row()]);
    const result = await service.getMerchantTransaction(accountId, '101');
    expect(result).toMatchObject({
      transactionNumber: '101',
      merchantReceiptNumber: 'POS-101',
      transactionNote: 'Safe note',
    });
    expect(query.mock.calls[1]?.[1]).toEqual(['101', [branchId]]);
  });

  it('12. returns a privacy-safe not-found response for missing merchant receipts', async () => {
    merchantQueries([]);
    await expect(
      service.getMerchantTransaction(accountId, '999'),
    ).rejects.toSatisfy(
      errorWithCode(NotFoundException, 'TRANSACTION_RECEIPT_NOT_FOUND'),
    );
  });

  it('13. excludes internal UUIDs from merchant responses', async () => {
    merchantQueries([row()]);
    const result = await service.getMerchantTransaction(accountId, '101');
    expect(JSON.stringify(result)).not.toContain(internalUuid);
    expect(result).not.toHaveProperty('merchantBranchId');
    expect(result).not.toHaveProperty('memberId');
    expect(result.package).not.toHaveProperty('packageId');
    expect(result.reward).not.toHaveProperty('rewardRuleVersionId');
  });

  it('14. includes MCP fields in merchant responses', async () => {
    merchantQueries([row()]);
    const result = await service.getMerchantTransaction(accountId, '101');
    expect(result).toMatchObject({
      mcpDeducted: '10.0000000000',
      mcpBalanceAfter: '490.0000000000',
    });
  });

  it('15. lists only the authenticated member transactions', async () => {
    memberQueries([row()]);
    const result = await service.listMemberTransactions(
      accountId,
      memberQuery(),
    );
    expect(result.items).toHaveLength(1);
    expect(query.mock.calls[1]?.[1]?.[0]).toBe(memberId);
  });

  it('16. paginates member history with a cursor', async () => {
    memberQueries([row('102'), row('101')]);
    const result = await service.listMemberTransactions(
      accountId,
      memberQuery({ limit: '1' }),
    );
    expect(result.items[0]?.transactionNumber).toBe('102');
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  it('17. applies the member market filter', async () => {
    memberQueries([]);
    await service.listMemberTransactions(
      accountId,
      memberQuery({ marketCode: 'my' }),
    );
    expect(query.mock.calls[1]?.[1]?.[2]).toBe('MY');
  });

  it('18. applies the member date range', async () => {
    memberQueries([]);
    const filters = {
      dateFrom: '2026-07-01T00:00:00.000Z',
      dateTo: '2026-07-31T23:59:59.999Z',
    };
    await service.listMemberTransactions(accountId, memberQuery(filters));
    expect(query.mock.calls[1]?.[1]?.slice(3, 5)).toEqual([
      filters.dateFrom,
      filters.dateTo,
    ]);
  });

  it('19. filters member history by the public merchant ID', async () => {
    memberQueries([]);
    await service.listMemberTransactions(
      accountId,
      memberQuery({ merchantId: 'OF1234567890' }),
    );
    expect(query.mock.calls[1]?.[1]?.[5]).toBe('OF1234567890');
  });

  it('20. retrieves member receipt detail by transaction number', async () => {
    memberQueries([row()]);
    const result = await service.getMemberTransaction(accountId, '101');
    expect(result).toMatchObject({
      transactionNumber: '101',
      status: 'CONFIRMED',
      currency: 'MYR',
    });
    expect(query.mock.calls[1]?.[1]).toEqual(['101', memberId]);
  });

  it("21. makes another member's transaction inaccessible", async () => {
    memberQueries([]);
    await expect(
      service.getMemberTransaction(accountId, '999'),
    ).rejects.toSatisfy(
      errorWithCode(NotFoundException, 'TRANSACTION_RECEIPT_NOT_FOUND'),
    );
  });

  it('22. excludes merchant MCP fields from member responses', async () => {
    memberQueries([row()]);
    const result = await service.getMemberTransaction(accountId, '101');
    expect(result).not.toHaveProperty('mcpDeducted');
    expect(result).not.toHaveProperty('mcpBalanceAfter');
  });

  it('23. returns only the frozen safe receipt projection to members', async () => {
    memberQueries([row()]);
    const result = await service.getMemberTransaction(accountId, '101');
    expect(Object.keys(result).sort()).toEqual(
      [
        'currency',
        'market',
        'member',
        'merchant',
        'merchantReceiptNumber',
        'package',
        'purchaseAmount',
        'reward',
        'serviceFeeAmount',
        'status',
        'transactionNote',
        'transactionNumber',
        'transactionTime',
      ].sort(),
    );
    expect(result.member.maskedReference).toBe('MEM********7890');
  });

  it('24. excludes internal UUIDs, audit data, hashes and PII from member responses', async () => {
    memberQueries([row()]);
    const result = await service.getMemberTransaction(accountId, '101');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(internalUuid);
    expect(serialized).not.toContain('raw-qr-token');
    expect(serialized).not.toContain('idempotency');
    expect(serialized).not.toContain('member@example.com');
  });

  it('25. rejects a malformed cursor with the required error code', async () => {
    query.mockResolvedValueOnce({ rows: [{ branchId }] });
    await expect(
      service.listMerchantTransactions(
        accountId,
        merchantQuery({ cursor: 'not-a-cursor' }),
      ),
    ).rejects.toSatisfy(
      errorWithCode(BadRequestException, 'TRANSACTION_LIST_CURSOR_INVALID'),
    );
  });

  it('26. rejects an invalid date range with the required error code', () => {
    expectBadRequestCode(
      () =>
        parseMemberTransactionListQuery({
          dateFrom: '2026-07-25T00:00:00.000Z',
          dateTo: '2026-07-24T00:00:00.000Z',
        }),
      'TRANSACTION_LIST_FILTER_INVALID',
    );
  });

  it('27. enforces the maximum list limit', () => {
    expectBadRequestCode(
      () => parseMerchantTransactionListQuery({ limit: '101' }),
      'TRANSACTION_LIST_FILTER_INVALID',
    );
    expect(parseMerchantTransactionListQuery({ limit: '100' }).limit).toBe(100);
  });

  it('28. uses deterministic ordering for equal timestamps', async () => {
    merchantQueries([row('102'), row('101')]);
    const result = await service.listMerchantTransactions(
      accountId,
      merchantQuery(),
    );
    expect(result.items.map((item) => item.transactionNumber)).toEqual([
      '102',
      '101',
    ]);
    expect(query.mock.calls[1]?.[0]).toContain(
      'ORDER BY transaction.confirmed_at DESC, transaction.transaction_number DESC',
    );
  });

  it('29. performs read-only SQL without mutating transaction or financial records', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ branchId }] })
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [{ branchId }] })
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValue({ rows: [] });
    await service.listMerchantTransactions(accountId, merchantQuery());
    await service.getMerchantTransaction(accountId, '101');
    for (const call of query.mock.calls) {
      const sql = String(call[0]);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE)\b/iu);
    }
  });

  function merchantQueries(rows: ReadRow[]): void {
    query
      .mockResolvedValueOnce({ rows: [{ branchId }] })
      .mockResolvedValueOnce({ rows });
  }

  function memberQueries(rows: ReadRow[]): void {
    query
      .mockResolvedValueOnce({ rows: [{ memberId }] })
      .mockResolvedValueOnce({ rows });
  }
});

function merchantQuery(overrides: Record<string, string> = {}) {
  return parseMerchantTransactionListQuery(overrides);
}

function memberQuery(overrides: Record<string, string> = {}) {
  return parseMemberTransactionListQuery(overrides);
}

function row(transactionNumber = '101'): ReadRow {
  return {
    transactionNumber,
    status: 'CONFIRMED',
    publicMerchantId: 'OF1234567890',
    merchantName: 'Safe Merchant Group',
    branchName: 'Safe Branch',
    protectedMemberReference: 'MEM********7890',
    memberDisplayName: 'Safe Member',
    marketCode: 'MY',
    currency: 'MYR',
    purchaseAmount: '100.0000000000',
    packageName: 'Package C',
    serviceFeeRate: '10.0000000000',
    serviceFeeAmount: '10.0000000000',
    rewardRate: '0.0500000000',
    dailyRewardAmount: '0.0500000000',
    rewardCap: '1000.0000000000',
    rewardStartBusinessDate: '2026-07-25',
    merchantReceiptNumber: `POS-${transactionNumber}`,
    transactionNote: 'Safe note',
    transactionTime: new Date(
      transactionNumber === '102'
        ? '2026-07-24T10:02:00.000Z'
        : '2026-07-24T10:01:00.000Z',
    ),
    mcpDeducted: '10.0000000000',
    mcpBalanceAfter: '490.0000000000',
  };
}

function errorWithCode(
  type:
    | typeof BadRequestException
    | typeof ForbiddenException
    | typeof NotFoundException,
  code: string,
) {
  return (error: unknown): boolean => {
    if (!(error instanceof type)) return false;
    const response = error.getResponse();
    return (
      typeof response === 'object' &&
      response !== null &&
      'code' in response &&
      response.code === code
    );
  };
}

function expectBadRequestCode(operation: () => unknown, code: string): void {
  try {
    operation();
  } catch (error) {
    expect(errorWithCode(BadRequestException, code)(error)).toBe(true);
    return;
  }
  throw new Error(`Expected BadRequestException with code ${code}.`);
}

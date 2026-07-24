import { BadRequestException, type ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  DatabaseService,
  isRetryableTransactionError,
} from '../../database/database.service.js';
import { safeErrorMetadata } from '../../common/logging/log-redaction.js';
import { transactionCorrectionRequestSchema } from '../transaction-correction.dto.js';
import { transactionPreviewReferenceSchema } from '../transaction.dto.js';
import {
  parseMerchantTransactionListQuery,
  parseMemberTransactionListQuery,
} from '../transaction-read.dto.js';
import { TRANSACTION_EXECUTION_OPTIONS } from '../transaction-reliability.js';
import { TransactionReadService } from '../transaction-read.service.js';
import { TransactionSecurityInterceptor } from '../transaction-security.interceptor.js';

describe('P4-S7 transaction hardening boundaries', () => {
  it('retries only serialization failures and deadlocks', () => {
    expect(isRetryableTransactionError({ code: '40001' })).toBe(true);
    expect(
      isRetryableTransactionError({
        cause: { cause: { code: '40P01' } },
      }),
    ).toBe(true);
    expect(isRetryableTransactionError({ code: '23505' })).toBe(false);
    expect(isRetryableTransactionError(new BadRequestException())).toBe(false);
    expect(TRANSACTION_EXECUTION_OPTIONS).toEqual({
      statementTimeoutMs: 10_000,
      lockTimeoutMs: 3_000,
      maxRetries: 2,
    });
  });

  it('applies local timeouts and bounds a deadlock retry to the write boundary', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const transaction = vi
      .fn()
      .mockRejectedValueOnce({ code: '40P01' })
      .mockImplementationOnce(
        (callback: (tx: { execute: typeof execute }) => unknown) =>
          Promise.resolve(callback({ execute })),
      );
    const database = Object.create(
      DatabaseService.prototype,
    ) as DatabaseService;
    Object.defineProperty(database, 'db', {
      value: { transaction },
    });
    const callback = vi.fn().mockResolvedValue('committed');

    await expect(
      database.runTransaction(callback, TRANSACTION_EXECUTION_OPTIONS),
    ).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not retry business or constraint failures', async () => {
    const transaction = vi.fn().mockRejectedValue({ code: '23505' });
    const database = Object.create(
      DatabaseService.prototype,
    ) as DatabaseService;
    Object.defineProperty(database, 'db', {
      value: { transaction },
    });

    await expect(
      database.runTransaction(vi.fn(), TRANSACTION_EXECUTION_OPTIONS),
    ).rejects.toMatchObject({ code: '23505' });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('returns only allowlisted metadata for database errors', () => {
    const error = Object.assign(
      new Error(
        'Failed query params: raw-token 999.99 11111111-1111-4111-8111-111111111111',
      ),
      { cause: { code: '40P01', detail: 'secret balance' } },
    );
    expect(safeErrorMetadata(error)).toEqual({
      errorName: 'Error',
      databaseCode: '40P01',
    });
    expect(JSON.stringify(safeErrorMetadata(error))).not.toContain('raw-token');
    expect(JSON.stringify(safeErrorMetadata(error))).not.toContain('999.99');
  });

  it('rejects oversized or tampered cursors before transaction query access', async () => {
    expect(() =>
      parseMerchantTransactionListQuery({ cursor: 'a'.repeat(513) }),
    ).toThrow(BadRequestException);
    const poolQuery = vi.fn().mockResolvedValueOnce({
      rows: [{ branchId: '11111111-1111-4111-8111-111111111111' }],
    });
    const service = new TransactionReadService({
      pool: { query: poolQuery },
    } as never);
    const query = parseMemberTransactionListQuery({
      cursor: Buffer.from('{"unexpected":true}', 'utf8').toString('base64url'),
    });
    await expect(
      service.listMerchantTransactions(
        '22222222-2222-4222-8222-222222222222',
        query,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed or oversized Preview workflow references', () => {
    expect(
      transactionPreviewReferenceSchema.safeParse('a'.repeat(129)).success,
    ).toBe(false);
    expect(
      transactionPreviewReferenceSchema.safeParse('not/base64url').success,
    ).toBe(false);
    expect(
      transactionPreviewReferenceSchema.safeParse(
        '11111111-1111-4111-8111-111111111111',
      ).success,
    ).toBe(true);
    expect(
      transactionPreviewReferenceSchema.safeParse('opaque_reference-123')
        .success,
    ).toBe(true);
  });

  it('rejects mass assignment and unsafe correction text', () => {
    expect(
      transactionCorrectionRequestSchema.safeParse({
        reasonCode: 'CUSTOMER_REQUEST',
        amount: '1.00',
      }).success,
    ).toBe(false);
    expect(
      transactionCorrectionRequestSchema.safeParse({
        reasonCode: 'customer request',
      }).success,
    ).toBe(false);
    expect(
      transactionCorrectionRequestSchema.safeParse({
        reasonCode: 'CUSTOMER_REQUEST',
        reasonNote: 'unsafe\u0000text',
      }).success,
    ).toBe(false);
  });

  it('sets no-store and browser hardening headers on transaction responses', () => {
    const setHeader = vi.fn();
    const context = {
      switchToHttp: () => ({
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;
    const interceptor = new TransactionSecurityInterceptor();

    interceptor.intercept(context, { handle: () => of({ ok: true }) });

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
  });
});

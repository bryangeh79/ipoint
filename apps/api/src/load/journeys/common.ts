/**
 * P8-S6 shared journey helpers: assertion recording, transaction
 * preview/confirm helpers and small payload builders shared by the 12
 * journey modules.
 *
 * @packageDocumentation
 */

import type { HttpCallResult, JourneyResult, LoadContext } from '../harness.js';
import { httpCall } from '../harness.js';

/** Extract the first string-valued field from a JSON body (no base-to-string). */
export function stringId(body: unknown, keys: readonly string[]): string {
  if (typeof body !== 'object' || body === null) return '';
  for (const key of keys) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

export function recordAssertion(
  result: JourneyResult,
  name: string,
  pass: boolean,
  detail: string,
): void {
  result.assertions.push({ name, pass, detail });
}

export function expectOk(
  result: JourneyResult,
  name: string,
  response: HttpCallResult,
  expectedStatuses: ReadonlySet<number>,
): void {
  const pass = expectedStatuses.has(response.status);
  recordAssertion(
    result,
    name,
    pass,
    pass
      ? `status ${response.status}`
      : `status ${response.status} (expected ${[...expectedStatuses].join('|')})`,
  );
}

export function errorCode(body: unknown): string | null {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as { error: { code?: unknown } }).error === 'object' &&
    (body as { error: { code?: unknown } }).error !== null
  ) {
    const code = (body as { error: { code?: unknown } }).error.code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export interface PreviewOptions {
  amount?: string;
  transactionNote?: string;
  idempotencyKey?: string;
}

/** Merchant preview with the world merchant fixture (201 expected). */
export function previewTransaction(
  ctx: LoadContext,
  options: PreviewOptions = {},
): Promise<HttpCallResult> {
  const world = ctx.world.merchant;
  return httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/merchant/transactions/preview',
    token: world.merchantToken,
    idempotencyKey: options.idempotencyKey,
    body: {
      amount: options.amount ?? '100.00',
      memberQrToken: world.qrToken,
      marketId: world.marketId,
      transactionNote: options.transactionNote ?? '',
    },
  });
}

export interface ConfirmOptions {
  merchantReceiptNumber?: string;
  idempotencyKey?: string;
}

export function confirmTransaction(
  ctx: LoadContext,
  previewSessionId: string,
  options: ConfirmOptions = {},
): Promise<HttpCallResult> {
  return httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/merchant/transactions/${previewSessionId}/confirm`,
    token: ctx.world.merchant.merchantToken,
    idempotencyKey: options.idempotencyKey,
    body: {
      merchantReceiptNumber:
        options.merchantReceiptNumber ?? `REC-${randomSuffix()}`,
    },
  });
}

export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** A future market-local effective date (2 days ahead, Kuala Lumpur = UTC+8). */
export function futureEffectiveDate(daysAhead = 2): string {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

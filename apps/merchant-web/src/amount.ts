/**
 * Exact-decimal display helpers for merchant-web.
 *
 * All monetary amounts in the API are exact decimal strings (e.g.
 * `'120.5000000000'`). They are NEVER converted to Number/parseFloat
 * for display. This module only trims trailing zeros (lossless) and
 * keeps the original string value otherwise. Mirrors the member-web
 * helper (`apps/member-web/src/utils/amount.ts`); no shared package
 * helper exists, so merchant-web keeps a small local copy.
 */

/**
 * Trim trailing zeros after the decimal separator for display only.
 * The result is still a string and the numeric value is unchanged.
 *
 * Examples:
 *   '120.5000000000' -> '120.5'
 *   '187.0000000000' -> '187'
 *   '-0.2500000000'  -> '-0.25'
 *   '0.0000000000'   -> '0'
 *   '42'             -> '42'
 */
export function trimAmount(value: string): string {
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}

/** Display money as `CURRENCY <exact trimmed amount>`. */
export function money(currency: string, amount: string): string {
  return `${currency} ${trimAmount(amount)}`;
}

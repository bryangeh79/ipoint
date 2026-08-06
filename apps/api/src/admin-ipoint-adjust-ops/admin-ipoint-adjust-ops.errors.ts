import { WalletAdjustmentOwnerError } from '../wallet/wallet-adjustment.owner.types.js';
import { walletAdjustmentRequestNotFoundError } from '../wallet/wallet-adjustment.owner.errors.js';

/**
 * P7-S7B Admin iPoint Adjustment Operations adapter error factories
 * (SEC-01 §6.4).
 *
 * The adapter reuses the FROZEN SEC-01 owner error space verbatim
 * (`WalletAdjustmentOwnerError` codes) so the HTTP boundary maps ONE
 * canonical code set — no error is swallowed into a 2xx. Read-projection
 * failures use the owner's `WALLET_ADJUSTMENT_REQUEST_NOT_FOUND` code; the
 * only adapter-native codes are `WALLET_ADJUSTMENT_MARKET_NOT_FOUND`
 * (market lookup) and `WALLET_ADJUSTMENT_WALLET_LOOKUP_EMPTY`
 * (maker-screen search miss, 404).
 *
 * No frozen owner file is modified: these are callers of the frozen
 * factories.
 */

/** The market row does not exist (adapter read projection lookup). */
export function ipointAdjustmentMarketNotFoundError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_MARKET_NOT_FOUND',
    'The market was not found.',
  );
}

/** The request row does not exist in the selected market (404). */
export function ipointAdjustmentRequestNotFoundError(): WalletAdjustmentOwnerError {
  return walletAdjustmentRequestNotFoundError();
}

/** The wallet lookup returned no matches in the selected market (404). */
export function ipointAdjustmentWalletLookupEmptyError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_WALLET_LOOKUP_EMPTY',
    'No wallet matched the search in this market.',
  );
}

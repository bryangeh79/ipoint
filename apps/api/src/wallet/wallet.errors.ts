import { WalletError } from './wallet.types.js';

export function walletNotFoundError(): WalletError {
  return new WalletError('WALLET_NOT_FOUND', 'Wallet not found.');
}

export function walletEntryNotFoundError(): WalletError {
  return new WalletError('WALLET_ENTRY_NOT_FOUND', 'Wallet entry not found.');
}

export function walletAlreadyExistsError(): WalletError {
  return new WalletError(
    'WALLET_ALREADY_EXISTS',
    'Wallet already exists for this member and market.',
  );
}

export function duplicateIdempotencyKeyError(): WalletError {
  return new WalletError(
    'DUPLICATE_IDEMPOTENCY_KEY',
    'An entry with this idempotency key already exists.',
  );
}

export function invalidEntryTypeError(): WalletError {
  return new WalletError('INVALID_ENTRY_TYPE', 'Invalid wallet entry type.');
}

export function invalidAmountError(): WalletError {
  return new WalletError('INVALID_AMOUNT', 'Amount must be positive.');
}

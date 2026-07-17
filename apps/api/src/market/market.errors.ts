import { MarketError } from './market.types.js';

export function marketNotFoundError(): MarketError {
  return new MarketError('MARKET_NOT_FOUND', 'Market not found.');
}
export function marketNotEnabledError(): MarketError {
  return new MarketError(
    'MARKET_NOT_ENABLED',
    'Market is not enabled for this member.',
  );
}
export function marketNotActiveError(): MarketError {
  return new MarketError('MARKET_NOT_ACTIVE', 'Market is not active.');
}

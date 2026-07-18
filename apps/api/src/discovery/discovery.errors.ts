import { MerchantDiscoveryError } from './discovery.types.js';

export function discoveryMarketNotConfiguredError(): MerchantDiscoveryError {
  return new MerchantDiscoveryError(
    'DISCOVERY_MARKET_NOT_CONFIGURED',
    'A current market is not configured for this member.',
  );
}

export function discoveryMarketDisabledError(): MerchantDiscoveryError {
  return new MerchantDiscoveryError(
    'DISCOVERY_MARKET_DISABLED',
    'The current market is disabled.',
  );
}

export function discoveryMerchantNotFoundError(): MerchantDiscoveryError {
  return new MerchantDiscoveryError(
    'DISCOVERY_MERCHANT_NOT_FOUND',
    'Merchant not found.',
  );
}

export function discoveryInvalidParameterError(
  message = 'One or more discovery parameters are invalid.',
): MerchantDiscoveryError {
  return new MerchantDiscoveryError('DISCOVERY_INVALID_PARAMETER', message);
}

export function discoveryRadiusTooLargeError(): MerchantDiscoveryError {
  return new MerchantDiscoveryError(
    'DISCOVERY_RADIUS_TOO_LARGE',
    'Radius must not exceed 50 kilometres.',
  );
}

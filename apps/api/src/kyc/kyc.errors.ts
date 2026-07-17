import { KycError } from './kyc.types.js';

export function kycNotFoundError(): KycError {
  return new KycError('KYC_NOT_FOUND', 'KYC case not found.');
}

export function kycInvalidStateError(
  currentStatus?: string,
  expectedStatus?: string,
): KycError {
  return new KycError(
    'KYC_INVALID_STATE',
    'The KYC case is not in a valid state for this operation.',
    currentStatus ? { currentStatus, expectedStatus } : undefined,
  );
}

export function kycMissingRequiredFieldsError(fields: string[]): KycError {
  return new KycError(
    'KYC_MISSING_REQUIRED_FIELDS',
    'Required KYC Level 2 fields or documents are missing.',
    { fields },
  );
}

export function kycIdentificationNumberInvalidError(): KycError {
  return new KycError(
    'KYC_IDENTIFICATION_NUMBER_INVALID',
    'The identification number format is invalid.',
  );
}

export function kycInvalidFileTypeError(): KycError {
  return new KycError(
    'KYC_INVALID_FILE_TYPE',
    'The document MIME type is not supported.',
  );
}

export function kycFileTooLargeError(): KycError {
  return new KycError(
    'KYC_FILE_TOO_LARGE',
    'The document exceeds the maximum allowed size.',
  );
}

export function kycDocumentLimitExceededError(): KycError {
  return new KycError(
    'KYC_DOCUMENT_LIMIT_EXCEEDED',
    'The KYC document limit has been exceeded.',
  );
}

export function kycDuplicateDocumentError(): KycError {
  return new KycError(
    'KYC_DUPLICATE_DOCUMENT',
    'A document with the same checksum already exists in this KYC case.',
  );
}

export function kycIdempotencyConflictError(): KycError {
  return new KycError(
    'KYC_IDEMPOTENCY_CONFLICT',
    'The idempotency key was already used with a different payload.',
  );
}

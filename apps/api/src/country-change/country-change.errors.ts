export type CountryChangeErrorCode =
  | 'COUNTRY_CHANGE_ALREADY_PENDING'
  | 'COUNTRY_CHANGE_NOT_FOUND'
  | 'COUNTRY_CHANGE_CANCEL_NOT_ALLOWED'
  | 'COUNTRY_CHANGE_COUNTRY_SAME'
  | 'COUNTRY_CHANGE_MEMBER_NOT_FOUND'
  | 'COUNTRY_CHANGE_INVALID_COUNTRY';

export class CountryChangeError extends Error {
  constructor(
    readonly code: CountryChangeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CountryChangeError';
  }
}

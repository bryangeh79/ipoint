import { ProfileError } from './profile.types.js';

export function profileNotFoundError(): ProfileError {
  return new ProfileError('PROFILE_NOT_FOUND', 'Profile not found.');
}
export function displayNameInvalidError(): ProfileError {
  return new ProfileError(
    'PROFILE_DISPLAY_NAME_INVALID',
    'Display name must be 2-50 chars, not pure whitespace.',
  );
}
export function phoneInvalidError(): ProfileError {
  return new ProfileError(
    'PROFILE_PHONE_INVALID',
    'Phone must be in E.164 format.',
  );
}
export function phoneDuplicateError(): ProfileError {
  return new ProfileError(
    'PROFILE_PHONE_DUPLICATE',
    'Phone number is already in use.',
  );
}
export function birthDateInvalidError(): ProfileError {
  return new ProfileError(
    'PROFILE_BIRTH_DATE_INVALID',
    'Birth date must be a valid date in the past.',
  );
}
export function ageVerificationFailedError(): ProfileError {
  return new ProfileError(
    'PROFILE_AGE_VERIFICATION_FAILED',
    'You must be at least 18 years old.',
  );
}
export function genderInvalidError(): ProfileError {
  return new ProfileError(
    'PROFILE_GENDER_INVALID',
    'Gender must be one of: male, female, prefer_not_to_say.',
  );
}

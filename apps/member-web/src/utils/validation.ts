/**
 * Basic validation utilities for form fields.
 */

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export function isMinLength(value: string, min: number): boolean {
  return value.length >= min;
}

export function isPhoneNumber(value: string): boolean {
  return /^\+?[\d\s()-]{7,20}$/.test(value.trim());
}

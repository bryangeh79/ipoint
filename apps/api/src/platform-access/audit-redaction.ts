const sensitiveKey =
  /(?:password|secret|token|authorization|cookie|credential|hash|(?:otp|verification|recovery)_?code)$/iu;

export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sensitiveKey.test(key) ? '[REDACTED]' : redactAuditValue(entry),
      ]),
    );
  }
  return value;
}

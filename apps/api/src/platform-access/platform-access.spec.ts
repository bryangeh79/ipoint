import { describe, expect, it } from 'vitest';
import { redactAuditValue } from './audit-redaction.js';
import { validateMarketInput } from './market.service.js';

describe('audit redaction', () => {
  it('redacts sensitive keys recursively while retaining business context', () => {
    expect(
      redactAuditValue({
        name: 'safe',
        password: 'never-store-this',
        nested: { refreshToken: 'secret', status: 'ACTIVE' },
        rows: [{ otpCode: '123456', id: 'safe-id' }],
      }),
    ).toEqual({
      name: 'safe',
      password: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', status: 'ACTIVE' },
      rows: [{ otpCode: '[REDACTED]', id: 'safe-id' }],
    });
  });
});

describe('market validation', () => {
  it('normalizes stable market and currency codes', () => {
    expect(
      validateMarketInput({
        code: 'my',
        name: 'Malaysia',
        currencyCode: 'myr',
        timezone: 'Asia/Kuala_Lumpur',
        defaultLocale: 'en-MY',
      }),
    ).toEqual({
      code: 'MY',
      name: 'Malaysia',
      currencyCode: 'MYR',
      timezone: 'Asia/Kuala_Lumpur',
      defaultLocale: 'en-MY',
    });
  });

  it('rejects invalid IANA timezone and locale values', () => {
    const valid = {
      code: 'MY',
      name: 'Malaysia',
      currencyCode: 'MYR',
      timezone: 'Asia/Kuala_Lumpur',
      defaultLocale: 'en-MY',
    };
    expect(() =>
      validateMarketInput({ ...valid, timezone: 'Not/A_Timezone' }),
    ).toThrow('Invalid IANA timezone');
    expect(() =>
      validateMarketInput({ ...valid, defaultLocale: 'invalid_locale!' }),
    ).toThrow('Invalid locale');
  });
});

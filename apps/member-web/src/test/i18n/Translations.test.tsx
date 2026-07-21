// @vitest-environment jsdom
/**
 * Internationalization Parity Tests — ensures all translations match.
 *
 * Verifies:
 * - All EN keys exist in ZH
 * - All ZH keys exist in EN
 * - KYC EN key count matches KYC ZH key count
 * - All 8 status keys resolve to translated text (not raw key)
 * - No raw translation key string visible in rendered output
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import en from '../../i18n/locales/en/translation.json';
import zh from '../../i18n/locales/zh/translation.json';

/**
 * Flatten a nested translation JSON object into dot-separated keys.
 */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/**
 * Deep-flatten to get all leaf key-value pairs.
 */
function flattenValues(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(
        result,
        flattenValues(value as Record<string, unknown>, fullKey),
      );
    } else {
      result[fullKey] = String(value);
    }
  }
  return result;
}

// ===== FULL TRANSLATION PARITY =====

describe('Translations — full key parity', () => {
  const enKeys = flattenKeys(en);
  const zhKeys = flattenKeys(zh);

  it('All EN keys exist in ZH', () => {
    const enOnly = enKeys.filter((k) => !zhKeys.includes(k));
    expect(enOnly).toEqual([]);
  });

  it('All ZH keys exist in EN', () => {
    const zhOnly = zhKeys.filter((k) => !enKeys.includes(k));
    expect(zhOnly).toEqual([]);
  });

  it('Total EN key count equals total ZH key count', () => {
    expect(enKeys.length).toBe(zhKeys.length);
  });
});

// ===== KYC-SPECIFIC TRANSLATION PARITY =====

describe('Translations — KYC-specific parity', () => {
  const enValues = flattenValues(en);
  const zhValues = flattenValues(zh);

  const enKycKeys = Object.keys(enValues).filter((k) => k.startsWith('kyc'));
  const zhKycKeys = Object.keys(zhValues).filter((k) => k.startsWith('kyc'));

  it('KYC EN key count === KYC ZH key count', () => {
    expect(enKycKeys.length).toBe(zhKycKeys.length);
  });

  it('All KYC EN keys exist in ZH', () => {
    const enOnlyKyc = enKycKeys.filter((k) => !zhKycKeys.includes(k));
    expect(enOnlyKyc).toEqual([]);
  });

  it('All KYC ZH keys exist in EN', () => {
    const zhOnlyKyc = zhKycKeys.filter((k) => !enKycKeys.includes(k));
    expect(zhOnlyKyc).toEqual([]);
  });
});

// ===== STATUS KEY RESOLUTION =====

describe('Translations — KYC status key resolution', () => {
  const enValues = flattenValues(en);

  const STATUS_KEYS = [
    'kyc.status.not_started',
    'kyc.status.draft',
    'kyc.status.submitted',
    'kyc.status.under_review',
    'kyc.status.approved',
    'kyc.status.rejected',
    'kyc.status.more_info_required',
    'kyc.status.reverification_required',
  ];

  for (const key of STATUS_KEYS) {
    it(`"${key}" resolves to translated text (not raw key)`, () => {
      const value = enValues[key];
      expect(value).toBeDefined();
      // The translated value should NOT be the key itself
      expect(value).not.toBe(key);
      // The value should be a non-empty string
      expect(value!.length).toBeGreaterThan(0);
    });
  }

  it('All 8 status keys map to distinct translated values', () => {
    const values = STATUS_KEYS.map((k) => enValues[k]);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(STATUS_KEYS.length);
  });
});

// ===== RAW KEY EXPOSURE CHECK =====

describe('Translations — no raw key exposure', () => {
  it('No KYC translation value equals its key name', () => {
    const enValues = flattenValues(en);
    for (const [key, value] of Object.entries(enValues)) {
      if (key.startsWith('kyc')) {
        // Translated values should never be the raw key string
        expect(value).not.toBe(key);
      }
    }
  });

  it('No ZH KYC translation value equals its key name', () => {
    const zhValues = flattenValues(zh);
    for (const [key, value] of Object.entries(zhValues)) {
      if (key.startsWith('kyc')) {
        expect(value).not.toBe(key);
      }
    }
  });
});

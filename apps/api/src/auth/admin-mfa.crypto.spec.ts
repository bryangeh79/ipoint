import { describe, expect, it } from 'vitest';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCode,
  normalizeRecoveryCode,
  totpCode,
  verifyTotp,
} from './admin-mfa.crypto.js';

describe('Admin MFA cryptography', () => {
  const rootSecret =
    'test-root-secret-that-is-longer-than-thirty-two-characters';
  const accountId = '00000000-0000-4000-a000-000000000001';
  const adminUserId = '00000000-0000-4000-a000-000000000002';
  const factorId = '00000000-0000-4000-a000-000000000003';

  it('encrypts TOTP secrets with AES-256-GCM and no plaintext storage', () => {
    const secret = Buffer.from('12345678901234567890', 'utf8');
    const encrypted = encryptTotpSecret(
      secret,
      rootSecret,
      accountId,
      adminUserId,
      factorId,
    );
    expect(encrypted.algorithm).toBe('AES-256-GCM');
    expect(JSON.stringify(encrypted)).not.toContain(secret.toString('utf8'));
    expect(
      decryptTotpSecret(
        encrypted,
        rootSecret,
        accountId,
        adminUserId,
        factorId,
      ),
    ).toEqual(secret);
  });

  it('binds ciphertext to the factor identity context', () => {
    const encrypted = encryptTotpSecret(
      Buffer.from('12345678901234567890', 'utf8'),
      rootSecret,
      accountId,
      adminUserId,
      factorId,
    );
    expect(() =>
      decryptTotpSecret(
        encrypted,
        rootSecret,
        accountId,
        adminUserId,
        '00000000-0000-4000-a000-000000000099',
      ),
    ).toThrow();
  });

  it('accepts the current TOTP counter', () => {
    const secret = Buffer.from('12345678901234567890', 'utf8');
    const now = new Date('2026-08-01T00:00:00.000Z');
    const counter = Math.floor(now.getTime() / 30_000);
    expect(verifyTotp(secret, totpCode(secret, counter), now, null)).toBe(
      counter,
    );
  });

  it('accepts only one adjacent TOTP window for clock skew', () => {
    const secret = Buffer.from('12345678901234567890', 'utf8');
    const now = new Date('2026-08-01T00:00:00.000Z');
    const counter = Math.floor(now.getTime() / 30_000);
    expect(verifyTotp(secret, totpCode(secret, counter - 1), now, null)).toBe(
      counter - 1,
    );
    expect(
      verifyTotp(secret, totpCode(secret, counter - 2), now, null),
    ).toBeNull();
  });

  it('rejects a replayed or older accepted TOTP counter', () => {
    const secret = Buffer.from('12345678901234567890', 'utf8');
    const now = new Date('2026-08-01T00:00:00.000Z');
    const counter = Math.floor(now.getTime() / 30_000);
    expect(
      verifyTotp(secret, totpCode(secret, counter), now, counter),
    ).toBeNull();
  });

  it('generates normalized recovery material without ambiguous characters', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{5}(?:-[A-Z2-9]{5}){3}$/u);
    expect(normalizeRecoveryCode(` ${code.toLowerCase()} `)).toHaveLength(20);
    expect(code).not.toMatch(/[01IO]/u);
  });
});

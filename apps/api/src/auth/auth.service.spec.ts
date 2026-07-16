import { describe, expect, it } from 'vitest';
import { PasswordHasher } from './password-hasher.js';
import { InMemoryRateLimiter } from './rate-limit.port.js';
import {
  createOpaqueToken,
  createOtpCode,
  hashOpaqueToken,
  hashOtpCode,
} from './secret-tokens.js';

describe('auth cryptographic primitives', () => {
  it('hashes passwords with a random salt and verifies in constant-time form', async () => {
    const hasher = new PasswordHasher();
    const password = 'correct horse battery staple';
    const first = await hasher.hash(password);
    const second = await hasher.hash(password);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    await expect(hasher.verify(password, first)).resolves.toBe(true);
    await expect(hasher.verify('wrong password', first)).resolves.toBe(false);
  });

  it('rejects weak passwords', async () => {
    const hasher = new PasswordHasher();
    await expect(hasher.hash('short')).rejects.toMatchObject({
      code: 'AUTH_PASSWORD_WEAK',
    });
  });

  it('creates high-entropy opaque tokens and hash-only storage values', () => {
    const token = createOpaqueToken();
    const hash = hashOpaqueToken(token);
    expect(token).not.toBe(hash);
    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('creates six-digit OTPs and binds their hash to id and pepper', () => {
    const code = createOtpCode();
    expect(code).toMatch(/^\d{6}$/u);
    expect(hashOtpCode('one', code, 'pepper')).not.toBe(
      hashOtpCode('two', code, 'pepper'),
    );
  });
});

describe('rate-limit port baseline', () => {
  it('denies requests after the configured bucket limit', async () => {
    const limiter = new InMemoryRateLimiter();
    await expect(limiter.consume('key', 2, 60)).resolves.toBe(true);
    await expect(limiter.consume('key', 2, 60)).resolves.toBe(true);
    await expect(limiter.consume('key', 2, 60)).resolves.toBe(false);
  });
});

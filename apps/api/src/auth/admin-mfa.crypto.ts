import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const recoveryAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface EncryptedTotpSecret {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyId: string;
  algorithm: 'AES-256-GCM';
}

function deriveMfaKey(rootSecret: string): Buffer {
  return createHmac('sha256', rootSecret)
    .update('ipoint/admin-mfa/aes-256-gcm/v1', 'utf8')
    .digest();
}

function encryptionContext(
  accountId: string,
  adminUserId: string,
  factorId: string,
): Buffer {
  return Buffer.from(
    `ipoint:admin-mfa:v1:${accountId}:${adminUserId}:${factorId}`,
    'utf8',
  );
}

export function encryptTotpSecret(
  secret: Buffer,
  rootSecret: string,
  accountId: string,
  adminUserId: string,
  factorId: string,
): EncryptedTotpSecret {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveMfaKey(rootSecret), nonce);
  cipher.setAAD(encryptionContext(accountId, adminUserId, factorId));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64url'),
    nonce: nonce.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    keyId: 'auth-otp-pepper:admin-mfa:v1',
    algorithm: 'AES-256-GCM',
  };
}

export function decryptTotpSecret(
  encrypted: Pick<EncryptedTotpSecret, 'ciphertext' | 'nonce' | 'authTag'>,
  rootSecret: string,
  accountId: string,
  adminUserId: string,
  factorId: string,
): Buffer {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveMfaKey(rootSecret),
    Buffer.from(encrypted.nonce, 'base64url'),
  );
  decipher.setAAD(encryptionContext(accountId, adminUserId, factorId));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
    decipher.final(),
  ]);
}

export function encodeBase32(value: Buffer): string {
  let bits = 0;
  let accumulator = 0;
  let result = '';
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += base32Alphabet[(accumulator >>> bits) & 31];
    }
  }
  if (bits > 0) result += base32Alphabet[(accumulator << (5 - bits)) & 31];
  return result;
}

export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

export function generateRecoveryCode(): string {
  const bytes = randomBytes(20);
  let value = '';
  for (const byte of bytes)
    value += recoveryAlphabet[byte % recoveryAlphabet.length];
  return `${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15)}`;
}

export function normalizeRecoveryCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, '');
}

export function totpCode(secret: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotp(
  secret: Buffer,
  code: string,
  now: Date,
  lastAcceptedCounter: number | null,
): number | null {
  if (!/^\d{6}$/u.test(code)) return null;
  const supplied = Buffer.from(code, 'utf8');
  const currentCounter = Math.floor(now.getTime() / 30_000);
  for (const offset of [-1, 0, 1]) {
    const counter = currentCounter + offset;
    if (lastAcceptedCounter !== null && counter <= lastAcceptedCounter)
      continue;
    const expected = Buffer.from(totpCode(secret, counter), 'utf8');
    if (timingSafeEqual(supplied, expected)) return counter;
  }
  return null;
}

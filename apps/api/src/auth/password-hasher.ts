import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { AuthError } from './auth.errors.js';

const keyLength = 64;
const scryptOptions = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, scryptOptions, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export class PasswordHasher {
  validate(password: string): void {
    if (password.length < 12 || password.length > 256) {
      throw new AuthError(
        'AUTH_PASSWORD_WEAK',
        'Password must contain between 12 and 256 characters.',
      );
    }
  }

  async hash(password: string): Promise<string> {
    this.validate(password);
    const salt = randomBytes(16);
    const derived = await deriveKey(password, salt);
    return `scrypt$v=1$N=16384,r=8,p=1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const parts = encoded.split('$');
    if (
      parts.length !== 5 ||
      parts[0] !== 'scrypt' ||
      parts[1] !== 'v=1' ||
      parts[2] !== 'N=16384,r=8,p=1'
    ) {
      return false;
    }
    const salt = Buffer.from(parts[3] ?? '', 'base64url');
    const expected = Buffer.from(parts[4] ?? '', 'base64url');
    if (salt.length !== 16 || expected.length !== keyLength) return false;
    const actual = await deriveKey(password, salt);
    return timingSafeEqual(actual, expected);
  }
}

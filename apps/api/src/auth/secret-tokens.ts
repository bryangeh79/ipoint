import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashOtpCode(
  otpId: string,
  code: string,
  pepper: string,
): string {
  return createHmac('sha256', pepper)
    .update(`${otpId}:${code}`, 'utf8')
    .digest('hex');
}

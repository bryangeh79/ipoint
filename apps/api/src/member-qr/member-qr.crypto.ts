/**
 * L-06 member QR signed display token (HMAC-SHA256).
 *
 * The member QR display token is a SHORT-LIVED, self-contained signed
 * payload (L-06 / D-14: "short-lived rotating signed security token").
 * Verification requires no database lookup - the HMAC recomputation plus
 * claim shape and expiry checks are sufficient. Status/expiry revocation
 * checks beyond the token's own expiry are applied by the caller at
 * verification time (the token never carries status).
 *
 * Claims are NON-SENSITIVE only: public_qr_id + issued/expiry + random
 * nonce. Never member internal ids, email, phone, or token secrets.
 *
 * Secret comes from the environment (`MEMBER_QR_SIGNING_SECRET`), never
 * hard-coded, resolved lazily at signing time (fail-closed: signing
 * without a configured secret refuses to produce a token). Follows the
 * REDEMPTION_VOUCHER_ENCRYPTION_KEY use-time-validation convention.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const MEMBER_QR_SIGNING_SECRET_ENV = 'MEMBER_QR_SIGNING_SECRET';
export const MEMBER_QR_TTL_SECONDS_ENV = 'MEMBER_QR_TTL_SECONDS';
export const MEMBER_QR_TOKEN_VERSION = 'v1';

export const MEMBER_QR_DEFAULT_TTL_SECONDS = 300;
const MIN_SIGNING_SECRET_LENGTH = 32;

/** Domain-separation context for the signing key derivation. */
const SIGNING_KEY_CONTEXT = 'ipoint/member-qr/signed-token/v1';

export interface MemberQrTokenClaims {
  public_qr_id: string;
  issued_at: string;
  expires_at: string;
  nonce: string;
}

/**
 * Resolve the signing secret from the environment. Throws a clear
 * configuration error when missing or too short (fail-closed).
 */
export function resolveMemberQrSigningSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  const secret = env[MEMBER_QR_SIGNING_SECRET_ENV] ?? '';
  if (secret.length < MIN_SIGNING_SECRET_LENGTH) {
    throw new Error(
      `${MEMBER_QR_SIGNING_SECRET_ENV} is required (at least ${MIN_SIGNING_SECRET_LENGTH} characters) to sign member QR tokens.`,
    );
  }
  return secret;
}

/** Resolve the signed-token lifetime in seconds (CONFIGURABLE via env). */
export function resolveMemberQrTtlSeconds(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[MEMBER_QR_TTL_SECONDS_ENV];
  if (raw === undefined || raw.trim() === '') {
    return MEMBER_QR_DEFAULT_TTL_SECONDS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 86_400) {
    throw new Error(
      `${MEMBER_QR_TTL_SECONDS_ENV} must be a positive integer between 1 and 86400 (received "${raw}").`,
    );
  }
  return parsed;
}

function deriveSigningKey(secret: string): Buffer {
  return createHmac('sha256', secret)
    .update(SIGNING_KEY_CONTEXT, 'utf8')
    .digest();
}

function encodeBase64Url(value: Buffer): string {
  return value.toString('base64url');
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    return Buffer.from(value, 'base64url');
  } catch {
    return null;
  }
}

function signPayload(payload: string, secret: string): string {
  const key = deriveSigningKey(secret);
  return encodeBase64Url(
    createHmac('sha256', key).update(payload, 'utf8').digest(),
  );
}

function claimsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => left[key] === right[key]);
}

/**
 * Sign a short-lived member QR display token.
 *
 * Format: `v1.<base64url(json claims)>.<base64url(hmac-sha256)>`.
 * The HMAC key is derived from `MEMBER_QR_SIGNING_SECRET` with a
 * domain-separation context; the raw secret is never embedded in the
 * token. Throws when the signing secret is not configured (fail-closed).
 */
export function signMemberQrToken(
  claims: MemberQrTokenClaims,
  secret?: string,
): string {
  const resolvedSecret = secret ?? resolveMemberQrSigningSecret();
  const payload = `${MEMBER_QR_TOKEN_VERSION}.${encodeBase64Url(
    Buffer.from(JSON.stringify(claims), 'utf8'),
  )}`;
  const signature = signPayload(payload, resolvedSecret);
  return `${payload}.${signature}`;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function parseClaims(raw: unknown): MemberQrTokenClaims | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record['public_qr_id'] !== 'string') return null;
  if (record['public_qr_id'].length === 0) return null;
  if (typeof record['nonce'] !== 'string' || record['nonce'].length === 0)
    return null;
  if (!isIsoDate(record['issued_at'])) return null;
  if (!isIsoDate(record['expires_at'])) return null;
  const issuedAt = Date.parse(record['issued_at']);
  const expiresAt = Date.parse(record['expires_at']);
  if (!(expiresAt > issuedAt)) return null;
  return {
    public_qr_id: record['public_qr_id'],
    issued_at: record['issued_at'],
    expires_at: record['expires_at'],
    nonce: record['nonce'],
  };
}

/**
 * Verify a member QR display token.
 *
 * Returns the claims when the signature is valid (recomputed HMAC,
 * constant-time compare), the version matches, the claim shape is valid
 * and the token has not expired. Returns null for any failure. No
 * database access - self-contained verification per L-06.
 */
export function verifyMemberQrToken(
  token: string,
  secret?: string,
  now: Date = new Date(),
): MemberQrTokenClaims | null {
  const resolvedSecret = secret ?? resolveMemberQrSigningSecret();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [version, encodedClaims, encodedSignature] = parts;
  if (!version || !encodedClaims || !encodedSignature) return null;
  if (version !== MEMBER_QR_TOKEN_VERSION) return null;

  const payload = `${version}.${encodedClaims}`;
  const expectedSignature = signPayload(payload, resolvedSecret);
  const expected = decodeBase64Url(expectedSignature);
  const supplied = decodeBase64Url(encodedSignature);
  if (!expected || !supplied || expected.length !== supplied.length) {
    return null;
  }
  if (!timingSafeEqual(expected, supplied)) return null;

  const decodedClaims = decodeBase64Url(encodedClaims);
  if (!decodedClaims) return null;
  let rawClaims: unknown;
  try {
    rawClaims = JSON.parse(decodedClaims.toString('utf8')) as unknown;
  } catch {
    return null;
  }
  const claims = parseClaims(rawClaims);
  if (!claims) return null;
  if (Date.parse(claims.expires_at) <= now.getTime()) return null;
  return claims;
}

/** Build the non-sensitive claims for a new QR identity. */
export function buildMemberQrTokenClaims(
  publicQrId: string,
  issuedAt: Date,
  expiresAt: Date,
): MemberQrTokenClaims {
  return {
    public_qr_id: publicQrId,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    nonce: randomBytes(12).toString('base64url'),
  };
}

/** Assert claims equality helper used by tests. */
export function memberQrClaimsEqual(
  left: MemberQrTokenClaims,
  right: MemberQrTokenClaims,
): boolean {
  return claimsEqual(
    left as unknown as Record<string, unknown>,
    right as unknown as Record<string, unknown>,
  );
}

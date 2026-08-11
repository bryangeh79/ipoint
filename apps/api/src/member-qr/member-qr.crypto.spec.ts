import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildMemberQrTokenClaims,
  MEMBER_QR_DEFAULT_TTL_SECONDS,
  MEMBER_QR_SIGNING_SECRET_ENV,
  MEMBER_QR_TTL_SECONDS_ENV,
  resolveMemberQrSigningSecret,
  resolveMemberQrTtlSeconds,
  signMemberQrToken,
  verifyMemberQrToken,
  type MemberQrTokenClaims,
} from './member-qr.crypto.js';

const SECRET = 'unit-test-signing-secret-at-least-32-characters';

function claims(
  issuedAt = new Date(),
  expiresAt = new Date(issuedAt.getTime() + 300_000),
): MemberQrTokenClaims {
  return buildMemberQrTokenClaims('qrv1_publicId123', issuedAt, expiresAt);
}

describe('P8-L06 member QR signed token (HMAC-SHA256)', () => {
  it('signs and verifies a short-lived display token round-trip', () => {
    const c = claims();
    const token = signMemberQrToken(c, SECRET);
    expect(token.split('.')).toHaveLength(3);
    expect(token.startsWith('v1.')).toBe(true);
    const verified = verifyMemberQrToken(token, SECRET);
    expect(verified).not.toBeNull();
    expect(verified?.public_qr_id).toBe('qrv1_publicId123');
    expect(verified?.issued_at).toBe(c.issued_at);
    expect(verified?.expires_at).toBe(c.expires_at);
    expect(verified?.nonce).toBeTruthy();
  });

  it('produces a different token per issuance (nonce + rotation)', () => {
    const first = signMemberQrToken(claims(), SECRET);
    const second = signMemberQrToken(claims(), SECRET);
    expect(first).not.toBe(second);
  });

  it('rejects a tampered payload', () => {
    const token = signMemberQrToken(claims(), SECRET);
    const parts = token.split('.');
    const tamperedClaims = Buffer.from(
      JSON.stringify({ ...claims(), public_qr_id: 'qrv1_evil' }),
      'utf8',
    ).toString('base64url');
    const tampered = `${parts[0]}.${tamperedClaims}.${parts[2]}`;
    expect(verifyMemberQrToken(tampered, SECRET)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signMemberQrToken(claims(), SECRET);
    expect(
      verifyMemberQrToken(token, 'another-secret-at-least-32-characters'),
    ).toBeNull();
  });

  it('rejects an expired token', () => {
    const now = new Date();
    const c = claims(now, new Date(now.getTime() + 300_000));
    const token = signMemberQrToken(c, SECRET);
    expect(
      verifyMemberQrToken(token, SECRET, new Date(now.getTime() + 301_000)),
    ).toBeNull();
    expect(
      verifyMemberQrToken(token, SECRET, new Date(now.getTime() + 299_000)),
    ).not.toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyMemberQrToken('', SECRET)).toBeNull();
    expect(verifyMemberQrToken('a.b', SECRET)).toBeNull();
    expect(verifyMemberQrToken('a.b.c.d', SECRET)).toBeNull();
    expect(verifyMemberQrToken('v2.payload.sig', SECRET)).toBeNull();
    expect(verifyMemberQrToken('v1.not-base64url!!.sig', SECRET)).toBeNull();
  });

  it('rejects invalid claim shapes', () => {
    const base = claims();
    const invalidClaims: unknown[] = [
      { ...base, nonce: '' },
      { ...base, public_qr_id: '' },
      { ...base, issued_at: 'not-a-date' },
      { ...base, expires_at: 'not-a-date' },
      {
        ...base,
        issued_at: '2026-08-11T00:05:00.000Z',
        expires_at: '2026-08-11T00:00:00.000Z',
      },
    ];
    for (const bad of invalidClaims) {
      const payload = `v1.${Buffer.from(JSON.stringify(bad), 'utf8').toString('base64url')}`;
      // Build a valid signature over the invalid payload so only the
      // claim-shape validation can reject it.
      const token = `${payload}.${fakeSignature(payload, SECRET)}`;
      expect(verifyMemberQrToken(token, SECRET)).toBeNull();
    }
  });

  it('resolves the signing secret from the environment (fail-closed)', () => {
    expect(
      resolveMemberQrSigningSecret({ [MEMBER_QR_SIGNING_SECRET_ENV]: SECRET }),
    ).toBe(SECRET);
    expect(() => resolveMemberQrSigningSecret({})).toThrow();
    expect(() =>
      resolveMemberQrSigningSecret({
        [MEMBER_QR_SIGNING_SECRET_ENV]: 'too-short',
      }),
    ).toThrow();
  });

  it('resolves the token TTL from the environment (CONFIGURABLE default)', () => {
    expect(resolveMemberQrTtlSeconds({})).toBe(MEMBER_QR_DEFAULT_TTL_SECONDS);
    expect(
      resolveMemberQrTtlSeconds({ [MEMBER_QR_TTL_SECONDS_ENV]: '600' }),
    ).toBe(600);
    expect(() =>
      resolveMemberQrTtlSeconds({ [MEMBER_QR_TTL_SECONDS_ENV]: '0' }),
    ).toThrow();
    expect(() =>
      resolveMemberQrTtlSeconds({ [MEMBER_QR_TTL_SECONDS_ENV]: 'abc' }),
    ).toThrow();
    expect(() =>
      resolveMemberQrTtlSeconds({ [MEMBER_QR_TTL_SECONDS_ENV]: '90000' }),
    ).toThrow();
  });
});

/**
 * Compute the same HMAC signature the implementation derives, so the
 * invalid-claims test exercises only the claim-shape validation.
 */
function fakeSignature(payload: string, secret: string): string {
  const key = createHmac('sha256', secret)
    .update('ipoint/member-qr/signed-token/v1', 'utf8')
    .digest();
  return createHmac('sha256', key).update(payload, 'utf8').digest('base64url');
}

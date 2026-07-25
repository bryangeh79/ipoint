/**
 * Referral Engine Domain Service — Unit Tests
 *
 * Covers REF-001 through REF-010 per Command Center acceptance criteria.
 *
 * @packageDocumentation
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ReferralService } from './referral.service.js';
import { ReferralError } from './referral.errors.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MEMBER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MEMBER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const MEMBER_D = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const CODE_A = 'CODEA001';
const CODE_B = 'CODEB002';
const BAD_CODE = 'BADCODE0';

/* ------------------------------------------------------------------ */
/*  Mock Builder                                                       */
/* ------------------------------------------------------------------ */

function createChain() {
  let _returnResult: unknown = [];
  const returningThenable = {
    then: vi
      .fn()
      .mockImplementation((resolve: (v: unknown) => void) =>
        resolve(_returnResult),
      ),
  };
  const chain = {
    _result: [] as unknown,
    _sequence: [] as unknown[][],
    _seqIdx: 0,

    then: vi.fn().mockImplementation(function (
      this: { _sequence: unknown[][]; _seqIdx: number; _result: unknown },
      resolve: (v: unknown) => void,
    ) {
      if (this._sequence.length > 0) {
        const idx = Math.min(this._seqIdx, this._sequence.length - 1);
        this._seqIdx++;
        return resolve(this._sequence[idx]);
      }
      return resolve(this._result);
    }),

    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    forUpdate: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnValue(returningThenable),

    setResult(r: unknown) {
      this._result = r;
      return this;
    },
    setSequence(seq: unknown[][]) {
      this._sequence = seq;
      this._seqIdx = 0;
      return this;
    },
    setReturnResult(r: unknown) {
      _returnResult = r;
      return this;
    },
  };
  return chain;
}

function createDbService(chain: ReturnType<typeof createChain>) {
  return {
    db: chain as never,
    pool: null as never,
    runTransaction: null as never,
    onApplicationShutdown: null as never,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ReferralService', () => {
  let chain: ReturnType<typeof createChain>;

  beforeEach(() => {
    chain = createChain().setResult([]);
  });

  function svc() {
    return new ReferralService(createDbService(chain));
  }

  /* ================================================================ */
  /*  REF-001                                                          */
  /* ================================================================ */
  describe('REF-001', () => {
    it('creates referral with correct referrer', async () => {
      chain
        .setSequence([[{ id: MEMBER_B, referralCode: CODE_A }], [], []])
        .setReturnResult([
          {
            id: 'r1',
            refereeId: MEMBER_A,
            referrerId: MEMBER_B,
            referralCodeSnapshot: CODE_A,
          },
        ]);

      const r = await svc().registerReferral(MEMBER_A, CODE_A);
      expect(r.refereeId).toBe(MEMBER_A);
      expect(r.referrerId).toBe(MEMBER_B);
      expect(r.referralCodeSnapshot).toBe(CODE_A);
    });
  });

  /* ================================================================ */
  /*  REF-002                                                          */
  /* ================================================================ */
  describe('REF-002', () => {
    it('getReferrer returns null', async () => {
      expect(await svc().getReferrer(MEMBER_A)).toBeNull();
    });
    it('hasReferrer returns false', async () => {
      expect(await svc().hasReferrer(MEMBER_A)).toBe(false);
    });
  });

  /* ================================================================ */
  /*  REF-003                                                          */
  /* ================================================================ */
  describe('REF-003', () => {
    it('throws REFERRAL_SELF_REFERENCE', async () => {
      chain.setResult([{ id: MEMBER_A, referralCode: CODE_A }]);
      await expect(
        svc().registerReferral(MEMBER_A, CODE_A),
      ).rejects.toMatchObject({
        code: 'REFERRAL_SELF_REFERENCE',
      });
    });
  });

  /* ================================================================ */
  /*  REF-004                                                          */
  /* ================================================================ */
  describe('REF-004', () => {
    it('throws REFERRAL_CYCLE_DETECTED', async () => {
      chain.setSequence([
        [{ id: MEMBER_A, referralCode: CODE_A }],
        [],
        [{ referrerMemberId: MEMBER_B }],
        [{ referrerMemberId: MEMBER_A }],
      ]);
      await expect(
        svc().registerReferral(MEMBER_C, CODE_A),
      ).rejects.toMatchObject({
        code: 'REFERRAL_CYCLE_DETECTED',
      });
    });
  });

  /* ================================================================ */
  /*  REF-005                                                          */
  /* ================================================================ */
  describe('REF-005', () => {
    it('detects deep cycle', async () => {
      chain.setSequence([
        [{ id: MEMBER_A, referralCode: CODE_A }],
        [],
        [{ referrerMemberId: MEMBER_C }],
        [{ referrerMemberId: MEMBER_B }],
        [{ referrerMemberId: MEMBER_A }],
      ]);
      await expect(
        svc().registerReferral(MEMBER_D, CODE_A),
      ).rejects.toMatchObject({
        code: 'REFERRAL_CYCLE_DETECTED',
      });
    });
  });

  /* ================================================================ */
  /*  REF-006                                                          */
  /* ================================================================ */
  describe('REF-006', () => {
    it('throws REFERRAL_CODE_NOT_FOUND', async () => {
      await expect(
        svc().registerReferral(MEMBER_A, BAD_CODE),
      ).rejects.toMatchObject({
        code: 'REFERRAL_CODE_NOT_FOUND',
      });
    });
  });

  /* ================================================================ */
  /*  REF-007                                                          */
  /* ================================================================ */
  describe('REF-007', () => {
    it('throws REFERRAL_ALREADY_EXISTS', async () => {
      chain.setSequence([
        [{ id: MEMBER_B, referralCode: CODE_B }],
        [{ id: 'existing-ref' }],
      ]);
      await expect(
        svc().registerReferral(MEMBER_A, CODE_B),
      ).rejects.toMatchObject({
        code: 'REFERRAL_ALREADY_EXISTS',
      });
    });
  });

  /* ================================================================ */
  /*  REF-008                                                          */
  /* ================================================================ */
  describe('REF-008', () => {
    it('empty tree returns zero G1 count', async () => {
      chain.setSequence([[{ referralCode: CODE_A }], []]);
      const t = await svc().getReferralTree(MEMBER_A);
      expect(t.myCode).toBe(CODE_A);
      expect(t.referrals.g1Count).toBe(0);
    });
  });

  /* ================================================================ */
  /*  REF-009                                                          */
  /* ================================================================ */
  describe('REF-009', () => {
    it('empty tree returns zero agents', async () => {
      chain.setSequence([[{ referralCode: CODE_A }], []]);
      const t = await svc().getReferralTree(MEMBER_A);
      expect(t.referrals.g1Agents).toBe(0);
    });
  });

  /* ================================================================ */
  /*  REF-010                                                          */
  /* ================================================================ */
  describe('REF-010', () => {
    it('returns referrer with masked ref and agent status', async () => {
      chain.setSequence([
        [{ referrerMemberId: MEMBER_B, referralCodeSnapshot: CODE_B }],
        [{ id: 'agent-id' }],
      ]);
      const r = await svc().getReferrer(MEMBER_A);
      expect(r).not.toBeNull();
      expect(r!.isAgent).toBe(true);
      expect(r!.maskedReference).toBeDefined();
    });
  });

  /* ================================================================ */
  /*  Immutability                                                     */
  /* ================================================================ */
  describe('immutability', () => {
    it('hasReferrer true after creation', async () => {
      chain.setResult([{ id: 'ref' }]);
      expect(await svc().hasReferrer(MEMBER_A)).toBe(true);
    });
    it('hasReferrer false before creation', async () => {
      expect(await svc().hasReferrer(MEMBER_A)).toBe(false);
    });
  });

  /* ================================================================ */
  /*  Anonymized tree                                                  */
  /* ================================================================ */
  describe('anonymized tree', () => {
    it('exposes counts not raw IDs', async () => {
      chain.setSequence([[{ referralCode: CODE_A }], []]);
      const t = await svc().getReferralTree(MEMBER_A);
      expect(t).toHaveProperty('referrals');
      expect(Object.keys(t.referrals)).not.toContain('memberIds');
    });
  });
});

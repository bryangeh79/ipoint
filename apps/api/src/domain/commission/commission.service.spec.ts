import { describe, it, expect } from 'vitest';

describe('CommissionQueryService', () => {
  describe('agent ledger', () => {
    it('returns own commissions only');
    it('rejects cross-member access');
    it('filters by market');
    it('filters by current_status');
    it('supports pagination (limit/offset)');
    it('returns amounts as decimal strings with trailing zeros');
    it('formats display scale = posting scale (2dp MYR/SGD)');
    it('detail endpoint validates ownership');
    it('summary endpoint aggregates per-market totals');
  });

  describe('admin search', () => {
    it('searches by beneficiary_id');
    it('searches by market');
    it('searches by source_type');
    it('searches by status');
    it('searches by date range');
    it('returns full entry details');
  });

  describe('audit query', () => {
    it('returns status event history for a ledger entry');
    it('events ordered by event_sequence');
    it('includes from_status, to_status, changed_by, changed_at');
  });
});

describe('CommissionAdjustmentService', () => {
  describe('create', () => {
    it('creates PENDING_CHECKER request');
    it('maker_id derived from auth principal');
    it('rejects zero amount');
    it('requires reason');
    it('supports positive adjustment');
    it('supports negative adjustment');
  });

  describe('approve', () => {
    it('transitions PENDING_CHECKER → APPROVED');
    it('creates ADMIN_ADJUSTMENT ledger entry');
    it('creates commission_status_event with EARNED');
    it('sets checker_id, decided_at, ledger_entry_id');
    it('rejects maker = checker');
    it('rejects duplicate approve');
    it('rejects approve after reject');
    it('atomic rollback on failure');
    it('status event created exactly once');
    it('ledger entry created exactly once');
  });

  describe('reject', () => {
    it('transitions PENDING_CHECKER → REJECTED');
    it('sets checker_id and decided_at');
    it('does NOT create ledger entry');
    it('rejects reject after approve');
    it('rejects duplicate reject');
  });

  describe('concurrency', () => {
    it('concurrent approve/reject produces one deterministic result');
    it('no partial state on concurrent access');
  });
});

describe('CommissionRateService', () => {
  describe('create', () => {
    it('creates new rate version with effective_from');
    it('supports optional effective_until');
    it('rejects overlapping effective period');
    it('accepts non-overlapping rate');
    it('validates commission_type');
    it('validates generation (0, 1, 2)');
    it('validates rate_type (PERCENTAGE, FIXED)');
    it('validates market format');
  });

  describe('immutability', () => {
    it('historical rate version cannot be updated');
    it('historical rate version cannot be deleted');
    it('new rate is prospective only');
    it('no recalculation of historical ledger entries');
  });

  describe('query', () => {
    it('returns active rates for market');
    it('returns rate history by type+generation+market');
    it('returns single rate by ID');
  });
});

describe('CommissionSecurity', () => {
  describe('principal enforcement', () => {
    it('member_id from auth principal, not request body');
    it('maker_id from auth principal, not request body');
    it('checker_id from auth principal, not request body');
    it('rejects spoofed member_id');
    it('rejects spoofed maker_id');
    it('rejects spoofed checker_id');
  });

  describe('authorization', () => {
    it('member cannot access another member’s commission');
    it('non-admin cannot create adjustments');
    it('non-admin cannot manage rates');
    it('maker cannot approve own adjustment');
    it('maker cannot reject own adjustment');
    it('admin can search all commissions');
  });

  describe('referral privacy', () => {
    it('referral tree anonymized (no raw member IDs)');
    it('agent sees referral counts only');
    it('admin sees full detail');
  });
});

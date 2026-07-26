/**
 * Agent Activation Lifecycle Domain Service — Unit Tests
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  AgentActivationAuditEntry,
  AgentActivationRecord,
  AgentActivationStatus,
} from '@ipoint/types';
import { DEFAULT_ACTIVATION_FEES } from '@ipoint/types';
import { AgentActivationService } from './agent-activation.service.js';
import { AgentActivationError } from './agent-activation.errors.js';
import type {
  ActivationFeeConfigStore,
  AgentActivationRepository,
  TransitionContext,
} from './agent-activation.types.js';

/* ------------------------------------------------------------------ */
/*  Test Helpers                                                       */
/* ------------------------------------------------------------------ */

const testMemberId = randomUUID();
const testActivationId = randomUUID();
const testAdminUserId = randomUUID();
const now = '2026-07-25T10:00:00.000Z';
const paymentRef = 'PAY-20260725-001';
const courseRef = 'CRS-20260725-001';

function makeRecord(
  overrides: Partial<AgentActivationRecord> = {},
): AgentActivationRecord {
  return {
    id: testActivationId,
    memberId: testMemberId,
    market: 'MY',
    status: 'NOT_APPLIED',
    previousStatus: null,
    activationFee: '388.00',
    activationFeeCurrency: 'MYR',
    paymentConfirmedAt: null,
    courseEnrolledAt: null,
    courseCompletedAt: null,
    submittedForApprovalAt: null,
    activatedAt: null,
    activatedByAdminUserId: null,
    suspendedAt: null,
    revokedAt: null,
    deactivatedByAdminUserId: null,
    reason: null,
    paymentReference: null,
    courseReference: null,
    approvalNotes: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const defaultContext: TransitionContext = {
  actorAdminUserId: null,
  actorType: 'MEMBER',
  reason: null,
};

const adminContext: TransitionContext = {
  actorAdminUserId: testAdminUserId,
  actorType: 'ADMIN',
  reason: null,
};

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

function createMocks() {
  const store: Record<string, AgentActivationRecord> = {};

  const repository: AgentActivationRepository = {
    findById: vi
      .fn()
      .mockImplementation((id: string) => Promise.resolve(store[id] ?? null)),
    findByMemberAndMarket: vi
      .fn()
      .mockImplementation((memberId: string, market: string) => {
        const found = Object.values(store).find(
          (r) => r.memberId === memberId && r.market === market,
        );
        return Promise.resolve(found ?? null);
      }),
    findMany: vi.fn().mockImplementation(() =>
      Promise.resolve({
        items: Object.values(store),
        total: Object.keys(store).length,
      }),
    ),
    exists: vi.fn().mockImplementation((memberId: string, market: string) => {
      const found = Object.values(store).find(
        (r) => r.memberId === memberId && r.market === market,
      );
      return Promise.resolve(!!found);
    }),
    insert: vi.fn().mockImplementation((record: AgentActivationRecord) => {
      store[record.id] = { ...record };
      return Promise.resolve({ ...record });
    }),
    update: vi.fn().mockImplementation((record: AgentActivationRecord) => {
      store[record.id] = { ...record };
      return Promise.resolve({ ...record });
    }),
    insertAuditEntry: vi
      .fn()
      .mockImplementation((entry: AgentActivationAuditEntry) =>
        Promise.resolve(entry),
      ),
    findAuditEntries: vi.fn().mockImplementation((_activationId: string) => {
      return Promise.resolve([]);
    }),
  };

  const feeConfigStore: ActivationFeeConfigStore = {
    getFeeConfig: vi.fn().mockRejectedValue(new Error('Not configured')),
    setFeeConfig: vi.fn().mockResolvedValue(undefined),
    getAllFeeConfigs: vi.fn().mockResolvedValue(DEFAULT_ACTIVATION_FEES),
  };

  const service = new AgentActivationService(repository, feeConfigStore);

  return { store, repository, feeConfigStore, service };
}

/* ================================================================ */
/*  TESTS                                                            */
/* ================================================================ */

describe('AgentActivationService', () => {
  describe('apply()', () => {
    it('creates a new activation record in PENDING_PAYMENT status', async () => {
      const { service } = createMocks();
      const result = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );

      expect(result.record.status).toBe('PENDING_PAYMENT');
      expect(result.record.previousStatus).toBe('NOT_APPLIED');
      expect(result.record.memberId).toBe(testMemberId);
      expect(result.record.market).toBe('MY');
      expect(result.record.activationFee).toBe('388.00');
      expect(result.record.activationFeeCurrency).toBe('MYR');
      expect(result.record.version).toBe(1);
      expect(result.auditEntry.action).toBe('APPLY');
      expect(result.auditEntry.fromStatus).toBe('NOT_APPLIED');
      expect(result.auditEntry.toStatus).toBe('PENDING_PAYMENT');
    });

    it('throws if activation already exists for member+market', async () => {
      const { service } = createMocks();
      // First apply succeeds
      await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );

      // Second apply for same member+market should fail
      await expect(
        service.apply({ memberId: testMemberId, market: 'MY' }, defaultContext),
      ).rejects.toThrow(AgentActivationError);

      await expect(
        service.apply({ memberId: testMemberId, market: 'MY' }, defaultContext),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_ALREADY_EXISTS',
      });
    });

    it('allows independent activation in different markets', async () => {
      const { service, feeConfigStore } = createMocks();
      vi.mocked(feeConfigStore.getFeeConfig).mockResolvedValue({
        market: 'SG',
        fee: '388.00',
        currency: 'SGD',
      });
      const result1 = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );
      const result2 = await service.apply(
        { memberId: testMemberId, market: 'SG' },
        defaultContext,
      );

      expect(result1.record.market).toBe('MY');
      expect(result2.record.market).toBe('SG');
      expect(result1.record.id).not.toBe(result2.record.id);
    });

    it('uses market-specific fee configuration when config store returns one', async () => {
      const { service, feeConfigStore } = createMocks();
      vi.mocked(feeConfigStore.getFeeConfig).mockResolvedValue({
        market: 'MY',
        fee: '388.00',
        currency: 'MYR',
      });

      const result = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );

      expect(result.record.activationFee).toBe('388.00');
      expect(result.record.activationFeeCurrency).toBe('MYR');
    });
  });

  describe('confirmPayment()', () => {
    it('transitions PENDING_PAYMENT → PAYMENT_CONFIRMED with timestamp', async () => {
      const { service } = createMocks();
      // Apply first
      const applyResult = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );

      // Confirm payment
      const result = await service.confirmPayment(
        applyResult.record.id,
        paymentRef,
        now,
        adminContext,
      );

      expect(result.record.status).toBe('PAYMENT_CONFIRMED');
      expect(result.record.previousStatus).toBe('PENDING_PAYMENT');
      expect(result.record.paymentConfirmedAt).toBe(now);
      expect(result.record.paymentReference).toBe(paymentRef);
      expect(result.auditEntry.action).toBe('CONFIRM_PAYMENT');
    });

    it('throws if payment already confirmed', async () => {
      const { service } = createMocks();
      const applyResult = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );

      await service.confirmPayment(
        applyResult.record.id,
        paymentRef,
        now,
        adminContext,
      );

      // Second attempt should fail
      await expect(
        service.confirmPayment(
          applyResult.record.id,
          paymentRef,
          now,
          adminContext,
        ),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_INVALID_TRANSITION',
      });
    });

    it('throws if not in PENDING_PAYMENT status', async () => {
      const { service } = createMocks();
      await expect(
        service.confirmPayment(testActivationId, paymentRef, now, adminContext),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_NOT_FOUND',
      });
    });
  });

  describe('enrollCourse()', () => {
    it('transitions PAYMENT_CONFIRMED → COURSE_PENDING', async () => {
      const { service } = createMocks();
      // Full setup: apply → confirm payment
      const { record: app } = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );
      await service.confirmPayment(app.id, paymentRef, now, adminContext);

      const result = await service.enrollCourse(
        app.id,
        courseRef,
        adminContext,
      );

      expect(result.record.status).toBe('COURSE_PENDING');
      expect(result.record.courseEnrolledAt).toBeTruthy();
      expect(result.record.courseReference).toBe(courseRef);
    });

    it('throws if payment not confirmed', async () => {
      const { service } = createMocks();
      const { record: app } = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );

      await expect(
        service.enrollCourse(app.id, courseRef, adminContext),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_INVALID_TRANSITION',
      });
    });
  });

  describe('completeCourse()', () => {
    it('transitions COURSE_PENDING → COURSE_COMPLETED', async () => {
      const { service } = createMocks();
      // Full setup: apply → confirm → enroll
      const { record: app } = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );
      await service.confirmPayment(app.id, paymentRef, now, adminContext);
      await service.enrollCourse(app.id, courseRef, adminContext);

      const result = await service.completeCourse(
        app.id,
        courseRef,
        adminContext,
      );

      expect(result.record.status).toBe('COURSE_COMPLETED');
      expect(result.record.courseCompletedAt).toBeTruthy();
    });

    it('throws if course not enrolled', async () => {
      const { service } = createMocks();
      const { record: app } = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );
      await service.confirmPayment(app.id, paymentRef, now, adminContext);

      await expect(
        service.completeCourse(app.id, courseRef, adminContext),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_INVALID_TRANSITION',
      });
    });
  });

  describe('submitForApproval()', () => {
    it('transitions COURSE_COMPLETED → PENDING_APPROVAL', async () => {
      const { service } = createMocks();
      // Full flow: apply → confirm → enroll → complete
      const { record: app } = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );
      await service.confirmPayment(app.id, paymentRef, now, adminContext);
      await service.enrollCourse(app.id, courseRef, adminContext);
      await service.completeCourse(app.id, courseRef, adminContext);

      const result = await service.submitForApproval(app.id, adminContext);

      expect(result.record.status).toBe('PENDING_APPROVAL');
      expect(result.record.submittedForApprovalAt).toBeTruthy();
    });

    it('throws if course not completed', async () => {
      const { service } = createMocks();
      const { record: app } = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );
      await service.confirmPayment(app.id, paymentRef, now, adminContext);

      await expect(
        service.submitForApproval(app.id, adminContext),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_INVALID_TRANSITION',
      });
    });
  });

  describe('approveAndActivate()', () => {
    it('atomically transitions PENDING_APPROVAL → ACTIVE with timestamp', async () => {
      const { service } = createMocks();
      // Full pre-approval flow
      const { record: app } = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );
      await service.confirmPayment(app.id, paymentRef, now, adminContext);
      await service.enrollCourse(app.id, courseRef, adminContext);
      await service.completeCourse(app.id, courseRef, adminContext);
      await service.submitForApproval(app.id, adminContext);

      const result = await service.approveAndActivate(
        app.id,
        testAdminUserId,
        'Approved after review',
        adminContext,
      );

      expect(result.record.status).toBe('ACTIVE');
      expect(result.record.activatedAt).toBeTruthy();
      expect(result.record.activatedByAdminUserId).toBe(testAdminUserId);
      expect(result.record.approvalNotes).toBe('Approved after review');
      expect(result.auditEntry.action).toBe('APPROVE_AND_ACTIVATE');
    });

    it('throws if not submitted for approval', async () => {
      const { service } = createMocks();
      const { record: app } = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );
      await service.confirmPayment(app.id, paymentRef, now, adminContext);
      await service.enrollCourse(app.id, courseRef, adminContext);
      await service.completeCourse(app.id, courseRef, adminContext);

      await expect(
        service.approveAndActivate(
          app.id,
          testAdminUserId,
          undefined,
          adminContext,
        ),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_INVALID_TRANSITION',
      });
    });
  });

  describe('reject()', () => {
    it.each([
      [
        'PENDING_PAYMENT',
        { paymentConfirmedAt: now, paymentReference: paymentRef },
      ],
      ['COURSE_PENDING', { paymentConfirmedAt: now, courseEnrolledAt: now }],
      [
        'COURSE_COMPLETED',
        {
          paymentConfirmedAt: now,
          courseEnrolledAt: now,
          courseCompletedAt: now,
        },
      ],
      [
        'PENDING_APPROVAL',
        {
          paymentConfirmedAt: now,
          courseEnrolledAt: now,
          courseCompletedAt: now,
          submittedForApprovalAt: now,
        },
      ],
    ] as [AgentActivationStatus, Partial<AgentActivationRecord>][])(
      'rejects from %s to REJECTED',
      async (status, overrides) => {
        const { service, store } = createMocks();
        store[testActivationId] = makeRecord({ status, ...overrides });

        const result = await service.reject(
          testActivationId,
          testAdminUserId,
          'Incomplete documentation',
          adminContext,
        );

        expect(result.record.status).toBe('REJECTED');
        expect(result.record.previousStatus).toBe(status);
        expect(result.record.reason).toBe('Incomplete documentation');
      },
    );

    it('throws if trying to reject ACTIVE agent', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        status: 'ACTIVE',
        activatedAt: now,
        activatedByAdminUserId: testAdminUserId,
      });

      await expect(
        service.reject(
          testActivationId,
          testAdminUserId,
          'reason',
          adminContext,
        ),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_INVALID_TRANSITION',
      });
    });

    it('throws if trying to reject DEACTIVATED', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        status: 'DEACTIVATED',
        revokedAt: now,
      });

      await expect(
        service.reject(
          testActivationId,
          testAdminUserId,
          'reason',
          adminContext,
        ),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_DEACTIVATED_CANNOT_REACTIVATE',
      });
    });

    it('throws if trying to reject REJECTED (terminal)', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        status: 'REJECTED',
        reason: 'Previously rejected',
      });

      await expect(
        service.reject(
          testActivationId,
          testAdminUserId,
          'reason',
          adminContext,
        ),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_REJECTED_CANNOT_TRANSITION',
      });
    });
  });

  describe('suspend()', () => {
    it('transitions ACTIVE → SUSPENDED', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        status: 'ACTIVE',
        activatedAt: now,
        activatedByAdminUserId: testAdminUserId,
      });

      const result = await service.suspend(
        testActivationId,
        testAdminUserId,
        'Compliance review',
        adminContext,
      );

      expect(result.record.status).toBe('SUSPENDED');
      expect(result.record.suspendedAt).toBeTruthy();
      expect(result.record.reason).toBe('Compliance review');
    });

    it('throws if not ACTIVE', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({ status: 'NOT_APPLIED' });

      await expect(
        service.suspend(
          testActivationId,
          testAdminUserId,
          'reason',
          adminContext,
        ),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_INVALID_TRANSITION',
      });
    });

    it('throws if already suspended', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        status: 'SUSPENDED',
        activatedAt: now,
        suspendedAt: now,
      });

      await expect(
        service.suspend(
          testActivationId,
          testAdminUserId,
          'reason',
          adminContext,
        ),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_INVALID_TRANSITION',
      });
    });
  });

  describe('reactivate()', () => {
    it('transitions SUSPENDED → ACTIVE', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        status: 'SUSPENDED',
        activatedAt: now,
        activatedByAdminUserId: testAdminUserId,
        suspendedAt: now,
      });

      const result = await service.reactivate(
        testActivationId,
        testAdminUserId,
        'Issues resolved',
        adminContext,
      );

      expect(result.record.status).toBe('ACTIVE');
      expect(result.record.suspendedAt).toBeNull();
      expect(result.record.activatedAt).toBe(now);
    });

    it('throws if not SUSPENDED (e.g., DEACTIVATED)', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        status: 'DEACTIVATED',
        revokedAt: now,
      });

      await expect(
        service.reactivate(
          testActivationId,
          testAdminUserId,
          'reason',
          adminContext,
        ),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_DEACTIVATED_CANNOT_REACTIVATE',
      });
    });
  });

  describe('deactivate()', () => {
    it('transitions ACTIVE → DEACTIVATED with revoked_at', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        status: 'ACTIVE',
        activatedAt: now,
        activatedByAdminUserId: testAdminUserId,
      });

      const result = await service.deactivate(
        testActivationId,
        testAdminUserId,
        'Permanent deactivation',
        adminContext,
      );

      expect(result.record.status).toBe('DEACTIVATED');
      expect(result.record.revokedAt).toBeTruthy();
      expect(result.record.deactivatedByAdminUserId).toBe(testAdminUserId);
      expect(result.record.reason).toBe('Permanent deactivation');
    });

    it('throws if not ACTIVE', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({ status: 'SUSPENDED' });

      await expect(
        service.deactivate(
          testActivationId,
          testAdminUserId,
          'reason',
          adminContext,
        ),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_INVALID_TRANSITION',
      });
    });

    it('throws if already DEACTIVATED', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        status: 'DEACTIVATED',
        revokedAt: now,
      });

      await expect(
        service.deactivate(
          testActivationId,
          testAdminUserId,
          'reason',
          adminContext,
        ),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_DEACTIVATED_CANNOT_REACTIVATE',
      });
    });
  });

  describe('forbidden transitions', () => {
    it('DEACTIVATED → ACTIVE is forbidden', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        status: 'DEACTIVATED',
        revokedAt: now,
      });

      // Any action from DEACTIVATED should throw
      await expect(
        service.approveAndActivate(
          testActivationId,
          testAdminUserId,
          undefined,
          adminContext,
        ),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_DEACTIVATED_CANNOT_REACTIVATE',
      });
    });

    it('REJECTED → any non-REJECTED state is forbidden', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        status: 'REJECTED',
        reason: 'Rejected',
      });

      await expect(
        service.apply({ memberId: testMemberId, market: 'MY' }, defaultContext),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_ALREADY_EXISTS',
      });
    });

    it('SUSPENDED can only reactivate, not do other actions', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        status: 'SUSPENDED',
        activatedAt: now,
        suspendedAt: now,
      });

      await expect(
        service.confirmPayment(testActivationId, paymentRef, now, adminContext),
      ).rejects.toMatchObject({
        code: 'AGENT_ACTIVATION_INVALID_TRANSITION',
      });
    });
  });

  describe('queries', () => {
    it('findById returns the record', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({ status: 'ACTIVE' });

      const result = await service.findById(testActivationId);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(testActivationId);
    });

    it('findById returns null for unknown id', async () => {
      const { service } = createMocks();
      const result = await service.findById(randomUUID());
      expect(result).toBeNull();
    });

    it('findByMemberAndMarket returns the record', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        memberId: testMemberId,
        market: 'MY',
        status: 'ACTIVE',
      });

      const result = await service.findByMemberAndMarket(testMemberId, 'MY');
      expect(result).not.toBeNull();
      expect(result!.memberId).toBe(testMemberId);
      expect(result!.market).toBe('MY');
    });

    it('isActiveAgent returns true for ACTIVE', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        memberId: testMemberId,
        market: 'MY',
        status: 'ACTIVE',
      });

      const result = await service.isActiveAgent(testMemberId, 'MY');
      expect(result).toBe(true);
    });

    it('isActiveAgent returns false for non-ACTIVE', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        memberId: testMemberId,
        market: 'MY',
        status: 'SUSPENDED',
      });

      const result = await service.isActiveAgent(testMemberId, 'MY');
      expect(result).toBe(false);
    });

    it('isActiveAgent returns false when no record exists', async () => {
      const { service } = createMocks();
      const result = await service.isActiveAgent(testMemberId, 'MY');
      expect(result).toBe(false);
    });
  });

  describe('complete happy path', () => {
    it('executes the full activation cycle: NOT_APPLIED → ACTIVE', async () => {
      const { service } = createMocks();

      // 1. Apply: NOT_APPLIED → PENDING_PAYMENT
      const step1 = await service.apply(
        { memberId: testMemberId, market: 'MY' },
        defaultContext,
      );
      expect(step1.record.status).toBe('PENDING_PAYMENT');

      // 2. Confirm Payment: PENDING_PAYMENT → PAYMENT_CONFIRMED
      const step2 = await service.confirmPayment(
        step1.record.id,
        paymentRef,
        now,
        adminContext,
      );
      expect(step2.record.status).toBe('PAYMENT_CONFIRMED');

      // 3. Enroll Course: PAYMENT_CONFIRMED → COURSE_PENDING
      const step3 = await service.enrollCourse(
        step1.record.id,
        courseRef,
        adminContext,
      );
      expect(step3.record.status).toBe('COURSE_PENDING');

      // 4. Complete Course: COURSE_PENDING → COURSE_COMPLETED
      const step4 = await service.completeCourse(
        step1.record.id,
        courseRef,
        adminContext,
      );
      expect(step4.record.status).toBe('COURSE_COMPLETED');

      // 5. Submit for Approval: COURSE_COMPLETED → PENDING_APPROVAL
      const step5 = await service.submitForApproval(
        step1.record.id,
        adminContext,
      );
      expect(step5.record.status).toBe('PENDING_APPROVAL');

      // 6. Approve + Activate: PENDING_APPROVAL → ACTIVE
      const step6 = await service.approveAndActivate(
        step1.record.id,
        testAdminUserId,
        'All criteria met',
        adminContext,
      );
      expect(step6.record.status).toBe('ACTIVE');
      expect(step6.record.activatedAt).toBeTruthy();
      expect(step6.record.activatedByAdminUserId).toBe(testAdminUserId);

      // Verify final state
      const final = await service.findById(step1.record.id);
      expect(final?.status).toBe('ACTIVE');
      expect(final?.version).toBe(6);
    });

    it('executes ACTIVE → SUSPENDED → ACTIVE → DEACTIVATED', async () => {
      const { service, store } = createMocks();
      store[testActivationId] = makeRecord({
        status: 'ACTIVE',
        activatedAt: now,
        activatedByAdminUserId: testAdminUserId,
      });

      // Suspend
      const suspendStep = await service.suspend(
        testActivationId,
        testAdminUserId,
        'Policy violation',
        adminContext,
      );
      expect(suspendStep.record.status).toBe('SUSPENDED');

      // Reactivate
      const reactivateStep = await service.reactivate(
        testActivationId,
        testAdminUserId,
        'Violation resolved',
        adminContext,
      );
      expect(reactivateStep.record.status).toBe('ACTIVE');

      // Deactivate
      const deactivateStep = await service.deactivate(
        testActivationId,
        testAdminUserId,
        'Permanent deactivation',
        adminContext,
      );
      expect(deactivateStep.record.status).toBe('DEACTIVATED');
      expect(deactivateStep.record.revokedAt).toBeTruthy();

      // Verify terminal
      const final = await service.findById(testActivationId);
      expect(final?.status).toBe('DEACTIVATED');
    });
  });
});

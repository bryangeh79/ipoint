import { ApiError } from '@ipoint/api-client';
import { describe, expect, it } from 'vitest';
import {
  agentCapabilityLabel,
  agentStatusLabel,
  describeAgentActionError,
  describeAgentReadError,
  formatAgentUtc,
} from './agent-ops-model.js';

describe('P7-S8 agent ops model', () => {
  it('maps every agent lifecycle status to a label', () => {
    expect(agentStatusLabel('ACTIVE')).toBe('Active');
    expect(agentStatusLabel('SUSPENDED')).toBe('Suspended');
    expect(agentStatusLabel('DEACTIVATED')).toBe('Deactivated');
    expect(agentStatusLabel('PENDING_APPROVAL')).toBe('Pending approval');
    // Unknown statuses render as-is (never invented).
    expect(agentStatusLabel('BOGUS')).toBe('BOGUS');
  });

  it('labels the explicit capability states without fallback', () => {
    expect(agentCapabilityLabel('CONFIGURED')).toBe(
      'Agent activation configured',
    );
    expect(agentCapabilityLabel('AGENT_FEE_NOT_CONFIGURED')).toBe(
      'Agent activation not configured',
    );
  });

  it('maps read errors to design-system state copy', () => {
    expect(
      describeAgentReadError(new ApiError(403, { code: 'PERMISSION_DENIED' }))
        .kind,
    ).toBe('permission-denied');
    expect(
      describeAgentReadError(
        new ApiError(409, { code: 'MARKET_CONTEXT_MISMATCH' }),
      ).kind,
    ).toBe('conflict');
    expect(describeAgentReadError(new Error('boom')).kind).toBe('error');
  });

  it('maps action errors including the capability-blocked state', () => {
    const blocked = describeAgentActionError(
      new ApiError(422, { code: 'AGENT_FEE_NOT_CONFIGURED' }),
    );
    expect(blocked.kind).toBe('blocked-prerequisite');
    expect(blocked.blockedPrerequisite).toBe('AGENT_FEE_NOT_CONFIGURED');

    const conflict = describeAgentActionError(
      new ApiError(409, { code: 'AGENT_INVALID_TRANSITION' }),
    );
    expect(conflict.kind).toBe('conflict');

    const denied = describeAgentActionError(
      new ApiError(403, { code: 'PERMISSION_DENIED' }),
    );
    expect(denied.kind).toBe('permission-denied');
  });

  it('renders UTC timestamps without re-deriving them', () => {
    expect(formatAgentUtc('2026-08-01T00:00:00.000Z')).toBe(
      '2026-08-01T00:00:00.000Z',
    );
    expect(formatAgentUtc(null)).toBe('—');
  });
});

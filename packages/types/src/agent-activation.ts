export const AGENT_ACTIVATION_STATUS = [
  'NOT_APPLIED', 'PENDING_PAYMENT', 'PAYMENT_CONFIRMED',
  'COURSE_PENDING', 'COURSE_COMPLETED', 'PENDING_APPROVAL',
  'ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'REJECTED',
] as const;

export type AgentActivationStatus = typeof AGENT_ACTIVATION_STATUS[number];

export const AGENT_ACTIVATION_ACTIONS = [
  'APPLY', 'CONFIRM_PAYMENT', 'ENROLL_COURSE', 'COMPLETE_COURSE',
  'SUBMIT_FOR_APPROVAL', 'APPROVE_AND_ACTIVATE', 'REJECT',
  'SUSPEND', 'REACTIVATE', 'DEACTIVATE',
] as const;

export type AgentActivationAction = typeof AGENT_ACTIVATION_ACTIONS[number];

export const ALLOWED_TRANSITIONS: Record<AgentActivationStatus, AgentActivationStatus[]> = {
  NOT_APPLIED: ['PENDING_PAYMENT'],
  PENDING_PAYMENT: ['PAYMENT_CONFIRMED', 'REJECTED'],
  PAYMENT_CONFIRMED: ['COURSE_PENDING', 'REJECTED'],
  COURSE_PENDING: ['COURSE_COMPLETED', 'REJECTED'],
  COURSE_COMPLETED: ['PENDING_APPROVAL', 'REJECTED'],
  PENDING_APPROVAL: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['SUSPENDED', 'DEACTIVATED'],
  SUSPENDED: ['ACTIVE'],
  DEACTIVATED: [],
  REJECTED: [],
};

export interface AgentActivationApplyInput {
  market: string;
}

export interface AgentActivationApplyOutput {
  activationId: string;
  status: AgentActivationStatus;
}

export interface AgentActivationResponse {
  activationId: string;
  status: AgentActivationStatus;
  activatedAt?: string;
  market: string;
  createdAt: string;
}

export interface AgentActivationStatusResponse {
  activationId: string;
  status: AgentActivationStatus;
  activatedAt?: string;
  market: string;
}

export interface AgentActivationRecord {
  id: string;
  memberId: string;
  market: string;
  status: AgentActivationStatus;
  previousStatus: AgentActivationStatus | null;
  activationFee: string;
  activationFeeCurrency: string;
  paymentConfirmedAt: string | null;
  courseEnrolledAt: string | null;
  courseCompletedAt: string | null;
  submittedForApprovalAt: string | null;
  activatedAt: string | null;
  activatedByAdminUserId: string | null;
  suspendedAt: string | null;
  revokedAt: string | null;
  deactivatedByAdminUserId: string | null;
  reason: string | null;
  paymentReference: string | null;
  courseReference: string | null;
  approvalNotes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentActivationAuditEntry {
  id: string;
  activationId: string;
  memberId: string;
  market: string;
  action: AgentActivationAction;
  fromStatus: AgentActivationStatus;
  toStatus: AgentActivationStatus;
  actorAdminUserId: string | null;
  actorType: 'SYSTEM' | 'ADMIN' | 'MEMBER';
  reason: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface AgentActivationTransitionResult {
  record: AgentActivationRecord;
  auditEntry: AgentActivationAuditEntry;
}

export interface ActivationFeeConfig {
  market: string;
  fee: string;
  currency: string;
}

export const DEFAULT_ACTIVATION_FEES: ActivationFeeConfig[] = [
  { market: 'MY', fee: '388.00', currency: 'MYR' },
];

export const TRANSITION_TARGETS: Record<string, AgentActivationStatus> = {
  'NOT_APPLIED:APPLY': 'PENDING_PAYMENT',
  'PENDING_PAYMENT:CONFIRM_PAYMENT': 'PAYMENT_CONFIRMED',
  'PAYMENT_CONFIRMED:ENROLL_COURSE': 'COURSE_PENDING',
  'COURSE_PENDING:COMPLETE_COURSE': 'COURSE_COMPLETED',
  'COURSE_COMPLETED:SUBMIT_FOR_APPROVAL': 'PENDING_APPROVAL',
  'PENDING_APPROVAL:APPROVE_AND_ACTIVATE': 'ACTIVE',
  'PENDING_PAYMENT:REJECT': 'REJECTED',
  'PAYMENT_CONFIRMED:REJECT': 'REJECTED',
  'COURSE_PENDING:REJECT': 'REJECTED',
  'COURSE_COMPLETED:REJECT': 'REJECTED',
  'PENDING_APPROVAL:REJECT': 'REJECTED',
  'ACTIVE:SUSPEND': 'SUSPENDED',
  'SUSPENDED:REACTIVATE': 'ACTIVE',
  'ACTIVE:DEACTIVATE': 'DEACTIVATED',
};

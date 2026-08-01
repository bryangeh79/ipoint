export const controlledRoleCodes = [
  'SUPER_ADMIN',
  'OPERATIONS_ADMIN',
  'FINANCE_OPERATOR',
  'FINANCE_APPROVER',
  'KYC_REVIEWER',
  'SUPPORT_READONLY_AUDITOR',
] as const;

export type ControlledRoleCode = (typeof controlledRoleCodes)[number];

const ALL = controlledRoleCodes;
const SELF = ALL;

export interface CanonicalPermissionDefinition {
  code: string;
  description: string;
  owner: string;
  roles: readonly ControlledRoleCode[];
  marketScoped: boolean;
  stepUpRequired: boolean;
  sensitiveReasonRequired?: boolean;
  workflow?: 'MAKER_ONLY' | 'CHECKER_ONLY';
  gate?: string;
}

const permission = (
  code: string,
  description: string,
  owner: string,
  roles: readonly ControlledRoleCode[],
  options: Partial<
    Pick<
      CanonicalPermissionDefinition,
      | 'marketScoped'
      | 'stepUpRequired'
      | 'sensitiveReasonRequired'
      | 'workflow'
      | 'gate'
    >
  > = {},
): CanonicalPermissionDefinition => ({
  code,
  description,
  owner,
  roles,
  marketScoped: options.marketScoped ?? false,
  stepUpRequired: options.stepUpRequired ?? false,
  ...(options.sensitiveReasonRequired ? { sensitiveReasonRequired: true } : {}),
  ...(options.workflow ? { workflow: options.workflow } : {}),
  ...(options.gate ? { gate: options.gate } : {}),
});

/** D-047 / P7-S1C section E authoritative 66-code catalog. */
export const canonicalPermissionCatalog = [
  permission(
    'admin.user.read',
    'View bounded Admin user records.',
    'Platform Access',
    ['SUPER_ADMIN'],
  ),
  permission(
    'admin.user.manage',
    'Create and manage Admin user lifecycle.',
    'Platform Access',
    ['SUPER_ADMIN'],
    { stepUpRequired: true },
  ),
  permission(
    'admin.mfa.self',
    'Manage the current Admin MFA factor.',
    'Auth',
    SELF,
  ),
  permission(
    'admin.mfa.reset',
    'Perform exceptional audited Admin MFA reset.',
    'Auth',
    ['SUPER_ADMIN'],
    { stepUpRequired: true },
  ),
  permission(
    'admin.session.read',
    'View safe Admin session evidence.',
    'Auth',
    SELF,
  ),
  permission(
    'admin.session.revoke.self',
    'Revoke the current Admin own sessions.',
    'Auth',
    SELF,
  ),
  permission(
    'admin.session.revoke.any',
    'Revoke another Admin sessions.',
    'Auth',
    ['SUPER_ADMIN'],
    { stepUpRequired: true },
  ),
  permission(
    'rbac.role.read',
    'View controlled role templates.',
    'Platform Access',
    ['SUPER_ADMIN'],
  ),
  permission(
    'rbac.role.assign',
    'Assign or revoke controlled role templates.',
    'Platform Access',
    ['SUPER_ADMIN'],
    { stepUpRequired: true },
  ),
  permission(
    'rbac.permission.read',
    'View the canonical permission catalog.',
    'Platform Access',
    ['SUPER_ADMIN'],
  ),
  permission(
    'rbac.permission.assign',
    'Apply an approved role permission template.',
    'Platform Access',
    ['SUPER_ADMIN'],
    { stepUpRequired: true },
  ),
  permission(
    'rbac.market.read',
    'View Admin market grants.',
    'Platform Access',
    ['SUPER_ADMIN'],
  ),
  permission(
    'rbac.market.grant',
    'Grant or revoke Admin market access.',
    'Platform Access',
    ['SUPER_ADMIN'],
    { stepUpRequired: true },
  ),
  permission(
    'admin.market.select',
    'Select one active granted Admin market.',
    'Platform Access',
    ALL,
    { marketScoped: true },
  ),
  permission(
    'market.read',
    'View the selected active market.',
    'Platform Access',
    ALL,
    { marketScoped: true },
  ),
  permission(
    'market.manage',
    'Manage one explicit market.',
    'Platform Access',
    ['SUPER_ADMIN'],
    { marketScoped: true, stepUpRequired: true },
  ),
  permission(
    'dashboard.view',
    'View the selected-market Admin dashboard.',
    'Admin Operations',
    ALL,
    { marketScoped: true },
  ),
  permission(
    'member.read',
    'View market-scoped member projections.',
    'Member',
    ALL,
    { marketScoped: true },
  ),
  permission(
    'member.status.manage',
    'Manage member status.',
    'Member',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN'],
    { marketScoped: true },
  ),
  permission(
    'member.session.revoke',
    'Revoke member sessions.',
    'Member',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN'],
    { marketScoped: true },
  ),
  permission(
    'member.reverification.require',
    'Require member KYC reverification.',
    'Member',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN', 'KYC_REVIEWER'],
    { marketScoped: true },
  ),
  permission(
    'member.note.read',
    'View member Admin notes.',
    'Member',
    [
      'SUPER_ADMIN',
      'OPERATIONS_ADMIN',
      'KYC_REVIEWER',
      'SUPPORT_READONLY_AUDITOR',
    ],
    { marketScoped: true },
  ),
  permission(
    'member.note.create',
    'Create member Admin notes.',
    'Member',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN'],
    { marketScoped: true },
  ),
  permission(
    'member.kyc.read',
    'View minimum member KYC evidence.',
    'Member KYC',
    ['SUPER_ADMIN', 'KYC_REVIEWER', 'SUPPORT_READONLY_AUDITOR'],
    { marketScoped: true },
  ),
  permission(
    'member.kyc.decide',
    'Decide a member KYC case.',
    'Member KYC',
    ['SUPER_ADMIN', 'KYC_REVIEWER'],
    { marketScoped: true },
  ),
  permission(
    'member.kyc.evidence.view',
    'View sensitive member KYC evidence.',
    'Member KYC',
    ['SUPER_ADMIN', 'KYC_REVIEWER'],
    { marketScoped: true, stepUpRequired: true, sensitiveReasonRequired: true },
  ),
  permission(
    'merchant.view',
    'View market-scoped merchant projections.',
    'Merchant',
    ALL,
    { marketScoped: true },
  ),
  permission(
    'merchant.approve',
    'Approve merchant applications.',
    'Merchant',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN'],
    { marketScoped: true },
  ),
  permission(
    'merchant.suspend',
    'Suspend or reactivate merchants.',
    'Merchant',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN'],
    { marketScoped: true },
  ),
  permission(
    'merchant.close',
    'Close merchants through governed workflow.',
    'Merchant',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN'],
    { marketScoped: true },
  ),
  permission(
    'merchant.kyc.view',
    'View minimum merchant KYC evidence.',
    'Merchant KYC',
    ['SUPER_ADMIN', 'KYC_REVIEWER', 'SUPPORT_READONLY_AUDITOR'],
    { marketScoped: true },
  ),
  permission(
    'merchant.kyc.approve',
    'Decide a merchant KYC case.',
    'Merchant KYC',
    ['SUPER_ADMIN', 'KYC_REVIEWER'],
    { marketScoped: true },
  ),
  permission(
    'merchant.kyc.evidence.view',
    'View sensitive merchant KYC evidence.',
    'Merchant KYC',
    ['SUPER_ADMIN', 'KYC_REVIEWER'],
    { marketScoped: true, stepUpRequired: true, sensitiveReasonRequired: true },
  ),
  permission(
    'merchant.package.view',
    'View merchant package history.',
    'Merchant Package',
    ALL,
    { marketScoped: true },
  ),
  permission(
    'merchant.package.manage',
    'Manage standard package profiles and versions.',
    'Merchant Package',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN'],
    { marketScoped: true },
  ),
  permission(
    'merchant.package.assign',
    'Assign merchant packages.',
    'Merchant Package',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN'],
    { marketScoped: true },
  ),
  permission(
    'merchant.special_package.manage',
    'Manage bounded special merchant packages.',
    'Merchant Package',
    ['SUPER_ADMIN'],
    { marketScoped: true, stepUpRequired: true },
  ),
  permission(
    'merchant.mcp.view',
    'View merchant MCP accounts and ledgers.',
    'MCP',
    ['SUPER_ADMIN', 'FINANCE_OPERATOR', 'FINANCE_APPROVER'],
    { marketScoped: true },
  ),
  permission(
    'merchant.mcp.adjust',
    'Create a governed MCP adjustment.',
    'MCP',
    ['SUPER_ADMIN', 'FINANCE_OPERATOR'],
    { marketScoped: true, workflow: 'MAKER_ONLY' },
  ),
  permission(
    'merchant.mcp.adjust.approve',
    'Approve a governed MCP adjustment.',
    'MCP',
    ['SUPER_ADMIN', 'FINANCE_APPROVER'],
    { marketScoped: true, stepUpRequired: true, workflow: 'CHECKER_ONLY' },
  ),
  permission(
    'merchant.mcp.adjust.execute',
    'Execute an approved MCP adjustment.',
    'MCP',
    ['SUPER_ADMIN', 'FINANCE_APPROVER'],
    { marketScoped: true, stepUpRequired: true, workflow: 'CHECKER_ONLY' },
  ),
  permission(
    'wallet.ipoint.read',
    'View market-scoped iPoint wallet evidence.',
    'Wallet',
    ['SUPER_ADMIN', 'FINANCE_OPERATOR', 'FINANCE_APPROVER'],
    { marketScoped: true },
  ),
  permission(
    'wallet.ipoint.adjust.maker',
    'Create a durable iPoint adjustment request.',
    'Wallet',
    ['SUPER_ADMIN', 'FINANCE_OPERATOR'],
    { marketScoped: true, workflow: 'MAKER_ONLY', gate: 'GATE-SEC-01' },
  ),
  permission(
    'wallet.ipoint.adjust.checker',
    'Approve a durable iPoint adjustment request.',
    'Wallet',
    ['SUPER_ADMIN', 'FINANCE_APPROVER'],
    {
      marketScoped: true,
      stepUpRequired: true,
      workflow: 'CHECKER_ONLY',
      gate: 'GATE-SEC-01',
    },
  ),
  permission(
    'wallet.ipoint.adjust.execute',
    'Execute an approved iPoint adjustment.',
    'Wallet',
    ['SUPER_ADMIN', 'FINANCE_APPROVER'],
    {
      marketScoped: true,
      stepUpRequired: true,
      workflow: 'CHECKER_ONLY',
      gate: 'GATE-SEC-01',
    },
  ),
  permission(
    'reward.rule.read',
    'View reward rule versions.',
    'Reward',
    [
      'SUPER_ADMIN',
      'OPERATIONS_ADMIN',
      'FINANCE_OPERATOR',
      'FINANCE_APPROVER',
      'SUPPORT_READONLY_AUDITOR',
    ],
    { marketScoped: true },
  ),
  permission(
    'reward.rule.schedule',
    'Schedule a prospective reward rule version.',
    'Reward',
    ['SUPER_ADMIN'],
    { marketScoped: true },
  ),
  permission(
    'reward.job.read',
    'View real reward job evidence.',
    'Reward',
    [
      'SUPER_ADMIN',
      'OPERATIONS_ADMIN',
      'FINANCE_OPERATOR',
      'FINANCE_APPROVER',
      'SUPPORT_READONLY_AUDITOR',
    ],
    { marketScoped: true },
  ),
  permission(
    'reward.job.retry',
    'Retry a failed reward job safely.',
    'Reward',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN'],
    { marketScoped: true },
  ),
  permission(
    'agent.read',
    'View safe agent activation projections.',
    'Agent',
    ALL,
    { marketScoped: true, gate: 'GATE-P5-01' },
  ),
  permission(
    'agent.activation.manage',
    'Manage agent activation workflow.',
    'Agent',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN'],
    { marketScoped: true, gate: 'GATE-P5-01' },
  ),
  permission(
    'agent.fee.read',
    'View versioned agent activation fees.',
    'Agent',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN', 'FINANCE_OPERATOR', 'FINANCE_APPROVER'],
    { marketScoped: true, gate: 'GATE-P5-01' },
  ),
  permission(
    'agent.fee.manage',
    'Manage prospective agent activation fees.',
    'Agent',
    ['SUPER_ADMIN'],
    { marketScoped: true, gate: 'GATE-P5-01' },
  ),
  permission(
    'commission.read',
    'View Finance commission projections.',
    'Commission',
    ['SUPER_ADMIN', 'FINANCE_OPERATOR', 'FINANCE_APPROVER'],
    { marketScoped: true, gate: 'GATE-P5-01' },
  ),
  permission(
    'commission.rate.read',
    'View commission rate versions.',
    'Commission',
    ['SUPER_ADMIN', 'FINANCE_OPERATOR', 'FINANCE_APPROVER'],
    { marketScoped: true, gate: 'GATE-P5-01' },
  ),
  permission(
    'commission.rate.manage',
    'Manage prospective commission rates.',
    'Commission',
    ['SUPER_ADMIN'],
    { marketScoped: true, gate: 'GATE-P5-01' },
  ),
  permission(
    'redemption.catalog.manage',
    'Manage the redemption catalog.',
    'Redemption',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN'],
    { marketScoped: true },
  ),
  permission(
    'redemption.rate.manage',
    'Manage prospective redemption rates.',
    'Redemption',
    ['SUPER_ADMIN'],
    { marketScoped: true },
  ),
  permission(
    'redemption.order.read',
    'View bounded redemption orders.',
    'Redemption',
    [
      'SUPER_ADMIN',
      'OPERATIONS_ADMIN',
      'FINANCE_OPERATOR',
      'FINANCE_APPROVER',
      'SUPPORT_READONLY_AUDITOR',
    ],
    { marketScoped: true },
  ),
  permission(
    'redemption.fulfilment.manage',
    'Manage redemption fulfilment state.',
    'Redemption',
    ['SUPER_ADMIN', 'OPERATIONS_ADMIN'],
    { marketScoped: true },
  ),
  permission(
    'redemption.refund.create',
    'Create a redemption refund request.',
    'Redemption',
    ['SUPER_ADMIN', 'FINANCE_OPERATOR'],
    { marketScoped: true, workflow: 'MAKER_ONLY' },
  ),
  permission(
    'redemption.refund.approve',
    'Approve a redemption refund request.',
    'Redemption',
    ['SUPER_ADMIN', 'FINANCE_APPROVER'],
    {
      marketScoped: true,
      stepUpRequired: true,
      workflow: 'CHECKER_ONLY',
      gate: 'GATE-SEC-02',
    },
  ),
  permission(
    'redemption.voucher.reveal',
    'Reveal one voucher through a no-store sensitive projection.',
    'Redemption',
    ['SUPER_ADMIN', 'FINANCE_APPROVER'],
    { marketScoped: true, stepUpRequired: true, sensitiveReasonRequired: true },
  ),
  permission(
    'audit.read',
    'View allowlisted audit projections.',
    'Platform Access',
    ALL,
    { marketScoped: true },
  ),
  permission(
    'audit.sensitive-diff.view',
    'View a sensitive audit diff.',
    'Platform Access',
    ['SUPER_ADMIN', 'FINANCE_OPERATOR', 'FINANCE_APPROVER', 'KYC_REVIEWER'],
    { marketScoped: true, stepUpRequired: true, sensitiveReasonRequired: true },
  ),
  permission(
    'report.read',
    'View bounded on-screen reports.',
    'Admin Operations',
    ALL,
    { marketScoped: true },
  ),
] as const satisfies readonly CanonicalPermissionDefinition[];

export type CanonicalPermissionCode =
  (typeof canonicalPermissionCatalog)[number]['code'];

export const canonicalPermissionCodes = canonicalPermissionCatalog.map(
  ({ code }) => code,
) as CanonicalPermissionCode[];

export const roleTemplatePermissions = Object.fromEntries(
  controlledRoleCodes.map((roleCode) => [
    roleCode,
    canonicalPermissionCatalog
      .filter(({ roles }) => roles.includes(roleCode))
      .map(({ code }) => code),
  ]),
) as Record<ControlledRoleCode, CanonicalPermissionCode[]>;

export const controlledRoleTemplates: ReadonlyArray<{
  code: ControlledRoleCode;
  name: string;
  description: string;
}> = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Admin',
    description:
      'Controlled platform administration template; no authorization bypasses.',
  },
  {
    code: 'OPERATIONS_ADMIN',
    name: 'Operations Admin',
    description:
      'Market-scoped member, merchant, reward, agent, and redemption operations.',
  },
  {
    code: 'FINANCE_OPERATOR',
    name: 'Finance Operator',
    description: 'Finance Maker and bounded read template.',
  },
  {
    code: 'FINANCE_APPROVER',
    name: 'Finance Approver',
    description: 'Finance Checker and approval template, separate from Maker.',
  },
  {
    code: 'KYC_REVIEWER',
    name: 'KYC Reviewer',
    description: 'Market-scoped member and merchant KYC review template.',
  },
  {
    code: 'SUPPORT_READONLY_AUDITOR',
    name: 'Support / Read-only Auditor',
    description: 'Masked, bounded, read-only support and audit template.',
  },
];

export function isCanonicalPermission(
  code: string,
): code is CanonicalPermissionCode {
  return canonicalPermissionCodes.includes(code as CanonicalPermissionCode);
}

export function permissionDefinition(code: string) {
  return canonicalPermissionCatalog.find((entry) => entry.code === code);
}

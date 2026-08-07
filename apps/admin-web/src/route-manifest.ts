export const navigationGroups = [
  'Overview',
  'People',
  'Commerce',
  'Reviews',
  'Network',
  'Finance',
  'Configuration',
  'Redemption',
  'Governance',
  'Access Control',
  'Security',
  'Account',
] as const;

export type NavigationGroup = (typeof navigationGroups)[number];
export type MarketClassification = 'none' | 'selected' | 'resource';
export type MobilePolicy = 'full' | 'read-only' | 'desktop-only';
export type RouteLoader = 'public' | 'bootstrap' | 'session';
export type RouteErrorBoundary = 'authentication' | 'protected-route';

export interface CapabilityGate {
  capability: string;
  blockedPrerequisite: string;
}

export interface AdminRouteDefinition {
  id: string;
  title: string;
  path: string;
  navigationGroup: NavigationGroup | 'Public access';
  permission?: string;
  market: MarketClassification;
  mobilePolicy: MobilePolicy;
  capabilityGate?: CapabilityGate;
  loader: RouteLoader;
  errorBoundary: RouteErrorBoundary;
  breadcrumb: string;
  navigation: boolean;
}

export const adminRouteManifest = [
  route(
    'login',
    'Admin login',
    '/admin/login',
    'Public access',
    undefined,
    'none',
    'full',
    'public',
    false,
  ),
  route(
    'mfa-enroll',
    'MFA enrollment',
    '/admin/mfa/enroll',
    'Public access',
    'admin.mfa.self',
    'none',
    'full',
    'public',
    false,
  ),
  route(
    'mfa-challenge',
    'MFA challenge',
    '/admin/mfa/challenge',
    'Public access',
    undefined,
    'none',
    'full',
    'public',
    false,
  ),
  route(
    'mfa-recovery',
    'MFA recovery',
    '/admin/mfa/recovery',
    'Public access',
    'admin.mfa.self',
    'none',
    'full',
    'public',
    false,
  ),
  route(
    'dashboard',
    'Dashboard',
    '/admin/:marketId/dashboard',
    'Overview',
    'dashboard.view',
    'selected',
    'read-only',
  ),
  route(
    'members',
    'Members',
    '/admin/:marketId/members',
    'People',
    'member.read',
    'selected',
    'read-only',
  ),
  route(
    'member-detail',
    'Member detail',
    '/admin/:marketId/members/:memberId',
    'People',
    'member.read',
    'resource',
    'read-only',
    'bootstrap',
    false,
  ),
  route(
    'merchants',
    'Merchants',
    '/admin/:marketId/merchants',
    'Commerce',
    'merchant.view',
    'selected',
    'read-only',
  ),
  route(
    'merchant-detail',
    'Merchant detail',
    '/admin/:marketId/merchants/:branchId',
    'Commerce',
    'merchant.view',
    'resource',
    'read-only',
    'bootstrap',
    false,
  ),
  route(
    'member-kyc',
    'Member KYC queue',
    '/admin/:marketId/kyc/members',
    'Reviews',
    'member.kyc.read',
    'selected',
    'read-only',
  ),
  route(
    'merchant-kyc',
    'Merchant KYC queue',
    '/admin/:marketId/kyc/merchants',
    'Reviews',
    'merchant.kyc.view',
    'selected',
    'read-only',
  ),
  route(
    'agents',
    'Agents',
    '/admin/:marketId/agents',
    'Network',
    'agent.read',
    'selected',
    'read-only',
    'bootstrap',
    true,
  ),
  route(
    'agent-detail',
    'Agent detail',
    '/admin/:marketId/agents/:agentId',
    'Network',
    'agent.read',
    'resource',
    'read-only',
    'bootstrap',
    false,
  ),
  route(
    'mcp',
    'MCP accounts and ledger',
    '/admin/:marketId/mcp',
    'Finance',
    'merchant.mcp.view',
    'selected',
    'read-only',
  ),
  route(
    'mcp-adjustments',
    'MCP adjustment queue',
    '/admin/:marketId/mcp-adjustments',
    'Finance',
    'merchant.mcp.adjust',
    'resource',
    'desktop-only',
  ),
  route(
    'ipoint-wallets',
    'iPoint wallet lookup',
    '/admin/:marketId/ipoint-wallets',
    'Finance',
    'wallet.ipoint.read',
    'resource',
    'read-only',
  ),
  route(
    'ipoint-adjustments',
    'iPoint adjustment queue',
    '/admin/:marketId/ipoint-adjustments',
    'Finance',
    'wallet.ipoint.read',
    'resource',
    'desktop-only',
    'bootstrap',
    true,
  ),
  route(
    'ipoint-adjust-create',
    'Create iPoint adjustment',
    '/admin/:marketId/ipoint-adjustments/new',
    'Finance',
    'wallet.ipoint.adjust.maker',
    'resource',
    'desktop-only',
    'bootstrap',
    false,
  ),
  route(
    'ipoint-adjust-detail',
    'iPoint adjustment detail',
    '/admin/:marketId/ipoint-adjustments/:requestId',
    'Finance',
    'wallet.ipoint.read',
    'resource',
    'desktop-only',
    'bootstrap',
    false,
  ),
  route(
    'reward-rates',
    'Reward rate management',
    '/admin/:marketId/config/reward-rates',
    'Configuration',
    'reward.rule.read',
    'selected',
    'read-only',
    'bootstrap',
    true,
  ),
  route(
    'redemption-rates',
    'Redemption rate management',
    '/admin/:marketId/config/redemption-rates',
    'Configuration',
    'redemption.rate.read',
    'selected',
    'read-only',
    'bootstrap',
    true,
  ),
  route(
    'packages',
    'Merchant package management',
    '/admin/:marketId/config/packages',
    'Configuration',
    'merchant.package.view',
    'resource',
    'read-only',
  ),
  route(
    'commissions',
    'Commission configuration',
    '/admin/:marketId/config/commissions',
    'Configuration',
    'commission.rate.read',
    'selected',
    'read-only',
    'bootstrap',
    true,
  ),
  route(
    'market',
    'Market configuration',
    '/admin/:marketId/config/market',
    'Configuration',
    'market.read',
    'selected',
    'read-only',
    'bootstrap',
    true,
  ),
  route(
    'redemption-orders',
    'Redemption orders',
    '/admin/:marketId/redemptions/orders',
    'Redemption',
    'redemption.order.read',
    'resource',
    'read-only',
  ),
  route(
    'redemption-order-detail',
    'Redemption order detail',
    '/admin/:marketId/redemptions/orders/:orderId',
    'Redemption',
    'redemption.order.read',
    'resource',
    'read-only',
    'bootstrap',
    false,
  ),
  route(
    'fulfilment-exceptions',
    'Fulfilment exceptions',
    '/admin/:marketId/redemptions/exceptions',
    'Redemption',
    'redemption.order.read',
    'resource',
    'read-only',
    'bootstrap',
    true,
  ),
  route(
    'refunds',
    'Refund queue',
    '/admin/:marketId/redemptions/refunds',
    'Redemption',
    'redemption.order.read',
    'resource',
    'read-only',
    'bootstrap',
    true,
  ),
  route(
    'refund-detail',
    'Refund detail',
    '/admin/:marketId/redemptions/refunds/:refundId',
    'Redemption',
    'redemption.order.read',
    'resource',
    'read-only',
    'bootstrap',
    false,
  ),
  route(
    'audit',
    'Audit viewer',
    '/admin/:marketId/audit',
    'Governance',
    'audit.read',
    'selected',
    'read-only',
  ),
  route(
    'reports',
    'Basic reports',
    '/admin/:marketId/reports',
    'Governance',
    'report.read',
    'selected',
    'read-only',
  ),
  route(
    'admin-users',
    'Admin users',
    '/admin/access/admin-users',
    'Access Control',
    'admin.user.read',
    'none',
    'read-only',
  ),
  route(
    'roles',
    'Roles and permissions',
    '/admin/access/roles',
    'Access Control',
    'rbac.role.read',
    'none',
    'read-only',
  ),
  route(
    'market-access',
    'Market access',
    '/admin/access/markets',
    'Access Control',
    'rbac.market.read',
    'none',
    'read-only',
  ),
  route(
    'sessions',
    'Sessions and security',
    '/admin/security/sessions',
    'Security',
    'admin.session.read',
    'none',
    'full',
    'session',
  ),
  route(
    'settings',
    'Settings',
    '/admin/settings',
    'Account',
    'admin.profile.self',
    'none',
    'full',
  ),
  /* P7-S5C KYC review case-detail routes (append-only). */
  route(
    'member-kyc-detail',
    'Member KYC case',
    '/admin/:marketId/kyc/members/:caseId',
    'Reviews',
    'member.kyc.read',
    'resource',
    'read-only',
    'bootstrap',
    false,
  ),
  route(
    'merchant-kyc-detail',
    'Merchant KYC submission',
    '/admin/:marketId/kyc/merchants/:branchId',
    'Reviews',
    'merchant.kyc.view',
    'resource',
    'read-only',
    'bootstrap',
    false,
  ),
] as const satisfies ReadonlyArray<AdminRouteDefinition>;

export type AdminRoute = (typeof adminRouteManifest)[number];
export type AdminRouteId =
  | 'login'
  | 'mfa-enroll'
  | 'mfa-challenge'
  | 'mfa-recovery'
  | 'dashboard'
  | 'members'
  | 'member-detail'
  | 'merchants'
  | 'merchant-detail'
  | 'member-kyc'
  | 'merchant-kyc'
  | 'agents'
  | 'agent-detail'
  | 'mcp'
  | 'mcp-adjustments'
  | 'ipoint-wallets'
  | 'ipoint-adjustments'
  | 'ipoint-adjust-create'
  | 'ipoint-adjust-detail'
  | 'reward-rates'
  | 'redemption-rates'
  | 'packages'
  | 'commissions'
  | 'market'
  | 'redemption-orders'
  | 'redemption-order-detail'
  | 'fulfilment-exceptions'
  | 'refunds'
  | 'refund-detail'
  | 'audit'
  | 'reports'
  | 'admin-users'
  | 'roles'
  | 'market-access'
  | 'sessions'
  | 'settings'
  | 'member-kyc-detail'
  | 'merchant-kyc-detail';

export function routeById(id: AdminRouteId): AdminRoute {
  const match = adminRouteManifest.find((candidate) => candidate.id === id);
  if (!match) throw new Error(`Unknown Admin route: ${id}`);
  return match as AdminRoute;
}

export function routePath(
  id: AdminRouteId,
  parameters: Readonly<Record<string, string>> = {},
): string {
  const definition = routeById(id);
  return definition.path.replace(/:([A-Za-z]+)/gu, (_, key: string) => {
    const value = parameters[key];
    if (!value) throw new Error(`Missing route parameter: ${key}`);
    return encodeURIComponent(value);
  });
}

function gate(capability: string, blockedPrerequisite: string): CapabilityGate {
  return { capability, blockedPrerequisite };
}

function route(
  id: AdminRouteId,
  title: string,
  path: string,
  navigationGroup: NavigationGroup | 'Public access',
  permission: string | undefined,
  market: MarketClassification,
  mobilePolicy: MobilePolicy,
  loader: RouteLoader = 'bootstrap',
  navigation = true,
  capabilityGate?: CapabilityGate,
): AdminRouteDefinition & { id: AdminRouteId } {
  return {
    id,
    title,
    path,
    navigationGroup,
    ...(permission ? { permission } : {}),
    market,
    mobilePolicy,
    ...(capabilityGate ? { capabilityGate } : {}),
    loader,
    errorBoundary:
      navigationGroup === 'Public access'
        ? 'authentication'
        : 'protected-route',
    breadcrumb: title,
    navigation,
  };
}

import { vi } from 'vitest';
import type {
  AdminAgentDetailDto,
  AdminAgentListDto,
  AdminFulfilmentQueueDto,
  AdminFulfilmentQueueOverviewDto,
  AdminOrderDetailDto,
  AdminRefundDetailDto,
  AdminRefundQueueDto,
} from '@ipoint/api-client';

/**
 * Shared P7-S8 page-test mock: shell endpoints (login, MFA, bootstrap,
 * markets, sessions) plus the agent-ops and redemption-fulfilment-ops
 * adapter endpoints. Permission enforcement mirrors the canonical
 * catalog: `agent.read` for agent reads, `agent.activation.manage` for
 * agent status writes, `redemption.order.read` for queue/order/refund
 * reads, `redemption.fulfilment.manage` for suspend/resume/retry.
 */

export const P7S8_MARKET_ID = '11111111-1111-4111-8111-111111111111';
export const P7S8_AGENT_ID = '22222222-2222-4222-8222-222222222222';
export const P7S8_AGENT_PENDING = '23232323-2323-4323-8323-232323232323';
export const P7S8_ORDER_ID = '33333333-3333-4333-8333-333333333333';
export const P7S8_FULFILMENT_ID = '44444444-4444-4444-8444-444444444444';
export const P7S8_REFUND_ID = '55555555-5555-4555-8555-555555555555';
export const P7S8_ACTOR_ID = '66666666-6666-4666-8666-666666666666';

export interface P7S8OpsMockOptions {
  permissions?: string[];
  agentCapability?: 'CONFIGURED' | 'AGENT_FEE_NOT_CONFIGURED';
  agentList?: AdminAgentListDto;
  agentDetail?: AdminAgentDetailDto;
  queueOverview?: AdminFulfilmentQueueOverviewDto;
  queue?: AdminFulfilmentQueueDto;
  orderDetail?: AdminOrderDetailDto;
  refundQueue?: AdminRefundQueueDto;
  refundDetail?: AdminRefundDetailDto;
  agentStatusAction?: Record<string, unknown>;
  fulfilmentAction?: Record<string, unknown>;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function agentListFixture(
  capability: 'CONFIGURED' | 'AGENT_FEE_NOT_CONFIGURED' = 'CONFIGURED',
): AdminAgentListDto {
  return {
    market_id: P7S8_MARKET_ID,
    market_code: 'MY',
    capability: {
      state: capability,
      activation_fee: capability === 'CONFIGURED' ? '388.0000000000' : null,
      currency: capability === 'CONFIGURED' ? 'MYR' : null,
      fee_rate_version_id: capability === 'CONFIGURED' ? 'fee-1' : null,
    },
    items: [
      {
        agent_id: P7S8_AGENT_ID,
        member_id: '77777777-7777-4777-8777-777777777777',
        public_member_id: 'AG-ALICE',
        member_display_name: 'Alice Agent',
        status: 'ACTIVE',
        market: 'MY',
        activation_fee: '388.0000000000',
        activation_fee_currency: 'MYR',
        activated_at: '2026-08-01T00:00:00.000Z',
        created_at: '2026-07-01T00:00:00.000Z',
      },
      {
        agent_id: P7S8_AGENT_PENDING,
        member_id: '78787878-7878-4878-8878-787878787878',
        public_member_id: 'AG-CAROL',
        member_display_name: 'Carol Agent',
        status: 'PENDING_APPROVAL',
        market: 'MY',
        activation_fee: '388.0000000000',
        activation_fee_currency: 'MYR',
        activated_at: null,
        created_at: '2026-07-02T00:00:00.000Z',
      },
    ],
    total: 2,
    limit: 100,
    offset: 0,
  };
}

export function agentDetailFixture(): AdminAgentDetailDto {
  return {
    agent_id: P7S8_AGENT_ID,
    member_id: '77777777-7777-4777-8777-777777777777',
    public_member_id: 'AG-ALICE',
    member_display_name: 'Alice Agent',
    status: 'ACTIVE',
    market: 'MY',
    activation_fee: '388.0000000000',
    activation_fee_currency: 'MYR',
    activated_at: '2026-08-01T00:00:00.000Z',
    created_at: '2026-07-01T00:00:00.000Z',
    payment_reference: null,
    payment_confirmed_at: null,
    course_reference: null,
    course_enrolled_at: null,
    course_completed_at: null,
    course_confirmed_by: null,
    approved_at: null,
    activated_by: '99999999-9999-4999-8999-999999999999',
    fee_rate_version_id: 'fee-1',
    rejection_reason: null,
    reactivation_count: 0,
    revoked_at: null,
    revoked_by: null,
    revocation_reason: null,
    updated_at: '2026-08-01T00:00:00.000Z',
    status_history: [
      {
        log_id: 'log-1',
        from_status: 'PENDING_APPROVAL',
        to_status: 'ACTIVE',
        changed_by: '99999999-9999-4999-8999-999999999999',
        changed_by_type: 'ADMIN',
        reason: 'Approved',
        changed_at: '2026-08-01T00:00:00.000Z',
      },
      {
        log_id: 'log-2',
        from_status: null,
        to_status: 'PENDING_APPROVAL',
        changed_by: null,
        changed_by_type: 'SYSTEM',
        reason: null,
        changed_at: '2026-07-30T00:00:00.000Z',
      },
    ],
  };
}

export function queueOverviewFixture(): AdminFulfilmentQueueOverviewDto {
  return {
    market_id: P7S8_MARKET_ID,
    market_code: 'MY',
    rate_configured: true,
    counts: {
      READY_FOR_PICKUP: 1,
      BACKORDERED: 1,
      FULFILMENT_SUSPENDED: 1,
      FULFILMENT_EXCEPTION: 2,
      REFUND_PENDING: 1,
      REFUNDED: 0,
    },
  };
}

export function queueFixture(): AdminFulfilmentQueueDto {
  return {
    market_id: P7S8_MARKET_ID,
    market_code: 'MY',
    status: 'FULFILMENT_EXCEPTION',
    rate_configured: true,
    items: [
      {
        order_id: P7S8_ORDER_ID,
        order_reference: 'ORD-000042',
        member_id: '77777777-7777-4777-8777-777777777777',
        public_member_id: 'M-ALICE',
        item_name: 'iPoint Mug',
        item_sku: 'MUG-001',
        total_points: '10000.0000000000',
        quantity: '1',
        backorder_quantity: '0',
        status: 'FULFILMENT_EXCEPTION',
        confirmed_at: '2026-08-01T00:00:00.000Z',
        ready_for_pickup_at: null,
        backordered_at: null,
        fulfilled_at: null,
        updated_at: '2026-08-02T00:00:00.000Z',
        fulfilment: {
          fulfilment_id: P7S8_FULFILMENT_ID,
          fulfilment_type: 'PHYSICAL',
          fulfilment_status: 'FAILED',
          tracking_number: null,
          courier: null,
          failure_reason: 'Courier rejected',
          retry_count: 1,
          max_retries: 3,
          created_at: '2026-08-01T00:00:00.000Z',
        },
        refund: null,
        shipping_recovery: null,
      },
    ],
    total: 1,
    limit: 100,
    offset: 0,
  };
}

export function orderDetailFixture(): AdminOrderDetailDto {
  return {
    market_id: P7S8_MARKET_ID,
    market_code: 'MY',
    order: {
      order_id: P7S8_ORDER_ID,
      order_reference: 'ORD-000042',
      member_id: '77777777-7777-4777-8777-777777777777',
      public_member_id: 'M-ALICE',
      item_name: 'iPoint Mug',
      item_sku: 'MUG-001',
      status: 'FULFILMENT_EXCEPTION',
      total_points: '10000.0000000000',
      quantity: '1',
      backorder_quantity: '0',
      rate_value: '0.0100000000',
      confirmed_at: '2026-08-01T00:00:00.000Z',
      ready_for_pickup_at: null,
      backordered_at: null,
      fulfilled_at: null,
      cancelled_at: null,
      notes: null,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-02T00:00:00.000Z',
    },
    fulfilment: {
      fulfilment_id: P7S8_FULFILMENT_ID,
      fulfilment_type: 'PHYSICAL',
      fulfilment_status: 'FAILED',
      tracking_number: null,
      courier: null,
      failure_reason: 'Courier rejected',
      retry_count: 1,
      max_retries: 3,
      created_at: '2026-08-01T00:00:00.000Z',
    },
    refund: null,
    shipping_recovery: null,
    audit: [
      {
        id: 'audit-1',
        action: 'FULFILMENT_FAILED',
        entity_type: 'REDEMPTION_FULFILMENT',
        entity_id: P7S8_FULFILMENT_ID,
        actor_type: 'SYSTEM',
        actor_id: null,
        reason: 'Fulfilment failed',
        result: 'SUCCESS',
        request_id: null,
        occurred_at: '2026-08-02T00:00:00.000Z',
      },
    ],
  };
}

export function refundQueueFixture(): AdminRefundQueueDto {
  return {
    market_id: P7S8_MARKET_ID,
    market_code: 'MY',
    items: [
      {
        refund_request_id: P7S8_REFUND_ID,
        order_id: P7S8_ORDER_ID,
        order_reference: 'ORD-000042',
        status: 'PENDING_CHECKER',
        refund_amount: '10000.0000000000',
        reason: 'Item unavailable - refund required',
        maker_id: P7S8_ACTOR_ID,
        checker_id: null,
        maker_notes: null,
        checker_notes: null,
        prior_order_status: 'FULFILMENT_EXCEPTION',
        decided_at: null,
        executed_at: null,
        failed_at: null,
        failure_reason: null,
        created_at: '2026-08-02T00:00:00.000Z',
        updated_at: '2026-08-02T00:00:00.000Z',
      },
    ],
    total: 1,
    limit: 100,
    offset: 0,
  };
}

export function refundDetailFixture(): AdminRefundDetailDto {
  return {
    ...refundQueueFixture().items[0]!,
    status_history: [
      {
        id: 'audit-2',
        action: 'REFUND_REQUESTED',
        reason: 'Item unavailable - refund required',
        result: 'SUCCESS',
        actor_id: P7S8_ACTOR_ID,
        occurred_at: '2026-08-02T00:00:00.000Z',
      },
    ],
  };
}

export function mockP7S8OpsApi(options: P7S8OpsMockOptions = {}) {
  const permissions = options.permissions ?? [
    'agent.activation.read',
    'agent.read',
    'agent.activation.manage',
    'redemption.order.read',
    'redemption.fulfilment.manage',
    'redemption.fulfilment.read',
    'redemption.refund.read',
  ];
  const market = {
    id: P7S8_MARKET_ID,
    code: 'MY',
    name: 'Malaysia',
    currencyCode: 'MYR',
    timezone: 'Asia/Kuala_Lumpur',
    locale: 'en-MY',
    grantedAt: '2026-01-01T00:00:00.000Z',
    isSelected: true,
  };

  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/auth/admin/login') && method === 'POST') {
        return json(
          {
            code: 'MFA_REQUIRED',
            mfa_challenge_id: 'challenge'.repeat(4),
            expires_at: '2026-08-01T12:05:00.000Z',
          },
          202,
        );
      }
      if (url.endsWith('/auth/admin/mfa/challenge') && method === 'POST') {
        return json({
          accessToken: 'admin-access-token',
          refreshToken: 'admin-refresh-token',
          accessExpiresAt: '2026-08-01T12:15:00.000Z',
          refreshExpiresAt: '2026-08-08T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/bootstrap')) {
        return json({
          actor: {
            id: P7S8_ACTOR_ID,
            accountId: 'account-1',
            displayName: 'Bryan Admin',
            status: 'ACTIVE',
          },
          roles: [{ id: 'role-1', code: 'SUPER_ADMIN', name: 'Super Admin' }],
          effectivePermissions: permissions,
          accessibleMarkets: [{ ...market, isSelected: true }],
          currentMarket: market,
          contextVersion: 3,
          availability: { operationalWorkspace: 'AVAILABLE' },
          asOf: '2026-08-01T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/me/markets') && method === 'GET') {
        return json({
          items: [{ ...market, isSelected: true }],
          currentMarketId: P7S8_MARKET_ID,
          contextVersion: 3,
          asOf: '2026-08-01T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/sessions/current')) {
        return json({
          valid: true,
          session_id: 'session-1',
          admin_user_id: P7S8_ACTOR_ID,
          mfa_recovery_used: false,
        });
      }
      if (url.endsWith('/admin/sessions')) return json({ sessions: [] });

      // ── Agent ops surface ────────────────────────────────────────────
      const agentBase = '/admin/agent-ops/markets/';
      const agentIdx = url.indexOf(agentBase);
      if (agentIdx !== -1) {
        const path = url.slice(agentIdx + agentBase.length);
        const listMatch = /^([^/]+)\/agents(?:\?.*)?$/u.exec(path);
        if (listMatch && method === 'GET') {
          if (!permissions.includes('agent.read')) {
            return json({ code: 'PERMISSION_DENIED' }, 403);
          }
          return json(
            options.agentList ?? agentListFixture(options.agentCapability),
          );
        }
        const agentMatch = /^([^/]+)\/agents\/([^/]+)$/u.exec(path);
        if (agentMatch && method === 'GET') {
          if (!permissions.includes('agent.read')) {
            return json({ code: 'PERMISSION_DENIED' }, 403);
          }
          return json(options.agentDetail ?? agentDetailFixture());
        }
        const statusMatch =
          /^([^/]+)\/agents\/([^/]+)\/(suspend|reactivate|deactivate)$/u.exec(
            path,
          );
        if (statusMatch && method === 'POST') {
          if (!permissions.includes('agent.activation.manage')) {
            return json({ code: 'PERMISSION_DENIED' }, 403);
          }
          const action = statusMatch[3];
          const result = options.agentStatusAction ?? {
            agent_id: P7S8_AGENT_ID,
            status:
              action === 'suspend'
                ? 'SUSPENDED'
                : action === 'reactivate'
                  ? 'ACTIVE'
                  : 'DEACTIVATED',
            updated_at: '2026-08-02T00:00:00.000Z',
          };
          return json(result);
        }
        return json({ code: 'NOT_FOUND', message: url }, 404);
      }

      // ── Redemption fulfilment ops surface ────────────────────────────
      const opsBase = '/admin/redemption-fulfilment-ops/markets/';
      const opsIdx = url.indexOf(opsBase);
      if (opsIdx === -1) {
        return json({ error: { code: 'NOT_FOUND', message: url } }, 404);
      }
      const path = url.slice(opsIdx + opsBase.length);
      const readAllowed = permissions.includes('redemption.order.read');
      const manageAllowed = permissions.includes(
        'redemption.fulfilment.manage',
      );

      if (path === `${P7S8_MARKET_ID}/queues` && method === 'GET') {
        if (!readAllowed) return json({ code: 'PERMISSION_DENIED' }, 403);
        return json(options.queueOverview ?? queueOverviewFixture());
      }
      const queueMatch = /^([^/]+)\/queues\/([^/]+)(?:\?.*)?$/u.exec(path);
      if (queueMatch && method === 'GET') {
        if (!readAllowed) return json({ code: 'PERMISSION_DENIED' }, 403);
        return json(options.queue ?? queueFixture());
      }
      const orderMatch = /^([^/]+)\/orders\/([^/]+)$/u.exec(path);
      if (orderMatch && method === 'GET') {
        if (!readAllowed) return json({ code: 'PERMISSION_DENIED' }, 403);
        return json(options.orderDetail ?? orderDetailFixture());
      }
      const orderActionMatch =
        /^([^/]+)\/orders\/([^/]+)\/(suspend|resume)$/u.exec(path);
      if (orderActionMatch && method === 'POST') {
        if (!manageAllowed) return json({ code: 'PERMISSION_DENIED' }, 403);
        const action = orderActionMatch[3];
        return json(
          options.fulfilmentAction ?? {
            ok: true,
            order_id: P7S8_ORDER_ID,
            status:
              action === 'suspend' ? 'FULFILMENT_SUSPENDED' : 'PROCESSING',
            updated_at: '2026-08-02T00:00:00.000Z',
          },
        );
      }
      const retryMatch = /^([^/]+)\/fulfilments\/([^/]+)\/retry$/u.exec(path);
      if (retryMatch && method === 'POST') {
        if (!manageAllowed) return json({ code: 'PERMISSION_DENIED' }, 403);
        return json(
          options.fulfilmentAction ?? {
            ok: true,
            fulfilment_id: P7S8_FULFILMENT_ID,
            status: 'PENDING',
            updated_at: '2026-08-02T00:00:00.000Z',
          },
        );
      }
      const refundsListMatch = /^([^/]+)\/refunds(?:\?.*)?$/u.exec(path);
      if (refundsListMatch && method === 'GET') {
        if (!readAllowed) return json({ code: 'PERMISSION_DENIED' }, 403);
        return json(options.refundQueue ?? refundQueueFixture());
      }
      const refundMatch = /^([^/]+)\/refunds\/([^/]+)$/u.exec(path);
      if (refundMatch && method === 'GET') {
        if (!readAllowed) return json({ code: 'PERMISSION_DENIED' }, 403);
        return json(options.refundDetail ?? refundDetailFixture());
      }
      return json({ error: { code: 'NOT_FOUND', message: url } }, 404);
    });
}

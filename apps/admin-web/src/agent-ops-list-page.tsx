import type {
  AdminAgentListDto,
  AdminAgentOpsStatus,
} from '@ipoint/api-client';
import { Button, Card, Input, PageHeader, Select, Table } from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminAgentOpsApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import {
  agentStatusLabel,
  describeAgentReadError,
  formatAgentUtc,
  type AgentPageErrorCopy,
} from './agent-ops-model.js';
import {
  AgentCapabilityBanner,
  AgentOpsEmptyState,
  AgentOpsSkeleton,
  AgentStatusBadge,
} from './agent-ops-states.js';

/**
 * P7-S8 Agent operations list/search page (Command Center 2026-08-07
 * §6.1).
 *
 * Read-only, selected-market agent list with free-text search and status
 * filter over the frozen Phase 5 owner read projection. The explicit
 * capability banner shows the blocked state
 * (`AGENT_FEE_NOT_CONFIGURED`) for markets without an effective activation
 * fee — never a fallback fee. Every row links to the agent detail where
 * the owner-orchestrated status actions live.
 */

type AgentListLoad =
  | { status: 'loading' }
  | { status: 'ready'; data: AdminAgentListDto }
  | ({ status: 'error' } & AgentPageErrorCopy);

const STATUS_OPTIONS = [
  'ALL',
  'PENDING_PAYMENT',
  'PAYMENT_CONFIRMED',
  'COURSE_PENDING',
  'COURSE_COMPLETED',
  'PENDING_APPROVAL',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
  'REJECTED',
] as const;

export function AgentOpsListPage() {
  const { marketId } = useParams<{ marketId: string }>();
  const session = useAdminSession();
  const [load, setLoad] = useState<AgentListLoad>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AdminAgentOpsStatus | 'ALL'>(
    'ALL',
  );
  const [retryKey, setRetryKey] = useState(0);

  const loadAgents = useCallback(async () => {
    if (!marketId) return;
    setLoad({ status: 'loading' });
    try {
      const data = await adminAgentOpsApi.listAgents(marketId, {
        ...(query.trim() ? { q: query.trim() } : {}),
        ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
        limit: 100,
      });
      setLoad({ status: 'ready', data });
    } catch (error: unknown) {
      setLoad({ status: 'error', ...describeAgentReadError(error) });
    }
  }, [marketId, query, statusFilter]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents, retryKey]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  const items = load.status === 'ready' ? load.data.items : [];

  return (
    <div className="admin-page">
      <PageHeader
        title="Agents"
        description="Selected-market agent activation records over the frozen Phase 5 owner (read projection). Status operations (suspend / reactivate / deactivate) delegate 1:1 to the owner commands and are recorded in the immutable status log. Agent Reapplication Policy is not implemented."
      />

      {load.status === 'ready' ? (
        <AgentCapabilityBanner state={load.data.capability.state} />
      ) : null}

      <section aria-label="Agent list">
        <h2 className="admin-reward-section">Agent activations</h2>
        <Card>
          <div className="admin-reward-form">
            <label className="admin-reward-muted" htmlFor="agent-search">
              Search
            </label>
            <Input
              id="agent-search"
              aria-label="Search agents"
              placeholder="Public member id, referral code or display name"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <label className="admin-reward-muted" htmlFor="agent-status-filter">
              Status filter
            </label>
            <Select
              id="agent-status-filter"
              aria-label="Status filter"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value === 'ALL'
                    ? 'ALL'
                    : (event.target.value as AdminAgentOpsStatus),
                )
              }
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 'ALL' ? 'All statuses' : agentStatusLabel(option)}
                </option>
              ))}
            </Select>
          </div>

          {load.status === 'loading' ? <AgentOpsSkeleton /> : null}
          {load.status === 'error' ? (
            <div className="admin-state" role="alert">
              <p className="admin-state__title">{load.title}</p>
              <p className="admin-state__body">{load.description}</p>
              <Button onClick={retry}>Try again safely</Button>
            </div>
          ) : null}
          {load.status === 'ready' && items.length === 0 ? (
            <AgentOpsEmptyState />
          ) : null}
          {load.status === 'ready' && items.length > 0 ? (
            <Table>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Status</th>
                  <th scope="col">Activation fee</th>
                  <th scope="col">Activated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.agent_id}>
                    <td>
                      <strong>{item.public_member_id}</strong>
                      <br />
                      <span className="admin-reward-muted">
                        {item.member_display_name ?? '—'}
                      </span>
                    </td>
                    <td>
                      <AgentStatusBadge status={item.status} />
                    </td>
                    <td>
                      {item.activation_fee !== null
                        ? `${item.activation_fee} ${item.activation_fee_currency}`
                        : '—'}
                    </td>
                    <td>{formatAgentUtc(item.activated_at)}</td>
                    <td>
                      <Link
                        to={`/admin/${marketId}/agents/${item.agent_id}`}
                        className="admin-link"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
          {load.status === 'ready' && items.length > 0 ? (
            <p className="admin-reward-muted" data-testid="agent-total">
              {load.data.total} agent(s) for this market
            </p>
          ) : null}
        </Card>
      </section>
      <p className="admin-reward-muted">
        Session market: {session.bootstrap?.currentMarket?.code ?? '—'}
      </p>
    </div>
  );
}

import type { AdminAgentDetailDto } from '@ipoint/api-client';
import { Button, Card, PageHeader, Table } from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminAgentOpsApi } from './admin-api.js';
import {
  describeAgentActionError,
  describeAgentReadError,
  formatAgentUtc,
  type AgentPageErrorCopy,
} from './agent-ops-model.js';
import {
  AgentActionSuccess,
  AgentOpsEmptyState,
  AgentOpsSkeleton,
  AgentStatusBadge,
} from './agent-ops-states.js';

/**
 * P7-S8 Agent detail page (Command Center 2026-08-07 §6.1).
 *
 * Selected-market agent detail with the append-only owner status history
 * and the owner-orchestrated status actions (suspend / reactivate /
 * deactivate — `agent.activation.manage`). Every action delegates 1:1 to
 * the frozen Phase 5 owner commands with the server Current Admin Market;
 * the reason is mandatory for suspend/deactivate. Failed actions surface
 * the design-system state (conflict / permission-denied / capability
 * blocked), never a fabricated success.
 */

type AgentDetailLoad =
  | { status: 'loading' }
  | { status: 'ready'; data: AdminAgentDetailDto }
  | ({ status: 'error' } & AgentPageErrorCopy);

type AgentActionState =
  | { status: 'idle' }
  | { status: 'working'; action: string }
  | ({ status: 'error' } & AgentPageErrorCopy)
  | { status: 'success'; message: string };

export function AgentOpsDetailPage() {
  const { marketId, agentId } = useParams<{
    marketId: string;
    agentId: string;
  }>();
  const [load, setLoad] = useState<AgentDetailLoad>({ status: 'loading' });
  const [action, setAction] = useState<AgentActionState>({ status: 'idle' });
  const [reason, setReason] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  const loadAgent = useCallback(async () => {
    if (!marketId || !agentId) return;
    setLoad({ status: 'loading' });
    try {
      const data = await adminAgentOpsApi.getAgent(marketId, agentId);
      setLoad({ status: 'ready', data });
    } catch (error: unknown) {
      setLoad({ status: 'error', ...describeAgentReadError(error) });
    }
  }, [marketId, agentId]);

  useEffect(() => {
    void loadAgent();
  }, [loadAgent, retryKey]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);

  const runAction = useCallback(
    async (kind: 'suspend' | 'reactivate' | 'deactivate') => {
      if (!marketId || !agentId) return;
      if ((kind === 'suspend' || kind === 'deactivate') && !reason.trim()) {
        setAction({
          status: 'error',
          kind: 'error',
          title: 'Reason required',
          description: 'Enter a reason to perform this action.',
        });
        return;
      }
      setAction({ status: 'working', action: kind });
      try {
        const result =
          kind === 'suspend'
            ? await adminAgentOpsApi.suspendAgent(
                marketId,
                agentId,
                reason.trim(),
              )
            : kind === 'reactivate'
              ? await adminAgentOpsApi.reactivateAgent(marketId, agentId)
              : await adminAgentOpsApi.deactivateAgent(
                  marketId,
                  agentId,
                  reason.trim(),
                );
        setAction({
          status: 'success',
          message: `Agent ${kind === 'suspend' ? 'suspended' : kind === 'reactivate' ? 'reactivated' : 'deactivated'} — ${result.status}`,
        });
        setReason('');
        await loadAgent();
      } catch (error: unknown) {
        setAction({ status: 'error', ...describeAgentActionError(error) });
      }
    },
    [marketId, agentId, reason, loadAgent],
  );

  const data = load.status === 'ready' ? load.data : null;

  return (
    <div className="admin-page">
      <PageHeader
        title="Agent detail"
        description="Selected-market agent activation record with the immutable owner status log. Status changes delegate 1:1 to the frozen Phase 5 owner commands (P5-R1 actor attribution); invalid transitions are rejected server-side."
      />

      {load.status === 'loading' ? <AgentOpsSkeleton rows={8} /> : null}
      {load.status === 'error' ? (
        <div className="admin-state" role="alert">
          <p className="admin-state__title">{load.title}</p>
          <p className="admin-state__body">{load.description}</p>
          <Button onClick={retry}>Try again safely</Button>
        </div>
      ) : null}
      {load.status === 'ready' && data ? (
        <>
          <Card>
            <dl className="admin-detail-grid">
              <div>
                <dt>Agent</dt>
                <dd data-testid="agent-public-id">{data.public_member_id}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <AgentStatusBadge status={data.status} />
                </dd>
              </div>
              <div>
                <dt>Market</dt>
                <dd>{data.market}</dd>
              </div>
              <div>
                <dt>Activation fee</dt>
                <dd>
                  {data.activation_fee !== null
                    ? `${data.activation_fee} ${data.activation_fee_currency}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Activated</dt>
                <dd>{formatAgentUtc(data.activated_at)}</dd>
              </div>
              <div>
                <dt>Reactivations</dt>
                <dd>{data.reactivation_count}</dd>
              </div>
              <div>
                <dt>Rejection / revocation reason</dt>
                <dd>
                  {data.rejection_reason ?? data.revocation_reason ?? '—'}
                </dd>
              </div>
            </dl>
          </Card>

          {action.status === 'success' ? (
            <AgentActionSuccess
              message={action.message}
              onClose={() => setAction({ status: 'idle' })}
            />
          ) : null}
          {action.status === 'error' ? (
            <div className="admin-state" role="alert">
              <p className="admin-state__title">{action.title}</p>
              <p className="admin-state__body">{action.description}</p>
              {action.kind === 'blocked-prerequisite' ? (
                <p className="admin-prerequisite">
                  <span>CAPABILITY_UNAVAILABLE</span>
                  <code>{action.blockedPrerequisite}</code>
                </p>
              ) : null}
            </div>
          ) : null}

          <Card>
            <h3 className="admin-reward-section">Status actions</h3>
            <div className="admin-reward-form">
              <label
                className="admin-reward-muted"
                htmlFor="agent-action-reason"
              >
                Reason (required for suspend / deactivate)
              </label>
              <input
                id="agent-action-reason"
                className="admin-input"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Mandatory durable reason"
              />
              <div className="admin-action-row">
                <Button
                  onClick={() => void runAction('suspend')}
                  disabled={
                    action.status === 'working' || data.status !== 'ACTIVE'
                  }
                  data-testid="agent-suspend"
                >
                  Suspend
                </Button>
                <Button
                  onClick={() => void runAction('reactivate')}
                  disabled={
                    action.status === 'working' || data.status !== 'SUSPENDED'
                  }
                  data-testid="agent-reactivate"
                >
                  Reactivate
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void runAction('deactivate')}
                  disabled={
                    action.status === 'working' || data.status !== 'ACTIVE'
                  }
                  data-testid="agent-deactivate"
                >
                  Deactivate
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="admin-reward-section">Status history</h3>
            {data.status_history.length === 0 ? (
              <AgentOpsEmptyState description="No status history recorded for this agent." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Transition</th>
                    <th scope="col">Changed by</th>
                    <th scope="col">Reason</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.status_history.map((entry) => (
                    <tr key={entry.log_id}>
                      <td>
                        {entry.from_status ?? '—'} → {entry.to_status}
                      </td>
                      <td>{entry.changed_by_type}</td>
                      <td>{entry.reason ?? '—'}</td>
                      <td>{formatAgentUtc(entry.changed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

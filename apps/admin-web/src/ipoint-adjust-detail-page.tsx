import {
  ApiError,
  type AdminIpointAdjustmentDetailDto,
} from '@ipoint/api-client';
import { Button, Card, FormField, Input, PageHeader } from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminApi, adminIpointAdjustOpsApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import {
  canDecideIpointAdjustment,
  canExecuteIpointAdjustment,
  describeIpointAdjustmentReadError,
  describeIpointAdjustmentWriteError,
  formatIpointUtc,
  ipointAdjustmentAboveSoftCap,
  ipointAdjustmentExecutionBlocked,
  isOwnRequest,
  type IpointAdjustmentPageErrorCopy,
} from './ipoint-adjust-model.js';
import {
  IpointAdjustmentActionNotice,
  IpointAdjustmentErrorState,
  IpointAdjustmentPermissionDeniedState,
  IpointAdjustmentSkeleton,
  IpointAdjustmentStateBadge,
} from './ipoint-adjust-states.js';
import {
  canPerformSensitiveAdminWrite,
  useAdminWriteEnvironment,
} from './pwa-policy.js';

/**
 * P7-S7B Manual iPoint Adjustment — request detail + Checker actions
 * (SEC-01 §6 / P7-S1 §17, P7-OD-03/10/11/18/20).
 *
 * - Evidence summary and audit information (reason code, explanation,
 *   case reference, opaque attachment reference, maker/checker identity +
 *   timestamps, immutable decision history).
 * - Maker submit (DRAFT → SUBMITTED): only the request maker.
 * - Checker decide (SUBMITTED → APPROVED | REJECTED): the checker
 *   controls are disabled for the maker's own request (UI affordance; the
 *   frozen owner enforces the inequality server-side), the reject reason
 *   is mandatory, and a fresh step-up token is obtained via the MFA
 *   step-up flow and passed in `x-step-up-token`.
 * - Checker execute (APPROVED → EXECUTING → EXECUTED | FAILED): shown
 *   blocked (disabled) when the amount is above the soft cap and secure
 *   evidence storage is not enabled for the market (P7-OD-11); the server
 *   is the authority.
 */

type DetailLoad =
  | { status: 'loading' }
  | { status: 'ready'; detail: AdminIpointAdjustmentDetailDto }
  | ({ status: 'error' } & IpointAdjustmentPageErrorCopy);

interface DecisionDraft {
  decision: 'APPROVED' | 'REJECTED';
  reason: string;
  requireAttachment: boolean;
}

export function IpointAdjustDetailPage() {
  const { marketId, requestId } = useParams<{
    marketId: string;
    requestId: string;
  }>();
  const session = useAdminSession();
  const permissions = session.bootstrap?.effectivePermissions ?? [];
  const actorId = session.bootstrap?.actor.id;
  const environment = useAdminWriteEnvironment();
  const canWrite = canPerformSensitiveAdminWrite(environment);

  const [load, setLoad] = useState<DetailLoad>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const [decisionDraft, setDecisionDraft] = useState<DecisionDraft>({
    decision: 'APPROVED',
    reason: '',
    requireAttachment: false,
  });
  const [stepUpChallenge, setStepUpChallenge] = useState<string | null>(null);
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpToken, setStepUpToken] = useState<string | undefined>();
  const [pendingAction, setPendingAction] = useState<
    'DECIDE' | 'EXECUTE' | null
  >(null);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  const loadDetail = useCallback(async () => {
    if (!marketId || !requestId) return;
    setLoad({ status: 'loading' });
    try {
      const detail = await adminIpointAdjustOpsApi.getAdjustment(
        marketId,
        requestId,
      );
      setLoad({ status: 'ready', detail });
    } catch (error: unknown) {
      setLoad({ status: 'error', ...describeIpointAdjustmentReadError(error) });
    }
  }, [marketId, requestId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, retryKey]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);

  const request = load.status === 'ready' ? load.detail.request : undefined;
  const decisions = load.status === 'ready' ? load.detail.decisions : [];

  const canDecide = canDecideIpointAdjustment(permissions, canWrite);
  const canExecute = canExecuteIpointAdjustment(permissions, canWrite);
  const ownRequest = isOwnRequest(
    { makerAdminUserId: request?.makerAdminUserId ?? '' },
    actorId,
  );

  const isMaker = permissions.includes('wallet.ipoint.adjust.maker');

  // Soft cap / evidence status is fetched from the market config so the
  // UI can show the blocked execution state (server remains the
  // authority). Defaults to "unknown" when config is not loadable.
  const [softCap, setSoftCap] = useState<string | undefined>(undefined);
  const [secureEvidence, setSecureEvidence] = useState(false);
  useEffect(() => {
    if (!marketId) return;
    void adminIpointAdjustOpsApi
      .getAdjustmentConfig(marketId)
      .then((config) => {
        setSoftCap(config.rule?.softCap);
        setSecureEvidence(config.rule?.secureEvidenceAvailable ?? false);
      })
      .catch(() => {
        // Read-only affordance; the server enforces the gate regardless.
      });
  }, [marketId]);

  const executionBlocked =
    request?.state === 'APPROVED' &&
    ipointAdjustmentExecutionBlocked({
      state: request.state,
      amount: request.amount,
      softCap,
      secureEvidenceAvailable: secureEvidence,
    });
  const aboveSoft =
    request !== undefined && softCap !== undefined
      ? ipointAdjustmentAboveSoftCap(request.amount, softCap)
      : false;

  async function ensureStepUp(action: 'DECIDE' | 'EXECUTE'): Promise<boolean> {
    if (stepUpToken) return true;
    if (!marketId || !requestId) return false;
    try {
      const started = await adminApi.beginStepUp({
        action_class:
          action === 'DECIDE'
            ? 'wallet.ipoint.adjust.checker'
            : 'wallet.ipoint.adjust.execute',
        market_id: marketId,
      });
      setStepUpChallenge(started.step_up_challenge_id);
      setPendingAction(action);
      return false;
    } catch (error: unknown) {
      setMessage({
        tone: 'error',
        text: describeIpointAdjustmentWriteError(error),
      });
      return false;
    }
  }

  async function verifyStepUp() {
    if (!stepUpChallenge || stepUpCode.trim().length !== 6) return;
    try {
      const verified = await adminApi.verifyStepUp({
        challenge_id: stepUpChallenge,
        code: stepUpCode.trim(),
      });
      setStepUpToken(verified.step_up_token);
      setStepUpChallenge(null);
      setStepUpCode('');
      // Resume the pending action with the fresh token.
      if (pendingAction === 'DECIDE')
        await submitDecision(verified.step_up_token);
      if (pendingAction === 'EXECUTE')
        await submitExecute(verified.step_up_token);
      setPendingAction(null);
    } catch (error: unknown) {
      setMessage({
        tone: 'error',
        text: describeIpointAdjustmentWriteError(error),
      });
    }
  }

  async function submitDecision(token: string | undefined) {
    if (!marketId || !requestId || !request) return;
    if (decisionDraft.reason.trim().length === 0) {
      setMessage({
        tone: 'error',
        text: 'A decision reason between 1 and 2000 characters is required.',
      });
      return;
    }
    if (ownRequest) {
      setMessage({
        tone: 'error',
        text: 'The checker must be a different administrator than the maker.',
      });
      return;
    }
    try {
      const key = undefined;
      void key;
      await adminIpointAdjustOpsApi.decideAdjustment(
        marketId,
        requestId,
        {
          decision: decisionDraft.decision,
          reason: decisionDraft.reason.trim(),
          requireAttachment: decisionDraft.requireAttachment,
        },
        token,
      );
      setMessage({
        tone: 'success',
        text: `Request ${decisionDraft.decision === 'APPROVED' ? 'approved' : 'rejected'}.`,
      });
      setDecisionDraft({
        decision: 'APPROVED',
        reason: '',
        requireAttachment: false,
      });
      await loadDetail();
    } catch (error: unknown) {
      setMessage({
        tone: 'error',
        text: describeIpointAdjustmentWriteError(error),
      });
    }
  }

  async function submitExecute(token: string | undefined) {
    if (!marketId || !requestId) return;
    try {
      await adminIpointAdjustOpsApi.executeAdjustment(
        marketId,
        requestId,
        token,
      );
      setMessage({ tone: 'success', text: 'Adjustment executed.' });
      await loadDetail();
    } catch (error: unknown) {
      setMessage({
        tone: 'error',
        text: describeIpointAdjustmentWriteError(error),
      });
    }
  }

  async function onDecide() {
    if (!marketId || !requestId || !request) return;
    if (request.state !== 'SUBMITTED') {
      setMessage({
        tone: 'error',
        text: 'Only SUBMITTED requests can be decided.',
      });
      return;
    }
    if (ownRequest) {
      setMessage({
        tone: 'error',
        text: 'The checker must be a different administrator than the maker.',
      });
      return;
    }
    if (decisionDraft.reason.trim().length === 0) {
      setMessage({
        tone: 'error',
        text: 'A decision reason between 1 and 2000 characters is required.',
      });
      return;
    }
    if (!(await ensureStepUp('DECIDE'))) return;
    await submitDecision(stepUpToken);
  }

  async function onExecute() {
    if (!marketId || !requestId || !request) return;
    if (request.state !== 'APPROVED') {
      setMessage({
        tone: 'error',
        text: 'Only APPROVED requests can be executed.',
      });
      return;
    }
    if (ownRequest) {
      setMessage({
        tone: 'error',
        text: 'The executor must be a different administrator than the maker.',
      });
      return;
    }
    if (executionBlocked) {
      setMessage({
        tone: 'error',
        text: 'Execution above the soft cap stays disabled until secure evidence storage is enabled for this market.',
      });
      return;
    }
    if (!(await ensureStepUp('EXECUTE'))) return;
    await submitExecute(stepUpToken);
  }

  async function onSubmit() {
    if (!marketId || !requestId || !request) return;
    if (request.state !== 'DRAFT') {
      setMessage({
        tone: 'error',
        text: 'Only DRAFT requests can be submitted.',
      });
      return;
    }
    try {
      await adminIpointAdjustOpsApi.submitAdjustment(marketId, requestId);
      setMessage({
        tone: 'success',
        text: 'Request submitted for checker review.',
      });
      await loadDetail();
    } catch (error: unknown) {
      setMessage({
        tone: 'error',
        text: describeIpointAdjustmentWriteError(error),
      });
    }
  }

  const showDecisionForm =
    load.status === 'ready' &&
    request?.state === 'SUBMITTED' &&
    canDecide &&
    !ownRequest;
  const showExecuteButton =
    load.status === 'ready' && request?.state === 'APPROVED' && canExecute;
  const showSubmitButton =
    load.status === 'ready' && request?.state === 'DRAFT' && isMaker;

  return (
    <div className="admin-page">
      <PageHeader
        title="Manual iPoint adjustment detail"
        description="Selected-market adjustment request with its evidence summary and immutable decision history. The maker submits; a different checker decides (step-up required); an approved request is executed by a checker. The frozen SEC-01 owner enforces caps routing, evidence rules, Maker≠Checker inequality and atomic ledger execution server-side."
      />

      {message ? (
        <IpointAdjustmentActionNotice tone={message.tone} text={message.text} />
      ) : null}

      {load.status === 'loading' ? <IpointAdjustmentSkeleton rows={3} /> : null}
      {load.status === 'error' ? (
        <IpointAdjustmentErrorState
          title={load.title}
          description={load.description}
          onRetry={retry}
        />
      ) : null}
      {load.status === 'ready' && !canDecide && !canExecute && !isMaker ? (
        <IpointAdjustmentPermissionDeniedState permission="wallet.ipoint.read" />
      ) : null}

      {load.status === 'ready' && request ? (
        <>
          <Card>
            <div
              className="admin-market-meta"
              data-testid="ipoint-detail-summary"
            >
              <p>
                <strong>State:</strong>{' '}
                <IpointAdjustmentStateBadge state={request.state} />
              </p>
              <p>
                <strong>Direction:</strong> {request.direction}
              </p>
              <p>
                <strong>Amount:</strong> {request.amount}
              </p>
              <p>
                <strong>Reason code:</strong> {request.reasonCode}
              </p>
              <p>
                <strong>Explanation:</strong> {request.explanation}
              </p>
              <p>
                <strong>Case reference:</strong> {request.caseReference}
              </p>
              <p>
                <strong>Attachment reference:</strong>{' '}
                {request.attachmentReference ?? '—'}{' '}
                <span className="admin-reward-muted">
                  (opaque; contents are never exposed)
                </span>
              </p>
              <p>
                <strong>Maker:</strong>{' '}
                <span className="admin-reward-muted">
                  {request.makerAdminUserId}
                </span>
              </p>
              <p>
                <strong>Checker:</strong>{' '}
                <span className="admin-reward-muted">
                  {request.checkerAdminUserId ?? '—'}
                </span>
              </p>
              <p>
                <strong>Created:</strong>{' '}
                <span className="admin-reward-muted">
                  {formatIpointUtc(request.createdAt)}
                </span>
              </p>
              {request.submittedAt ? (
                <p>
                  <strong>Submitted:</strong>{' '}
                  <span className="admin-reward-muted">
                    {formatIpointUtc(request.submittedAt)}
                  </span>
                </p>
              ) : null}
              {request.executedAt ? (
                <p>
                  <strong>Executed:</strong>{' '}
                  <span className="admin-reward-muted">
                    {formatIpointUtc(request.executedAt)}
                  </span>
                </p>
              ) : null}
              {request.failedAt ? (
                <p>
                  <strong>Failed:</strong>{' '}
                  <span className="admin-reward-muted">
                    {formatIpointUtc(request.failedAt)}
                  </span>
                </p>
              ) : null}
              {request.priorRequestId ? (
                <p>
                  <strong>Replacement of (prior rejected):</strong>{' '}
                  <span className="admin-reward-muted">
                    {request.priorRequestId}
                  </span>
                </p>
              ) : null}
              {request.ledgerEntryId ? (
                <p>
                  <strong>Ledger entry:</strong>{' '}
                  <span className="admin-reward-muted">
                    {request.ledgerEntryId}
                  </span>
                </p>
              ) : null}
              {aboveSoft ? (
                <p
                  className="admin-reward-muted"
                  data-testid="ipoint-above-soft-hint"
                >
                  This amount is above the market soft cap: a Super Admin
                  checker is required and execution stays disabled until secure
                  evidence storage is enabled.
                </p>
              ) : null}
            </div>
          </Card>

          <section aria-label="Actions">
            <h2 className="admin-reward-section">Actions</h2>
            <Card>
              {showSubmitButton ? (
                <Button variant="secondary" onClick={() => void onSubmit()}>
                  Submit for checker review (Maker)
                </Button>
              ) : null}
              {request.state === 'SUBMITTED' && !canDecide ? (
                <p className="admin-reward-muted">
                  This request awaits a checker with the
                  wallet.ipoint.adjust.checker permission.
                </p>
              ) : null}
              {request.state === 'SUBMITTED' && canDecide && ownRequest ? (
                <p className="admin-reward-muted" role="status">
                  You created this request, so you cannot be its checker.
                  Another administrator must decide it.
                </p>
              ) : null}
              {showDecisionForm ? (
                <div
                  className="admin-reward-form"
                  data-testid="ipoint-decision-form"
                >
                  <FormField label="Decision" htmlFor="ipoint-decision">
                    <select
                      id="ipoint-decision"
                      aria-label="Decision"
                      className="admin-reward-select"
                      value={decisionDraft.decision}
                      onChange={(event) =>
                        setDecisionDraft((current) => ({
                          ...current,
                          decision: event.target.value as
                            | 'APPROVED'
                            | 'REJECTED',
                        }))
                      }
                    >
                      <option value="APPROVED">Approve</option>
                      <option value="REJECTED">Reject</option>
                    </select>
                  </FormField>
                  <FormField
                    label="Decision reason (mandatory)"
                    htmlFor="ipoint-decision-reason"
                  >
                    <Input
                      id="ipoint-decision-reason"
                      aria-label="Decision reason"
                      placeholder="Evidence reviewed…"
                      value={decisionDraft.reason}
                      onChange={(event) =>
                        setDecisionDraft((current) => ({
                          ...current,
                          reason: event.target.value,
                        }))
                      }
                    />
                  </FormField>
                  <label className="admin-reward-muted">
                    <input
                      type="checkbox"
                      aria-label="Require attachment reference"
                      checked={decisionDraft.requireAttachment}
                      onChange={(event) =>
                        setDecisionDraft((current) => ({
                          ...current,
                          requireAttachment: event.target.checked,
                        }))
                      }
                    />{' '}
                    Require an opaque attachment reference
                  </label>
                  <Button variant="primary" onClick={() => void onDecide()}>
                    Record decision (Checker, step-up required)
                  </Button>
                </div>
              ) : null}
              {request.state === 'APPROVED' &&
              canExecute &&
              executionBlocked ? (
                <div data-testid="ipoint-execution-blocked">
                  <p className="admin-reward-muted" role="status">
                    Execution is blocked for this request: the amount is above
                    the soft cap and secure evidence storage is not enabled for
                    this market yet (P7-OD-11).
                  </p>
                  <Button variant="secondary" disabled>
                    Execute (blocked — secure evidence required)
                  </Button>
                </div>
              ) : null}
              {request.state === 'APPROVED' &&
              canExecute &&
              !executionBlocked ? (
                <Button variant="primary" onClick={() => void onExecute()}>
                  Execute adjustment (Checker, step-up required)
                </Button>
              ) : null}
              {request.state === 'APPROVED' && !canExecute ? (
                <p className="admin-reward-muted">
                  This request is approved and awaits a checker with the
                  wallet.ipoint.adjust.execute permission.
                </p>
              ) : null}
            </Card>
          </section>

          <section aria-label="Decision history">
            <h2 className="admin-reward-section">Decision history</h2>
            <Card>
              {decisions.length === 0 ? (
                <p className="admin-reward-muted">No decision recorded yet.</p>
              ) : (
                <ul className="admin-reward-list">
                  {decisions.map((decision) => (
                    <li
                      key={decision.id}
                      data-testid={`ipoint-decision-${decision.id}`}
                    >
                      <strong>{decision.decision}</strong> by{' '}
                      <span className="admin-reward-muted">
                        {decision.checkerAdminUserId}
                      </span>{' '}
                      at{' '}
                      <span className="admin-reward-muted">
                        {formatIpointUtc(decision.decidedAt)}
                      </span>
                      <br />
                      <span className="admin-reward-muted">
                        {decision.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </>
      ) : null}

      {stepUpChallenge ? (
        <Card>
          <div
            className="admin-reward-form"
            role="dialog"
            aria-label="MFA step-up verification"
          >
            <p className="admin-reward-muted">
              Verify your identity to continue this sensitive action.
            </p>
            <FormField label="Authentication code" htmlFor="ipoint-stepup-code">
              <Input
                id="ipoint-stepup-code"
                aria-label="Authentication code"
                value={stepUpCode}
                onChange={(event) => setStepUpCode(event.target.value)}
              />
            </FormField>
            <Button
              variant="primary"
              onClick={() => void verifyStepUp()}
              disabled={stepUpCode.trim().length !== 6}
            >
              Verify and continue
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

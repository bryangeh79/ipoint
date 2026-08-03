import {
  ApiError,
  type AdminStepUpChallengeDto,
  type AdminKycOpsCaseDetailDto,
  type AdminKycOpsMerchantDetailDto,
} from '@ipoint/api-client';
import { Alert, Button, FormField, Input, Textarea } from '@ipoint/ui';
import { useState } from 'react';
import { adminApi, adminKycOpsApi } from './admin-api.js';
import { evidenceReasonValid } from './kyc-model.js';

/**
 * P7-S5C evidence panel — the only place raw KYC evidence is requested.
 *
 * Gating (frozen contract §6.4): the recorded reason is required up front;
 * when the server answers 403 MFA_STEP_UP_REQUIRED the panel runs the MFA
 * step-up challenge/verify flow and retries with the fresh grant token. Every
 * successful view is audited server-side and the confirmation is surfaced.
 * Masked summaries stay visible; raw evidence is never persisted in the page
 * state beyond the current view.
 */

type EvidencePhase = 'idle' | 'loading' | 'stepup' | 'done';

interface EvidencePanelProps {
  permission: 'member.kyc.evidence.view' | 'merchant.kyc.evidence.view';
  marketId: string | undefined;
  fetchEvidence: (input: {
    reason: string;
    stepUpToken?: string;
  }) => Promise<AdminKycOpsCaseDetailDto | AdminKycOpsMerchantDetailDto>;
  /** True when the actor holds the evidence permission (server is authority). */
  permitted: boolean;
  /** Called with the server-confirmed evidence for the parent to display. */
  onLoaded: (
    evidence: AdminKycOpsCaseDetailDto | AdminKycOpsMerchantDetailDto,
  ) => void;
}

export function KycEvidencePanel({
  permission,
  marketId,
  fetchEvidence,
  permitted,
  onLoaded,
}: EvidencePanelProps) {
  const [phase, setPhase] = useState<EvidencePhase>('idle');
  const [reason, setReason] = useState('');
  const [challenge, setChallenge] = useState<AdminStepUpChallengeDto | null>(
    null,
  );
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  if (!permitted) {
    return (
      <p className="admin-kyc-evidence-locked" role="status">
        <strong>Raw evidence is locked.</strong> Viewing sensitive KYC evidence
        requires the <code>{permission}</code> permission, a recorded reason,
        and MFA step-up. Masked summaries remain available above.
      </p>
    );
  }

  async function requestEvidence(stepUpToken?: string) {
    const trimmed = reason.trim();
    if (!evidenceReasonValid(trimmed)) {
      setMessage({
        tone: 'error',
        text: 'Enter a recorded reason of at least 8 characters to view evidence.',
      });
      return;
    }
    setPhase('loading');
    setMessage(null);
    try {
      const evidence = await fetchEvidence({
        reason: trimmed,
        ...(stepUpToken ? { stepUpToken } : {}),
      });
      onLoaded(evidence);
      setPhase('done');
      setMessage({
        tone: 'success',
        text: 'Evidence shown. Every sensitive evidence view is recorded in the audit trail.',
      });
    } catch (error: unknown) {
      if (
        error instanceof ApiError &&
        error.body.code === 'MFA_STEP_UP_REQUIRED'
      ) {
        try {
          const started = await adminApi.beginStepUp({
            action_class: permission,
            ...(marketId ? { market_id: marketId } : {}),
          });
          setChallenge(started);
          setCode('');
          setPhase('stepup');
          setMessage(null);
        } catch (stepUpError: unknown) {
          setPhase('idle');
          setMessage({
            tone: 'error',
            text: describeEvidenceError(stepUpError),
          });
        }
        return;
      }
      setPhase('idle');
      setMessage({ tone: 'error', text: describeEvidenceError(error) });
    }
  }

  async function verifyAndRequest() {
    if (!challenge || code.trim().length !== 6) return;
    setVerifying(true);
    setMessage(null);
    try {
      const verified = await adminApi.verifyStepUp({
        challenge_id: challenge.step_up_challenge_id,
        code: code.trim(),
      });
      await requestEvidence(verified.step_up_token);
    } catch (error: unknown) {
      setMessage({ tone: 'error', text: describeEvidenceError(error) });
    } finally {
      setVerifying(false);
    }
  }

  function cancel() {
    setPhase('idle');
    setChallenge(null);
    setCode('');
    setMessage(null);
  }

  return (
    <div className="admin-kyc-evidence">
      {message ? (
        <Alert tone={message.tone} title="Evidence" role="status">
          {message.text}
        </Alert>
      ) : null}

      {phase === 'done' ? (
        <p className="admin-kyc-evidence-done" role="status">
          The full (minimum) evidence for this review is shown above. No raw
          document content is downloadable or exported from this surface.
        </p>
      ) : null}

      {phase === 'stepup' ? (
        <form
          className="admin-kyc-action__form"
          onSubmit={(event) => {
            event.preventDefault();
            void verifyAndRequest();
          }}
        >
          <FormField
            label="MFA verification code"
            htmlFor={`${permission}-code`}
          >
            <Input
              id={`${permission}-code`}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-required="true"
              maxLength={6}
            />
          </FormField>
          <p className="admin-kyc-muted">
            Verify your identity to unlock sensitive evidence. The grant is
            consumed by one view.
          </p>
          <div className="admin-kyc-action__buttons">
            <Button
              type="submit"
              disabled={verifying || code.trim().length !== 6}
            >
              {verifying ? 'Verifying…' : 'Verify and view evidence'}
            </Button>
            <Button variant="ghost" type="button" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {phase === 'idle' || phase === 'loading' ? (
        <form
          className="admin-kyc-action__form"
          onSubmit={(event) => {
            event.preventDefault();
            void requestEvidence();
          }}
        >
          <FormField
            label="Reason for viewing evidence (required, server-recorded)"
            htmlFor={`${permission}-reason`}
          >
            <Textarea
              id={`${permission}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              aria-required="true"
            />
          </FormField>
          <p className="admin-kyc-muted">
            Reason must be 8–500 characters. MFA step-up is required and every
            view is audited.
          </p>
          <div className="admin-kyc-action__buttons">
            <Button type="submit" disabled={phase === 'loading'}>
              {phase === 'loading' ? 'Requesting…' : 'View sensitive evidence'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function describeEvidenceError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.body.code) {
    case 'SENSITIVE_VIEW_REASON_REQUIRED':
      return 'A recorded reason of at least 8 characters is required.';
    case 'MFA_STEP_UP_REQUIRED':
      return 'MFA step-up is required to view sensitive evidence.';
    case 'MFA_CHALLENGE_FAILED':
      return 'The verification code was not accepted. Try again.';
    case 'PERMISSION_DENIED':
      return 'Your server permissions do not allow sensitive evidence.';
    case 'MARKET_CONTEXT_MISMATCH':
      return 'The selected market changed. Refresh and try again.';
    default:
      return `${error.body.message ?? error.message} (${error.body.code ?? 'unknown'})`;
  }
}

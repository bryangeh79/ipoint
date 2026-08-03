import {
  type AdminKycOpsActionId,
  type AdminKycOpsCaseDetailDto,
} from '@ipoint/api-client';
import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  PageHeader,
  Table,
  Textarea,
} from '@ipoint/ui';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminKycOpsApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import { formatTimestamp } from './dashboard-model.js';
import { KycEvidencePanel } from './kyc-evidence-panel.js';
import {
  evidenceGate,
  kycErrorCopy,
  memberKycActions,
  type MemberKycActionId,
} from './kyc-model.js';
import { KycStatusBadge, MemberKycActionUnavailable } from './kyc-states.js';
import {
  canPerformSensitiveAdminWrite,
  useAdminWriteEnvironment,
} from './pwa-policy.js';
import { ShellState } from './shell-states.js';

/**
 * P7-S5C selected-market member KYC case detail.
 *
 * Masked identity/contact summary, document metadata (no content), review
 * history, review actions delegated to the frozen Phase 2 owner commands
 * (reason + idempotency key), and the gated evidence panel (§6.4: dedicated
 * permission + recorded reason + MFA step-up + audit-of-view). The full
 * (minimum) evidence is only ever shown after a successful evidence request;
 * the default view stays masked.
 */

type DetailErrorKind = 'error' | 'permission-denied' | 'conflict' | 'disabled';

type DetailLoad =
  | { status: 'loading' }
  | { status: 'ready'; detail: AdminKycOpsCaseDetailDto }
  | {
      status: 'error';
      kind: DetailErrorKind;
      title: string;
      description: string;
    };

function detailError(error: unknown): DetailLoad {
  const copy = kycErrorCopy(error);
  const kind: DetailErrorKind = copy.title.includes('Permission denied')
    ? 'permission-denied'
    : copy.title.includes('outside the selected market') ||
        copy.title.includes('state conflict')
      ? 'conflict'
      : copy.title.includes('No Current Admin Market')
        ? 'disabled'
        : 'error';
  return {
    status: 'error',
    kind,
    title: copy.title,
    description: copy.description,
  };
}

export function MemberKycDetailPage() {
  const session = useAdminSession();
  const marketId = session.bootstrap?.currentMarket?.id;
  const { caseId } = useParams();
  const environment = useAdminWriteEnvironment();
  const [load, setLoad] = useState<DetailLoad>({ status: 'loading' });
  const [requestKey, setRequestKey] = useState(0);
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [evidenceDetail, setEvidenceDetail] =
    useState<AdminKycOpsCaseDetailDto | null>(null);

  const permissions = session.bootstrap?.effectivePermissions ?? [];
  const canWrite = canPerformSensitiveAdminWrite(environment);

  useEffect(() => {
    if (!marketId || !caseId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    adminKycOpsApi
      .memberKycDetail(caseId)
      .then((detail) => {
        if (!cancelled) setLoad({ status: 'ready', detail });
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoad(detailError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, caseId, requestKey]);

  const retry = useCallback(() => setRequestKey((key) => key + 1), []);

  const actions = useMemo(
    () =>
      load.status === 'ready'
        ? memberKycActions(load.detail, permissions, environment)
        : [],
    [load, permissions, environment],
  );

  const gate = useMemo(
    () => evidenceGate(permissions, 'member.kyc.evidence.view'),
    [permissions],
  );

  const onUpdated = useCallback((message: string) => {
    setFeedback({ ok: true, message });
    setRequestKey((key) => key + 1);
  }, []);

  const onActionError = useCallback((error: unknown) => {
    const copy = kycErrorCopy(error);
    setFeedback({ ok: false, message: `${copy.title}: ${copy.description}` });
  }, []);

  if (load.status === 'loading') {
    return (
      <section aria-labelledby="admin-kyc-member-detail-title">
        <ShellState kind="loading" />
      </section>
    );
  }

  if (load.status === 'error') {
    return (
      <section aria-labelledby="admin-kyc-member-detail-title">
        <ShellState
          kind={load.kind}
          title={load.title}
          description={load.description}
          action={
            load.kind === 'error' ? (
              <Button onClick={retry}>Retry KYC case</Button>
            ) : undefined
          }
        />
      </section>
    );
  }

  const detail = load.detail;
  // Full identity fields are shown ONLY from the audited evidence response.
  const shown = evidenceDetail ?? detail;

  return (
    <section
      aria-labelledby="admin-kyc-member-detail-title"
      className="admin-kyc-member-detail"
    >
      <PageHeader
        eyebrow="Reviews"
        title={
          <span id="admin-kyc-member-detail-title">
            Member KYC case {detail.id.slice(0, 8)}
          </span>
        }
        description={`Member ${detail.member.publicMemberId} · ${
          session.bootstrap?.currentMarket?.name ?? 'the selected market'
        }. Identity fields are masked by default; raw evidence requires a recorded reason and MFA step-up, and every view is audited.`}
        actions={<KycStatusBadge status={detail.status} />}
      />

      {feedback ? (
        <Alert
          tone={feedback.ok ? 'success' : 'error'}
          title={feedback.ok ? 'Request completed' : 'Request failed'}
          role="status"
        >
          {feedback.message}
        </Alert>
      ) : null}

      <Card
        className="admin-kyc-section"
        aria-labelledby="admin-kyc-member-summary-heading"
      >
        <h2 id="admin-kyc-member-summary-heading">
          Identity summary
          {evidenceDetail ? (
            <Badge tone="warning">Full evidence shown</Badge>
          ) : (
            <Badge tone="neutral">Masked</Badge>
          )}
        </h2>
        <dl className="admin-kyc-facts">
          <div>
            <dt>Email</dt>
            <dd>{detail.member.email}</dd>
          </div>
          <div>
            <dt>Legal full name</dt>
            <dd>{shown.legalFullName ?? 'Not provided'}</dd>
          </div>
          <div>
            <dt>Identification</dt>
            <dd>
              {shown.identificationType ?? 'Not provided'} ·{' '}
              {shown.identificationNumber ?? 'Not provided'}
            </dd>
          </div>
          <div>
            <dt>Date of birth</dt>
            <dd>{shown.dateOfBirth ?? 'Not shown'}</dd>
          </div>
          <div>
            <dt>Nationality</dt>
            <dd>{shown.nationality ?? 'Not provided'}</dd>
          </div>
          <div>
            <dt>Residential address</dt>
            <dd>
              {shown.residentialAddress
                ? JSON.stringify(shown.residentialAddress)
                : 'Not shown'}
            </dd>
          </div>
          <div>
            <dt>Account country snapshot</dt>
            <dd>{shown.accountCountrySnapshot ?? 'Not provided'}</dd>
          </div>
          <div>
            <dt>Level requested</dt>
            <dd>{shown.levelRequested}</dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>
              <time dateTime={shown.submittedAt ?? ''}>
                {shown.submittedAt ? formatTimestamp(shown.submittedAt) : '—'}
              </time>
            </dd>
          </div>
          <div>
            <dt>Reviewed</dt>
            <dd>
              <time dateTime={shown.reviewedAt ?? ''}>
                {shown.reviewedAt ? formatTimestamp(shown.reviewedAt) : '—'}
              </time>
            </dd>
          </div>
          {shown.decisionReason ? (
            <div>
              <dt>Decision reason</dt>
              <dd>{shown.decisionReason}</dd>
            </div>
          ) : null}
        </dl>
        <p className="admin-kyc-muted">
          {evidenceDetail
            ? 'Minimum evidence shown for this review after a recorded reason and MFA step-up; the view is in the audit trail.'
            : 'Masked summary. Use the evidence panel below to view the minimum evidence when you need it.'}
        </p>
      </Card>

      <Card
        className="admin-kyc-section"
        aria-labelledby="admin-kyc-documents-heading"
      >
        <h2 id="admin-kyc-documents-heading">Submitted documents</h2>
        {detail.documents.length === 0 ? (
          <p className="admin-kyc-muted">No document metadata recorded.</p>
        ) : (
          <Table aria-label="Document metadata">
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">MIME</th>
                <th scope="col">Size</th>
                <th scope="col">Scan</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {detail.documents.map((document) => (
                <tr key={document.id}>
                  <td>{document.documentType}</td>
                  <td>{document.mimeType}</td>
                  <td>{document.size} bytes</td>
                  <td>{document.scanStatus}</td>
                  <td>
                    <time dateTime={document.createdAt}>
                      {formatTimestamp(document.createdAt)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="admin-kyc-muted">
          Metadata only — document content is never served or downloadable on
          this surface.
        </p>
      </Card>

      <Card
        className="admin-kyc-section"
        aria-labelledby="admin-kyc-history-heading"
      >
        <h2 id="admin-kyc-history-heading">Case history</h2>
        {detail.history.length === 0 ? (
          <p className="admin-kyc-muted">No recorded case events.</p>
        ) : (
          <Table aria-label="KYC case history">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Actor</th>
                <th scope="col">Summary</th>
                <th scope="col">Occurred</th>
              </tr>
            </thead>
            <tbody>
              {detail.history.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <Badge tone="neutral">{entry.eventType}</Badge>
                  </td>
                  <td>
                    {entry.actorType}
                    {entry.actorId ? ` · ${entry.actorId}` : ''}
                  </td>
                  <td>{entry.summary}</td>
                  <td>
                    <time dateTime={entry.occurredAt}>
                      {formatTimestamp(entry.occurredAt)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card
        className="admin-kyc-section"
        aria-labelledby="admin-kyc-actions-heading"
      >
        <h2 id="admin-kyc-actions-heading">Review actions</h2>
        {!canWrite ? (
          <Alert tone="warning" title="Read-only environment" role="status">
            Review actions require the online desktop Admin Web (not the
            read-only PWA). No write was queued or replayed.
          </Alert>
        ) : null}
        <div className="admin-kyc-actions">
          {actions.map((state) =>
            state.available ? (
              <MemberKycActionForm
                key={state.id}
                actionId={state.id}
                label={state.label}
                caseId={detail.id}
                onUpdated={onUpdated}
                onError={onActionError}
              />
            ) : (
              <MemberKycActionUnavailable key={state.id} state={state} />
            ),
          )}
        </div>
      </Card>

      <Card
        className="admin-kyc-section"
        aria-labelledby="admin-kyc-evidence-heading"
      >
        <h2 id="admin-kyc-evidence-heading">Sensitive evidence</h2>
        <p className="admin-kyc-muted">
          Full identity and document metadata for this review are behind a
          dedicated permission, a recorded reason, MFA step-up, and an audit
          record for every view. No raw export exists.
        </p>
        <KycEvidencePanel
          permission="member.kyc.evidence.view"
          marketId={marketId}
          permitted={gate.allowed}
          onLoaded={(evidence) =>
            setEvidenceDetail(evidence as AdminKycOpsCaseDetailDto)
          }
          fetchEvidence={(input) =>
            adminKycOpsApi.memberKycEvidence(caseId ?? '', input)
          }
        />
      </Card>
    </section>
  );
}

interface MemberKycActionFormProps {
  actionId: MemberKycActionId;
  label: string;
  caseId: string;
  onUpdated: (message: string) => void;
  onError: (error: unknown) => void;
}

function MemberKycActionForm({
  actionId,
  label,
  caseId,
  onUpdated,
  onError,
}: MemberKycActionFormProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const reasonId = useId();

  function submit() {
    if (!reason.trim()) return;
    setSubmitting(true);
    adminKycOpsApi
      .memberKycAction(
        caseId,
        actionId as AdminKycOpsActionId,
        { reason: reason.trim() },
        idempotencyKey,
      )
      .then(() => {
        setSubmitting(false);
        setOpen(false);
        setReason('');
        setIdempotencyKey(crypto.randomUUID());
        onUpdated(
          `${label} completed. The server confirmed the new state and recorded the audit entry.`,
        );
      })
      .catch((error: unknown) => {
        setSubmitting(false);
        onError(error);
      });
  }

  return (
    <div className="admin-kyc-action">
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {label}
        </Button>
      ) : (
        <form
          className="admin-kyc-action__form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormField
            label="Reason (required, server-recorded)"
            htmlFor={reasonId}
          >
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              aria-required="true"
            />
          </FormField>
          <p className="admin-kyc-muted">
            Retries reuse the same idempotency key; a new key is issued only
            after the server confirms the outcome.
          </p>
          <div className="admin-kyc-action__buttons">
            <Button type="submit" disabled={submitting || !reason.trim()}>
              {submitting ? 'Submitting…' : label}
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setOpen(false);
                setReason('');
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

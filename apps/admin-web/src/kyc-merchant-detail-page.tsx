import {
  type AdminKycOpsMerchantDetailDto,
  type AdminKycOpsMerchantReviewDecision,
} from '@ipoint/api-client';
import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  Select,
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
  merchantKycActions,
  type MerchantKycActionState,
} from './kyc-model.js';
import {
  MerchantKycActionUnavailable,
  MerchantKycStatusBadge,
} from './kyc-states.js';
import {
  canPerformSensitiveAdminWrite,
  useAdminWriteEnvironment,
} from './pwa-policy.js';
import { ShellState } from './shell-states.js';

/**
 * P7-S5C selected-market merchant KYC submission detail.
 *
 * Masked submission snapshot (owner mask helper), review metadata, review
 * decision (approve / reject / resubmission with rejected fields) delegated
 * to the frozen Phase 1 owner command, and the gated evidence panel (§6.4).
 */

type DetailErrorKind = 'error' | 'permission-denied' | 'conflict' | 'disabled';

type DetailLoad =
  | { status: 'loading' }
  | { status: 'ready'; detail: AdminKycOpsMerchantDetailDto }
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
    : copy.title.includes('outside the selected market')
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

type BusinessData = Record<string, string | undefined>;
type IdentityData = Record<string, string | undefined>;
type ContactData = Record<string, string | undefined>;

export function MerchantKycDetailPage() {
  const session = useAdminSession();
  const marketId = session.bootstrap?.currentMarket?.id;
  const { branchId } = useParams();
  const environment = useAdminWriteEnvironment();
  const [load, setLoad] = useState<DetailLoad>({ status: 'loading' });
  const [requestKey, setRequestKey] = useState(0);
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [evidenceDetail, setEvidenceDetail] =
    useState<AdminKycOpsMerchantDetailDto | null>(null);

  const permissions = session.bootstrap?.effectivePermissions ?? [];
  const canWrite = canPerformSensitiveAdminWrite(environment);

  useEffect(() => {
    if (!marketId || !branchId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    adminKycOpsApi
      .merchantKycDetail(branchId)
      .then((detail) => {
        if (!cancelled) setLoad({ status: 'ready', detail });
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoad(detailError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, branchId, requestKey]);

  const retry = useCallback(() => setRequestKey((key) => key + 1), []);

  const actions = useMemo(
    () =>
      load.status === 'ready'
        ? merchantKycActions(
            load.detail.current.status,
            permissions,
            environment,
          )
        : [],
    [load, permissions, environment],
  );

  const gate = useMemo(
    () => evidenceGate(permissions, 'merchant.kyc.evidence.view'),
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
      <section aria-labelledby="admin-kyc-merchant-detail-title">
        <ShellState kind="loading" />
      </section>
    );
  }

  if (load.status === 'error') {
    return (
      <section aria-labelledby="admin-kyc-merchant-detail-title">
        <ShellState
          kind={load.kind}
          title={load.title}
          description={load.description}
          action={
            load.kind === 'error' ? (
              <Button onClick={retry}>Retry submission</Button>
            ) : undefined
          }
        />
      </section>
    );
  }

  const detail = load.detail;
  const current = evidenceDetail?.current ?? detail.current;

  return (
    <section
      aria-labelledby="admin-kyc-merchant-detail-title"
      className="admin-kyc-merchant-detail"
    >
      <PageHeader
        eyebrow="Reviews"
        title={
          <span id="admin-kyc-merchant-detail-title">
            {detail.display_name}
          </span>
        }
        description={`Merchant KYC submission ${current.submission_id.slice(0, 8)} (v${current.submission_version}) · ${
          session.bootstrap?.currentMarket?.name ?? 'the selected market'
        }. Submission data is masked by default; raw evidence requires a recorded reason and MFA step-up, and every view is audited.`}
        actions={<MerchantKycStatusBadge status={current.status} />}
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
        aria-labelledby="admin-kyc-merchant-submission-heading"
      >
        <h2 id="admin-kyc-merchant-submission-heading">
          Submission snapshot
          {evidenceDetail ? (
            <Badge tone="warning">Full evidence shown</Badge>
          ) : (
            <Badge tone="neutral">Masked</Badge>
          )}
        </h2>
        <MerchantSnapshot data={current.data} />
        <p className="admin-kyc-muted">
          {evidenceDetail
            ? 'Minimum evidence shown after a recorded reason and MFA step-up; the view is in the audit trail.'
            : 'Masked by the owner masking rules. Use the evidence panel below when the full snapshot is needed.'}
        </p>
      </Card>

      {current.review ? (
        <Card
          className="admin-kyc-section"
          aria-labelledby="admin-kyc-merchant-review-heading"
        >
          <h2 id="admin-kyc-merchant-review-heading">Review decision</h2>
          <dl className="admin-kyc-facts">
            <div>
              <dt>Decision</dt>
              <dd>
                <MerchantKycStatusBadge status={current.review.decision} />
              </dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd>{current.review.reason}</dd>
            </div>
            <div>
              <dt>Rejected fields</dt>
              <dd>
                {current.review.rejected_fields.length > 0
                  ? current.review.rejected_fields.join(', ')
                  : 'None'}
              </dd>
            </div>
            <div>
              <dt>Reviewed</dt>
              <dd>
                <time dateTime={current.review.reviewed_at ?? ''}>
                  {current.review.reviewed_at
                    ? formatTimestamp(current.review.reviewed_at)
                    : '—'}
                </time>
              </dd>
            </div>
            <div>
              <dt>Reviewer</dt>
              <dd>{current.review.reviewer_id}</dd>
            </div>
          </dl>
        </Card>
      ) : null}

      <Card
        className="admin-kyc-section"
        aria-labelledby="admin-kyc-merchant-actions-heading"
      >
        <h2 id="admin-kyc-merchant-actions-heading">Review actions</h2>
        {!canWrite ? (
          <Alert tone="warning" title="Read-only environment" role="status">
            Review actions require the online desktop Admin Web (not the
            read-only PWA). No write was queued or replayed.
          </Alert>
        ) : null}
        <div className="admin-kyc-actions">
          {actions.map((state) =>
            state.available ? (
              <MerchantKycActionForm
                key={state.id}
                state={state}
                branchId={detail.branch_id}
                onUpdated={onUpdated}
                onError={onActionError}
              />
            ) : (
              <MerchantKycActionUnavailable key={state.id} state={state} />
            ),
          )}
        </div>
      </Card>

      <Card
        className="admin-kyc-section"
        aria-labelledby="admin-kyc-merchant-evidence-heading"
      >
        <h2 id="admin-kyc-merchant-evidence-heading">Sensitive evidence</h2>
        <p className="admin-kyc-muted">
          The full submission snapshot is behind a dedicated permission, a
          recorded reason, MFA step-up, and an audit record for every view. No
          raw export exists.
        </p>
        <KycEvidencePanel
          permission="merchant.kyc.evidence.view"
          marketId={marketId}
          permitted={gate.allowed}
          onLoaded={(evidence) =>
            setEvidenceDetail(evidence as AdminKycOpsMerchantDetailDto)
          }
          fetchEvidence={(input) =>
            adminKycOpsApi.merchantKycEvidence(branchId ?? '', input)
          }
        />
      </Card>
    </section>
  );
}

function MerchantSnapshot({ data }: { data: Record<string, unknown> }) {
  const business = (data['business_certification'] ?? {}) as BusinessData;
  const identity = (data['pic_identity'] ?? {}) as IdentityData;
  const contact = (data['pic_contact'] ?? {}) as ContactData;
  return (
    <dl className="admin-kyc-facts">
      <div>
        <dt>Registered business name</dt>
        <dd>{business['business_name_registered'] ?? 'Not provided'}</dd>
      </div>
      <div>
        <dt>Registration number</dt>
        <dd>{business['registration_number'] ?? 'Not provided'}</dd>
      </div>
      <div>
        <dt>Business type</dt>
        <dd>{business['business_type'] ?? 'Not provided'}</dd>
      </div>
      <div>
        <dt>Tax id</dt>
        <dd>{business['tax_id'] ?? 'Not provided'}</dd>
      </div>
      <div>
        <dt>Registered address</dt>
        <dd>{business['registered_address'] ?? 'Not provided'}</dd>
      </div>
      <div>
        <dt>PIC full name</dt>
        <dd>{identity['full_name'] ?? 'Not provided'}</dd>
      </div>
      <div>
        <dt>PIC identity</dt>
        <dd>
          {identity['identity_type'] ?? 'Not provided'} ·{' '}
          {identity['identity_number'] ?? 'Not provided'}
        </dd>
      </div>
      <div>
        <dt>PIC date of birth</dt>
        <dd>{identity['date_of_birth'] ?? 'Not provided'}</dd>
      </div>
      <div>
        <dt>PIC nationality</dt>
        <dd>{identity['nationality'] ?? 'Not provided'}</dd>
      </div>
      <div>
        <dt>Contact email</dt>
        <dd>{contact['email'] ?? 'Not provided'}</dd>
      </div>
      <div>
        <dt>Contact phone</dt>
        <dd>{contact['phone'] ?? 'Not provided'}</dd>
      </div>
    </dl>
  );
}

interface MerchantKycActionFormProps {
  state: MerchantKycActionState;
  branchId: string;
  onUpdated: (message: string) => void;
  onError: (error: unknown) => void;
}

function MerchantKycActionForm({
  state,
  branchId,
  onUpdated,
  onError,
}: MerchantKycActionFormProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [rejectedFields, setRejectedFields] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const reasonId = useId();
  const fieldsId = useId();

  const decision: AdminKycOpsMerchantReviewDecision =
    state.id === 'approve'
      ? 'APPROVED'
      : state.id === 'reject'
        ? 'REJECTED'
        : 'RESUBMISSION_REQUIRED';

  function submit() {
    if (!reason.trim()) return;
    if (decision === 'RESUBMISSION_REQUIRED' && !rejectedFields.trim()) return;
    setSubmitting(true);
    const rejected = rejectedFields
      .split(',')
      .map((field) => field.trim())
      .filter((field) => field.length > 0);
    adminKycOpsApi
      .merchantKycReview(
        branchId,
        {
          decision,
          reason: reason.trim(),
          rejected_fields: rejected,
        },
        idempotencyKey,
      )
      .then(() => {
        setSubmitting(false);
        setOpen(false);
        setReason('');
        setRejectedFields('');
        setIdempotencyKey(crypto.randomUUID());
        onUpdated(
          `${state.label} completed. The server confirmed the decision and recorded the audit entry.`,
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
          {state.label}
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
              maxLength={2000}
              rows={3}
              aria-required="true"
            />
          </FormField>
          {decision === 'RESUBMISSION_REQUIRED' ? (
            <FormField
              label="Rejected fields (comma separated, at least one required)"
              htmlFor={fieldsId}
            >
              <Input
                id={fieldsId}
                value={rejectedFields}
                onChange={(event) => setRejectedFields(event.target.value)}
                aria-required="true"
              />
            </FormField>
          ) : null}
          <p className="admin-kyc-muted">
            Retries reuse the same idempotency key; a new key is issued only
            after the server confirms the outcome.
          </p>
          <div className="admin-kyc-action__buttons">
            <Button
              type="submit"
              disabled={
                submitting ||
                !reason.trim() ||
                (decision === 'RESUBMISSION_REQUIRED' && !rejectedFields.trim())
              }
            >
              {submitting ? 'Submitting…' : state.label}
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setOpen(false);
                setReason('');
                setRejectedFields('');
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

export function rejectedFieldOptions(): ReadonlyArray<string> {
  return [
    'business_certification.registration_number',
    'business_certification.tax_id',
    'pic_identity.full_name',
    'pic_identity.identity_number',
    'pic_identity.date_of_birth',
    'pic_contact.email',
    'pic_contact.phone',
  ];
}

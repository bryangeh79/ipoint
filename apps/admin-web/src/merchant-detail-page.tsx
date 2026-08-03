import {
  createIdempotencyKey,
  type AdminMerchantBranchDetailDto,
  type AdminMerchantReviewDecision,
} from '@ipoint/api-client';
import {
  Badge,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  Select,
  Table,
  Textarea,
} from '@ipoint/ui';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminMerchantApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import {
  describeMerchantActionError,
  describeMerchantReadError,
  formatMerchantTimestamp,
  merchantActionAvailability,
  merchantApplicationStatusLabel,
  merchantKycStatusLabel,
  merchantOperationalStatusLabel,
  merchantPackageStatusLabel,
  merchantReviewDecisionOptions,
} from './merchant-model.js';
import {
  MerchantActionSuccessBanner,
  MerchantClosedBanner,
  MerchantConflictBanner,
  MerchantEmptyState,
  MerchantErrorState,
  MerchantListSkeleton,
  MerchantSuspendedBanner,
} from './merchant-states.js';

/**
 * P7-S5B selected-market merchant branch detail page.
 *
 * Reads the Phase 7 branch-detail adapter (profile, application, owner-masked
 * KYC, read-only package history, MCP summary) and exposes the approved
 * owner status commands (application review, KYC review, suspend/reactivate/
 * close). The market is the server-owned Current Admin Market; the URL
 * market is validated server-side (409 on mismatch). Sensitive KYC evidence
 * is rendered exactly as the owner masked it — raw documents and raw ledger
 * exports are never exposed here.
 */

type DetailLoad =
  | { status: 'loading' }
  | { status: 'ready'; detail: AdminMerchantBranchDetailDto }
  | { status: 'error'; title: string; description: string };

export function useMerchantBranchDetail(
  marketId: string | undefined,
  branchId: string | undefined,
  refreshKey = 0,
): { load: DetailLoad; retry: () => void } {
  const [load, setLoad] = useState<DetailLoad>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!marketId || !branchId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    adminMerchantApi
      .merchantBranchDetail(marketId, branchId)
      .then((detail) => {
        if (!cancelled) setLoad({ status: 'ready', detail });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const described = describeMerchantReadError(error);
          setLoad({
            status: 'error',
            title: described.title,
            description: described.description,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, branchId, retryKey, refreshKey]);

  const retry = useCallback(() => setRetryKey((key) => key + 1), []);
  return { load, retry };
}

export function MerchantDetailPage() {
  const session = useAdminSession();
  const { marketId, branchId } = useParams<{
    marketId: string;
    branchId: string;
  }>();
  const [refreshKey, setRefreshKey] = useState(0);
  const { load, retry } = useMerchantBranchDetail(
    marketId,
    branchId,
    refreshKey,
  );
  const [notice, setNotice] = useState<string | null>(null);

  const detail = load.status === 'ready' ? load.detail : null;
  const permissions = session.bootstrap?.effectivePermissions ?? [];

  const handleCompleted = useCallback((message: string) => {
    setNotice(message);
    // Keep the notice across the refetch: load flips to 'loading' and back.
    setRefreshKey((key) => key + 1);
  }, []);

  const availability = detail
    ? merchantActionAvailability(detail, permissions)
    : null;

  return (
    <section
      aria-labelledby="admin-merchant-detail-title"
      className="admin-merchant-detail"
    >
      <PageHeader
        eyebrow="Commerce"
        title={
          <span id="admin-merchant-detail-title">
            {detail?.profile.display_name ?? 'Merchant detail'}
          </span>
        }
        description={
          detail
            ? `Branch ${detail.profile.display_name} in ${
                session.bootstrap?.currentMarket?.name ?? 'the current market'
              }. All values are server-owned reads; KYC evidence is masked.`
            : 'Loading the selected-market merchant branch detail.'
        }
      />

      {load.status === 'loading' ? <MerchantListSkeleton rows={6} /> : null}

      {load.status === 'error' ? (
        <MerchantErrorState
          title={load.title}
          description={load.description}
          onRetry={retry}
        />
      ) : null}

      {detail ? (
        <>
          {detail.application.operational_status === 'SUSPENDED' ? (
            <MerchantSuspendedBanner />
          ) : null}
          {detail.application.operational_status === 'CLOSED' ? (
            <MerchantClosedBanner />
          ) : null}
          {notice ? <MerchantActionSuccessBanner message={notice} /> : null}

          <div className="admin-merchant-detail-grid">
            <StatusCard detail={detail} />
            <ProfileCard detail={detail} />
            <ApplicationCard detail={detail} />
            <KycCard detail={detail} />
            <PackageHistoryCard detail={detail} />
            <McpCard detail={detail} />
          </div>

          {availability ? (
            <ActionsCard
              detail={detail}
              availability={availability}
              onCompleted={handleCompleted}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function StatusCard({ detail }: { detail: AdminMerchantBranchDetailDto }) {
  const kycStatus =
    detail.kyc.current !== null && typeof detail.kyc.current === 'object'
      ? String((detail.kyc.current as { status?: unknown }).status ?? '')
      : '';
  return (
    <Card className="admin-merchant-section">
      <h2>Status</h2>
      <dl className="admin-merchant-definition">
        <div>
          <dt>Operational status</dt>
          <dd>
            <Badge
              tone={operationalBadgeTone(detail.application.operational_status)}
            >
              {merchantOperationalStatusLabel(
                detail.application.operational_status,
              )}
            </Badge>
          </dd>
        </div>
        <div>
          <dt>Application status</dt>
          <dd>{merchantApplicationStatusLabel(detail.application.status)}</dd>
        </div>
        <div>
          <dt>KYC status</dt>
          <dd>{kycStatus ? merchantKycStatusLabel(kycStatus) : '—'}</dd>
        </div>
        <div>
          <dt>Merchant id</dt>
          <dd>
            <code>{detail.merchant_id}</code>
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function ProfileCard({ detail }: { detail: AdminMerchantBranchDetailDto }) {
  const profile = detail.profile;
  return (
    <Card className="admin-merchant-section">
      <h2>Profile</h2>
      <dl className="admin-merchant-definition">
        <div>
          <dt>Display name</dt>
          <dd>{profile.display_name}</dd>
        </div>
        <div>
          <dt>Primary email</dt>
          <dd>{profile.primary_email}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{profile.phone ?? '—'}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>{profile.address ?? '—'}</dd>
        </div>
        <div>
          <dt>Website</dt>
          <dd>{profile.website ?? '—'}</dd>
        </div>
        <div>
          <dt>WhatsApp</dt>
          <dd>{profile.whatsapp ?? '—'}</dd>
        </div>
        <div>
          <dt>Business hours</dt>
          <dd>{profile.business_hours ?? '—'}</dd>
        </div>
      </dl>
    </Card>
  );
}

function ApplicationCard({ detail }: { detail: AdminMerchantBranchDetailDto }) {
  const application = detail.application;
  return (
    <Card className="admin-merchant-section">
      <h2>Application</h2>
      <p className="admin-merchant-section__description">
        Status {merchantApplicationStatusLabel(application.status)}. Review
        history is immutable owner evidence.
      </p>
      {application.reviews.length === 0 ? (
        <p className="admin-merchant-empty-inline">
          No review has been recorded for this application.
        </p>
      ) : (
        <Table aria-label="Application review history">
          <thead>
            <tr>
              <th scope="col">Decision</th>
              <th scope="col">Reason</th>
              <th scope="col">Decided</th>
            </tr>
          </thead>
          <tbody>
            {application.reviews.map((review) => (
              <tr key={review.id}>
                <td>{merchantApplicationStatusLabel(review.decision)}</td>
                <td>{review.reason}</td>
                <td>{formatMerchantTimestamp(String(review.decided_at))}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function KycCard({ detail }: { detail: AdminMerchantBranchDetailDto }) {
  const current = detail.kyc.current as {
    status?: unknown;
    data?: Record<string, unknown>;
  } | null;
  if (!current) {
    return (
      <Card className="admin-merchant-section">
        <h2>KYC</h2>
        <p className="admin-merchant-empty-inline">
          No KYC submission has been recorded for this branch.
        </p>
      </Card>
    );
  }
  const data = current.data ?? {};
  const business = data.business_certification as
    | Record<string, unknown>
    | undefined;
  const picIdentity = data.pic_identity as Record<string, unknown> | undefined;
  const picContact = data.pic_contact as Record<string, unknown> | undefined;
  return (
    <Card className="admin-merchant-section">
      <h2>KYC</h2>
      <p className="admin-merchant-section__description">
        Status {merchantKycStatusLabel(String(current.status ?? ''))}. Sensitive
        evidence is masked exactly as the owner returned it; raw documents
        require the dedicated KYC reviewer surface and permission.
      </p>
      <dl className="admin-merchant-definition">
        <div>
          <dt>Business registration</dt>
          <dd>
            {typeof business?.registration_number === 'string'
              ? business.registration_number
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Tax id</dt>
          <dd>
            {typeof business?.tax_id === 'string' ? business.tax_id : '—'}
          </dd>
        </div>
        <div>
          <dt>PIC identity number</dt>
          <dd>
            {typeof picIdentity?.identity_number === 'string'
              ? picIdentity.identity_number
              : '—'}
          </dd>
        </div>
        <div>
          <dt>PIC phone</dt>
          <dd>
            {typeof picContact?.phone === 'string' ? picContact.phone : '—'}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function PackageHistoryCard({
  detail,
}: {
  detail: AdminMerchantBranchDetailDto;
}) {
  const packages = detail.packages;
  return (
    <Card className="admin-merchant-section">
      <h2>Package history</h2>
      <p className="admin-merchant-section__description">
        Read-only projection of immutable owner assignment history. New
        assignments are made only through the owner package commands
        (merchant.package.assign); no automatic migration exists.
      </p>
      {packages.items.length === 0 ? (
        <p className="admin-merchant-empty-inline">
          No package assignment history for this branch.
        </p>
      ) : (
        <Table aria-label="Merchant package assignment history">
          <thead>
            <tr>
              <th scope="col">Package</th>
              <th scope="col">Rate</th>
              <th scope="col">Status</th>
              <th scope="col">Default</th>
              <th scope="col">Version</th>
              <th scope="col">Assigned</th>
            </tr>
          </thead>
          <tbody>
            {packages.items.map((item) => (
              <tr key={item.assignment_id}>
                <td>
                  {item.service_fee_profile_name ??
                    item.service_fee_profile_code ??
                    '—'}
                  {item.special_percentage_rate !== null ? (
                    <Badge tone="info">
                      Special {item.special_percentage_rate}
                    </Badge>
                  ) : null}
                </td>
                <td>{item.rate !== null ? item.rate : '—'}</td>
                <td>{merchantPackageStatusLabel(item.status)}</td>
                <td>{item.is_default ? 'Yes' : 'No'}</td>
                <td>{item.version}</td>
                <td>{formatMerchantTimestamp(item.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function McpCard({ detail }: { detail: AdminMerchantBranchDetailDto }) {
  const mcp = detail.mcp;
  if (!mcp) {
    return (
      <Card className="admin-merchant-section">
        <h2>MCP summary</h2>
        <p className="admin-merchant-empty-inline">
          No MCP account for this branch yet — unavailable, never zero.
        </p>
      </Card>
    );
  }
  return (
    <Card className="admin-merchant-section">
      <h2>MCP summary</h2>
      <p className="admin-merchant-section__description">
        Selected-market account summary, reconciliation, and a bounded recent
        ledger summary from the owner read surfaces. No raw ledger export.
      </p>
      <dl className="admin-merchant-definition">
        <div>
          <dt>Available balance</dt>
          <dd>{mcp.account.available_balance}</dd>
        </div>
        <div>
          <dt>Total balance</dt>
          <dd>{mcp.account.total_balance}</dd>
        </div>
        <div>
          <dt>Account status</dt>
          <dd>{mcp.account.status}</dd>
        </div>
        <div>
          <dt>Reconciliation</dt>
          <dd>
            {mcp.reconciliation ? (
              mcp.reconciliation.matches ? (
                <Badge tone="success">Matches</Badge>
              ) : (
                <Badge tone="warning">Mismatch</Badge>
              )
            ) : (
              'Unavailable'
            )}
          </dd>
        </div>
      </dl>
      {mcp.recent_ledger && mcp.recent_ledger.items.length > 0 ? (
        <Table aria-label="Recent MCP ledger summary">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Direction</th>
              <th scope="col">Amount</th>
              <th scope="col">Reason</th>
              <th scope="col">Effective</th>
            </tr>
          </thead>
          <tbody>
            {mcp.recent_ledger.items.map((entry) => (
              <tr key={String(entry.id ?? entry.sequence)}>
                <td>{String(entry.entryType ?? '')}</td>
                <td>{String(entry.direction ?? '')}</td>
                <td>
                  {entry.amount !== undefined ? String(entry.amount) : '—'}
                </td>
                <td>
                  {entry.reason !== null && entry.reason !== undefined
                    ? String(entry.reason)
                    : '—'}
                </td>
                <td>
                  {entry.effectiveAt
                    ? formatMerchantTimestamp(String(entry.effectiveAt))
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </Card>
  );
}

interface ActionProps {
  detail: AdminMerchantBranchDetailDto;
  availability: {
    canReviewApplication: boolean;
    canReviewKyc: boolean;
    canSuspend: boolean;
    canReactivate: boolean;
    canClose: boolean;
  };
  onCompleted: (message: string) => void;
}

function ActionsCard({ detail, availability, onCompleted }: ActionProps) {
  const { marketId } = useParams<{ marketId: string; branchId: string }>();
  const branchId = detail.branch_id;
  const [actionError, setActionError] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const noneAvailable = !(
    availability.canReviewApplication ||
    availability.canReviewKyc ||
    availability.canSuspend ||
    availability.canReactivate ||
    availability.canClose
  );

  async function runAction(
    operation: () => Promise<unknown>,
    successMessage: string,
  ) {
    setActionError(null);
    setBusy(true);
    try {
      await operation();
      onCompleted(successMessage);
    } catch (error: unknown) {
      setActionError(describeMerchantActionError(error, successMessage));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="admin-merchant-section">
      <h2>Approved actions</h2>
      <p className="admin-merchant-section__description">
        Actions invoke the accepted Phase 1 owner commands with the server
        market contract; every write carries an Idempotency-Key and owner audit.
        Suspension preserves MCP.
      </p>
      {actionError ? (
        <MerchantConflictBanner
          title={actionError.title}
          description={actionError.description}
        />
      ) : null}

      {noneAvailable ? (
        <p className="admin-merchant-empty-inline">
          No actions are available for the current merchant state and your
          effective permissions.
        </p>
      ) : null}

      <div className="admin-merchant-actions">
        {availability.canReviewApplication ? (
          <ApplicationReviewForm
            marketId={marketId ?? ''}
            branchId={branchId}
            busy={busy}
            onSubmit={(input) =>
              runAction(
                () =>
                  adminMerchantApi.reviewMerchantApplication(
                    marketId ?? '',
                    branchId,
                    input,
                    createIdempotencyKey(),
                  ),
                'Application review submitted',
              )
            }
          />
        ) : null}

        {availability.canReviewKyc ? (
          <KycReviewForm
            marketId={marketId ?? ''}
            branchId={branchId}
            busy={busy}
            onSubmit={(input) =>
              runAction(
                () =>
                  adminMerchantApi.reviewMerchantKyc(
                    marketId ?? '',
                    branchId,
                    input,
                    createIdempotencyKey(),
                  ),
                'KYC review submitted',
              )
            }
          />
        ) : null}

        {availability.canSuspend ? (
          <StatusActionForm
            label="Suspend merchant"
            buttonLabel="Suspend"
            busy={busy}
            onSubmit={(reason) =>
              runAction(
                () =>
                  adminMerchantApi.suspendMerchant(
                    marketId ?? '',
                    branchId,
                    { reason },
                    createIdempotencyKey(),
                  ),
                'Merchant suspended',
              )
            }
          />
        ) : null}

        {availability.canReactivate ? (
          <StatusActionForm
            label="Reactivate merchant"
            buttonLabel="Reactivate"
            busy={busy}
            onSubmit={(reason) =>
              runAction(
                () =>
                  adminMerchantApi.reactivateMerchant(
                    marketId ?? '',
                    branchId,
                    { reason },
                    createIdempotencyKey(),
                  ),
                'Merchant reactivated',
              )
            }
          />
        ) : null}

        {availability.canClose ? (
          <StatusActionForm
            label="Close merchant"
            buttonLabel="Close"
            busy={busy}
            onSubmit={(reason) =>
              runAction(
                () =>
                  adminMerchantApi.closeMerchant(
                    marketId ?? '',
                    branchId,
                    { reason },
                    createIdempotencyKey(),
                  ),
                'Merchant close submitted',
              )
            }
          />
        ) : null}
      </div>
    </Card>
  );
}

function ApplicationReviewForm({
  marketId,
  branchId,
  busy,
  onSubmit,
}: {
  marketId: string;
  branchId: string;
  busy: boolean;
  onSubmit: (input: {
    decision: AdminMerchantReviewDecision;
    reason: string;
  }) => void;
}) {
  const [decision, setDecision] =
    useState<AdminMerchantReviewDecision>('APPROVED');
  const [reason, setReason] = useState('');
  const valid = reason.trim().length > 0;
  return (
    <form
      className="admin-merchant-action-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        onSubmit({ decision, reason: reason.trim() });
      }}
    >
      <h3>Review application</h3>
      <FormField label="Decision" htmlFor="app-review-decision">
        <Select
          id="app-review-decision"
          aria-label="Application review decision"
          value={decision}
          onChange={(event) =>
            setDecision(event.target.value as AdminMerchantReviewDecision)
          }
        >
          {merchantReviewDecisionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Reason" htmlFor="app-review-reason">
        <Textarea
          id="app-review-reason"
          aria-label="Application review reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          placeholder="Required owner-command reason (recorded in audit)"
        />
      </FormField>
      <Button type="submit" size="sm" disabled={!valid || busy}>
        Submit application review
      </Button>
      <small className="admin-merchant-action-form__note">
        Target: application review for {branchId.slice(0, 8)}…
      </small>
    </form>
  );
}

function KycReviewForm({
  marketId,
  branchId,
  busy,
  onSubmit,
}: {
  marketId: string;
  branchId: string;
  busy: boolean;
  onSubmit: (input: {
    decision: AdminMerchantReviewDecision;
    reason: string;
    rejected_fields: string[];
  }) => void;
}) {
  const [decision, setDecision] =
    useState<AdminMerchantReviewDecision>('APPROVED');
  const [reason, setReason] = useState('');
  const [rejectedFields, setRejectedFields] = useState('');
  const valid =
    reason.trim().length > 0 &&
    (decision !== 'RESUBMISSION_REQUIRED' || rejectedFields.trim().length > 0);
  return (
    <form
      className="admin-merchant-action-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        onSubmit({
          decision,
          reason: reason.trim(),
          rejected_fields:
            decision === 'RESUBMISSION_REQUIRED'
              ? rejectedFields
                  .split(',')
                  .map((field) => field.trim())
                  .filter(Boolean)
              : [],
        });
      }}
    >
      <h3>Review KYC</h3>
      <FormField label="Decision" htmlFor="kyc-review-decision">
        <Select
          id="kyc-review-decision"
          aria-label="KYC review decision"
          value={decision}
          onChange={(event) =>
            setDecision(event.target.value as AdminMerchantReviewDecision)
          }
        >
          {merchantReviewDecisionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Reason" htmlFor="kyc-review-reason">
        <Textarea
          id="kyc-review-reason"
          aria-label="KYC review reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          placeholder="Required owner-command reason (recorded in audit)"
        />
      </FormField>
      {decision === 'RESUBMISSION_REQUIRED' ? (
        <FormField label="Rejected fields" htmlFor="kyc-review-fields">
          <Input
            id="kyc-review-fields"
            aria-label="Rejected KYC fields (comma separated)"
            value={rejectedFields}
            onChange={(event) => setRejectedFields(event.target.value)}
            placeholder="e.g. business_certification, pic_identity"
          />
        </FormField>
      ) : null}
      <Button type="submit" size="sm" disabled={!valid || busy}>
        Submit KYC review
      </Button>
      <small className="admin-merchant-action-form__note">
        Target: KYC review for {branchId.slice(0, 8)}…
      </small>
    </form>
  );
}

function StatusActionForm({
  label,
  buttonLabel,
  busy,
  onSubmit,
}: {
  label: string;
  buttonLabel: string;
  busy: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length > 0;
  return (
    <form
      className="admin-merchant-action-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        onSubmit(reason.trim());
      }}
    >
      <h3>{label}</h3>
      <FormField label="Reason" htmlFor="status-action-reason">
        <Textarea
          id="status-action-reason"
          aria-label={`${label} reason`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          placeholder="Required owner-command reason (recorded in audit)"
        />
      </FormField>
      <Button type="submit" size="sm" disabled={!valid || busy}>
        {buttonLabel}
      </Button>
    </form>
  );
}

function operationalBadgeTone(
  status: string,
): 'success' | 'warning' | 'error' | 'info' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'SUSPENDED' || status === 'CLOSED') return 'error';
  if (status === 'CLOSURE_PENDING') return 'warning';
  return 'info';
}

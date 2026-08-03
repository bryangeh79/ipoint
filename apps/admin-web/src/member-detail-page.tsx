import {
  type AdminMemberOpsProfileDto,
  type AdminMemberOpsReasonRequest,
  type AdminMemberOpsCloseRequest,
  type AdminMemberOpsNoteCreateRequest,
} from '@ipoint/api-client';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FormField,
  Input,
  PageHeader,
  Table,
  Textarea,
} from '@ipoint/ui';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import { formatTimestamp } from './dashboard-model.js';
import {
  isTerminalMemberStatus,
  memberOpsActions,
  memberOpsErrorCopy,
  reverificationCapability,
  type MemberOpsActionId,
} from './member-ops-model.js';
import {
  MemberActionUnavailable,
  MemberStatusBadge,
  MemberStatusNotice,
} from './member-ops-states.js';
import {
  canPerformSensitiveAdminWrite,
  useAdminWriteEnvironment,
} from './pwa-policy.js';
import { ShellState } from './shell-states.js';

/**
 * P7-S5A selected-market member detail.
 *
 * Masked profile summary, status + history, status/session/reverification
 * actions, and notes — all delegated to the frozen Phase 2 owner commands
 * through the selected-market adapter. Every action carries a server-side
 * reason and an idempotency key reused on uncertain retries. Suspended/closed
 * status, conflict/stale, permission-denied, offline, and unavailable owner
 * capability states are explicit.
 */

type DetailErrorKind =
  | 'error'
  | 'permission-denied'
  | 'conflict'
  | 'offline'
  | 'disabled';

type DetailLoad =
  | { status: 'loading' }
  | { status: 'ready'; profile: AdminMemberOpsProfileDto }
  | {
      status: 'error';
      kind: DetailErrorKind;
      title: string;
      description: string;
    };

function detailError(error: unknown): DetailLoad {
  const copy = memberOpsErrorCopy(error);
  const kind: DetailErrorKind = copy.title.includes('Permission denied')
    ? 'permission-denied'
    : copy.title.includes('outside the selected market') ||
        copy.title.includes('status conflict')
      ? 'conflict'
      : copy.title.includes('No Current Admin Market')
        ? 'disabled'
        : copy.title.toLowerCase().includes('offline')
          ? 'offline'
          : 'error';
  return {
    status: 'error',
    kind,
    title: copy.title,
    description: copy.description,
  };
}

function actionCall(
  actionId: MemberOpsActionId,
  publicMemberId: string,
  input: AdminMemberOpsReasonRequest | AdminMemberOpsCloseRequest,
): Promise<AdminMemberOpsProfileDto> {
  switch (actionId) {
    case 'suspend':
      return adminApi.memberOpsSuspend(
        publicMemberId,
        input as AdminMemberOpsReasonRequest,
      );
    case 'reactivate':
      return adminApi.memberOpsReactivate(
        publicMemberId,
        input as AdminMemberOpsReasonRequest,
      );
    case 'close':
      return adminApi.memberOpsClose(
        publicMemberId,
        input as AdminMemberOpsCloseRequest,
      );
    case 'revoke-sessions':
      return adminApi.memberOpsRevokeSessions(
        publicMemberId,
        input as AdminMemberOpsReasonRequest,
      );
    case 'require-reverification':
      return adminApi.memberOpsRequireReverification(
        publicMemberId,
        input as AdminMemberOpsReasonRequest,
      );
  }
}

export function MemberDetailPage() {
  const session = useAdminSession();
  const marketId = session.bootstrap?.currentMarket?.id;
  const { memberId } = useParams();
  const environment = useAdminWriteEnvironment();
  const [load, setLoad] = useState<DetailLoad>({ status: 'loading' });
  const [requestKey, setRequestKey] = useState(0);
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!marketId || !memberId) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    adminApi
      .memberOpsDetail(memberId)
      .then((profile) => {
        if (!cancelled) setLoad({ status: 'ready', profile });
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoad(detailError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, memberId, requestKey]);

  const retry = useCallback(() => setRequestKey((key) => key + 1), []);

  const canWrite = canPerformSensitiveAdminWrite(environment);
  const actions = useMemo(
    () =>
      load.status === 'ready'
        ? memberOpsActions(
            load.profile,
            session.bootstrap?.effectivePermissions ?? [],
            environment,
          )
        : [],
    [load, session.bootstrap?.effectivePermissions, environment],
  );

  const reverification = useMemo(
    () =>
      load.status === 'ready'
        ? reverificationCapability(load.profile)
        : { available: false },
    [load],
  );

  const onUpdated = useCallback(
    (profile: AdminMemberOpsProfileDto, message: string) => {
      setLoad({ status: 'ready', profile });
      setFeedback({ ok: true, message });
    },
    [],
  );

  const onActionError = useCallback((error: unknown) => {
    const copy = memberOpsErrorCopy(error);
    setFeedback({ ok: false, message: `${copy.title}: ${copy.description}` });
  }, []);

  if (load.status === 'loading') {
    return (
      <section aria-labelledby="admin-member-detail-title">
        <ShellState kind="loading" />
      </section>
    );
  }

  if (load.status === 'error') {
    return (
      <section aria-labelledby="admin-member-detail-title">
        <ShellState
          kind={load.kind}
          title={load.title}
          description={load.description}
          action={
            load.kind === 'error' ? (
              <Button onClick={retry}>Retry member</Button>
            ) : undefined
          }
        />
      </section>
    );
  }

  const profile = load.profile;

  return (
    <section
      aria-labelledby="admin-member-detail-title"
      className="admin-member-detail"
    >
      <PageHeader
        eyebrow="People"
        title={
          <span
            id="admin-member-detail-title"
            className="admin-member-detail__title"
          >
            {profile.publicMemberId}
          </span>
        }
        description={`Masked member profile in ${
          session.bootstrap?.currentMarket?.name ?? 'the selected market'
        }. All identity fields are masked server-side; no wallet or ledger detail is exposed.`}
        actions={<MemberStatusBadge status={profile.status} />}
      />

      <MemberStatusNotice status={profile.status} />

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
        className="admin-member-section"
        aria-labelledby="admin-member-profile-heading"
      >
        <h2 id="admin-member-profile-heading">Profile summary (masked)</h2>
        <dl className="admin-member-facts">
          <div>
            <dt>Email</dt>
            <dd>{profile.email}</dd>
          </div>
          <div>
            <dt>Full name</dt>
            <dd>{profile.profile.fullName ?? 'Not provided'}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{profile.profile.phone ?? 'Not provided'}</dd>
          </div>
          <div>
            <dt>KYC level</dt>
            <dd>{profile.kycLevel}</dd>
          </div>
          <div>
            <dt>KYC status</dt>
            <dd>{profile.kyc?.status ?? 'NOT_STARTED'}</dd>
          </div>
          <div>
            <dt>Account country</dt>
            <dd>{profile.accountCountry}</dd>
          </div>
          <div>
            <dt>Current market</dt>
            <dd>{profile.currentMarketId}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>
              <time dateTime={profile.createdAt}>
                {formatTimestamp(profile.createdAt)}
              </time>
            </dd>
          </div>
          {profile.closedAt ? (
            <div>
              <dt>Closed</dt>
              <dd>
                <time dateTime={profile.closedAt}>
                  {formatTimestamp(profile.closedAt)}
                </time>
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="admin-member-muted">
          Masked by the owner service. Wallet and ledger detail is not part of
          Member Operations.
        </p>
      </Card>

      <Card
        className="admin-member-section"
        aria-labelledby="admin-member-actions-heading"
      >
        <h2 id="admin-member-actions-heading">Actions</h2>
        {!canWrite ? (
          <Alert tone="warning" title="Read-only environment" role="status">
            Privileged member writes require the online desktop Admin Web (not
            the read-only PWA). No write was queued or replayed.
          </Alert>
        ) : null}
        {isTerminalMemberStatus(profile.status) ? (
          <p className="admin-member-muted">
            No status action is available for a closed member.
          </p>
        ) : null}
        <div className="admin-member-actions">
          {actions.map((state) => {
            if (state.id === 'require-reverification') {
              const capability = reverification;
              const available = state.available && capability.available;
              const reason = state.available
                ? capability.reason
                : state.unavailableReason;
              return (
                <MemberActionForm
                  key={state.id}
                  actionId={state.id}
                  label={state.label}
                  profile={profile}
                  available={available}
                  unavailableReason={reason}
                  onUpdated={onUpdated}
                  onError={onActionError}
                />
              );
            }
            return (
              <MemberActionForm
                key={state.id}
                actionId={state.id}
                label={state.label}
                profile={profile}
                available={state.available}
                unavailableReason={state.unavailableReason}
                onUpdated={onUpdated}
                onError={onActionError}
              />
            );
          })}
        </div>
      </Card>

      <Card
        className="admin-member-section"
        aria-labelledby="admin-member-history-heading"
      >
        <h2 id="admin-member-history-heading">Status history</h2>
        {profile.statusHistory.length === 0 ? (
          <p className="admin-member-muted">No recorded status transitions.</p>
        ) : (
          <Table aria-label="Member status history">
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Actor</th>
                <th scope="col">Reason</th>
                <th scope="col">Occurred</th>
              </tr>
            </thead>
            <tbody>
              {profile.statusHistory.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.fromStatus ?? '—'}</td>
                  <td>
                    <Badge tone="neutral">{entry.toStatus}</Badge>
                  </td>
                  <td>
                    {entry.actorType}
                    {entry.actorId ? ` · ${entry.actorId}` : ''}
                  </td>
                  <td>{entry.reason ?? '—'}</td>
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

      <MemberNotesSection
        profile={profile}
        onUpdated={onUpdated}
        onError={onActionError}
      />
    </section>
  );
}

interface MemberActionFormProps {
  actionId: MemberOpsActionId;
  label: string;
  profile: AdminMemberOpsProfileDto;
  available: boolean;
  unavailableReason?: string;
  onUpdated: (profile: AdminMemberOpsProfileDto, message: string) => void;
  onError: (error: unknown) => void;
}

function MemberActionForm({
  actionId,
  label,
  profile,
  available,
  unavailableReason,
  onUpdated,
  onError,
}: MemberActionFormProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const reasonId = useId();
  const confirmationId = useId();

  if (!available) {
    return (
      <MemberActionUnavailable
        state={{ id: actionId, label, available: false, unavailableReason }}
      />
    );
  }

  const needsConfirmation = actionId === 'close';

  function submit() {
    if (!reason.trim() || (needsConfirmation && confirmation !== 'CONFIRM'))
      return;
    setSubmitting(true);
    const base = { reason: reason.trim(), idempotencyKey };
    const input = needsConfirmation
      ? { ...base, confirmationText: confirmation as 'CONFIRM' }
      : base;
    actionCall(actionId, profile.publicMemberId, input)
      .then((updated) => {
        setSubmitting(false);
        setOpen(false);
        setReason('');
        setConfirmation('');
        setIdempotencyKey(crypto.randomUUID());
        onUpdated(
          updated,
          `${label} completed. The server confirmed the new state.`,
        );
      })
      .catch((error: unknown) => {
        setSubmitting(false);
        onError(error);
      });
  }

  return (
    <div className="admin-member-action">
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {label}
        </Button>
      ) : (
        <form
          className="admin-member-action__form"
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
          {needsConfirmation ? (
            <FormField label="Type CONFIRM to close" htmlFor={confirmationId}>
              <Input
                id={confirmationId}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                aria-required="true"
              />
            </FormField>
          ) : null}
          <p className="admin-member-muted">
            Retries reuse the same idempotency key; a new key is issued only
            after the server confirms the outcome.
          </p>
          <div className="admin-member-action__buttons">
            <Button
              type="submit"
              disabled={
                submitting ||
                !reason.trim() ||
                (needsConfirmation && confirmation !== 'CONFIRM')
              }
            >
              {submitting ? 'Submitting…' : label}
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setOpen(false);
                setReason('');
                setConfirmation('');
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

function MemberNotesSection({
  profile,
  onUpdated,
  onError,
}: {
  profile: AdminMemberOpsProfileDto;
  onUpdated: (profile: AdminMemberOpsProfileDto, message: string) => void;
  onError: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const contentId = useId();

  function submit() {
    if (!content.trim()) return;
    setSubmitting(true);
    const input: AdminMemberOpsNoteCreateRequest = {
      content: content.trim(),
      isInternal,
      idempotencyKey,
    };
    adminApi
      .memberOpsAddNote(profile.publicMemberId, input)
      .then((updated) => {
        setSubmitting(false);
        setOpen(false);
        setContent('');
        setIdempotencyKey(crypto.randomUUID());
        onUpdated(
          updated,
          'Note added. The server recorded the note and audit entry.',
        );
      })
      .catch((error: unknown) => {
        setSubmitting(false);
        onError(error);
      });
  }

  return (
    <Card
      className="admin-member-section"
      aria-labelledby="admin-member-notes-heading"
    >
      <h2 id="admin-member-notes-heading">Notes</h2>
      {profile.notes.length === 0 ? (
        <p className="admin-member-muted">No Admin notes for this member.</p>
      ) : (
        <ul className="admin-member-notes">
          {profile.notes.map((note) => (
            <li key={note.id} className="admin-member-note">
              <p>{note.content}</p>
              <small>
                {note.isInternal ? 'Internal · ' : ''}
                {formatTimestamp(note.createdAt)} · market {note.marketId}
              </small>
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Add note
        </Button>
      ) : (
        <form
          className="admin-member-action__form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormField
            label="Note content (max 5000 characters)"
            htmlFor={contentId}
          >
            <Textarea
              id={contentId}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={5000}
              rows={3}
              aria-required="true"
            />
          </FormField>
          <Checkbox
            checked={isInternal}
            onChange={(event) => setIsInternal(event.target.checked)}
            label="Internal note (only Admin can see)"
          />
          <div className="admin-member-action__buttons">
            <Button type="submit" disabled={submitting || !content.trim()}>
              {submitting ? 'Submitting…' : 'Save note'}
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setOpen(false);
                setContent('');
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

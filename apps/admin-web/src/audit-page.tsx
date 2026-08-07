import {
  ApiError,
  type AdminAuditEntryDto,
  type AdminAuditRawEntryDto,
  type AdminStepUpChallengeDto,
} from '@ipoint/api-client';
import {
  Alert,
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
import { adminApi, adminAuditOpsApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import {
  auditReasonValid,
  describeAuditReadError,
  formatAuditUtc,
  type AuditPageErrorCopy,
} from './audit-model.js';
import {
  AuditEmptyState,
  AuditErrorState,
  AuditResultBadge,
  AuditRowExpanded,
  AuditSkeleton,
} from './audit-states.js';

/**
 * P7-S9 Audit viewer page (Command Center 2026-08-07 §7.1).
 *
 * Read-only, selected-market immutable audit log with filters (actor /
 * action / entity / result / time range) and free-text search. Every row
 * shows the masked limited view (identity fields masked, tokens redacted,
 * source IP never shown). Raw evidence is available only to roles holding
 * `audit.sensitive-diff.view` (SUPER_ADMIN and finance/KYC templates — NOT
 * Support): it requires a recorded reason and a fresh MFA step-up grant,
 * exactly as the server enforces. The page performs no writes.
 */

const RESULT_OPTIONS = ['ALL', 'SUCCESS', 'FAILURE', 'DENIED'] as const;
const ACTOR_OPTIONS = ['ALL', 'ACCOUNT', 'ADMIN_USER', 'SYSTEM'] as const;

type AuditLoad =
  | { status: 'loading' }
  | { status: 'ready'; data: import('@ipoint/api-client').AdminAuditListDto }
  | ({ status: 'error' } & AuditPageErrorCopy);

interface RawState {
  entryId: string;
  phase: 'idle' | 'loading' | 'stepup' | 'done';
  reason: string;
  code: string;
  challenge: AdminStepUpChallengeDto | null;
  verifying: boolean;
  message: { tone: 'success' | 'error'; text: string } | null;
  raw: AdminAuditRawEntryDto | null;
}

function initialRawState(entryId: string): RawState {
  return {
    entryId,
    phase: 'idle',
    reason: '',
    code: '',
    challenge: null,
    verifying: false,
    message: null,
    raw: null,
  };
}

export function AuditPage() {
  const { marketId } = useParams<{ marketId: string }>();
  const session = useAdminSession();
  const [load, setLoad] = useState<AuditLoad>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [resultFilter, setResultFilter] = useState<string>('ALL');
  const [actorFilter, setActorFilter] = useState<string>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [raw, setRaw] = useState<RawState | null>(null);

  const rawPermitted =
    session.bootstrap?.effectivePermissions.includes(
      'audit.sensitive-diff.view',
    ) ?? false;

  const loadEntries = useCallback(async () => {
    if (!marketId) return;
    setLoad({ status: 'loading' });
    try {
      const data = await adminAuditOpsApi.listEntries(marketId, {
        ...(query.trim() ? { q: query.trim() } : {}),
        ...(action.trim() ? { action: action.trim() } : {}),
        ...(entityType.trim() ? { entityType: entityType.trim() } : {}),
        ...(resultFilter !== 'ALL'
          ? { result: resultFilter as 'SUCCESS' }
          : {}),
        ...(actorFilter !== 'ALL'
          ? { actorType: actorFilter as 'ADMIN_USER' }
          : {}),
        ...(from ? { from: new Date(from).toISOString() } : {}),
        ...(to ? { to: new Date(to).toISOString() } : {}),
        limit: 50,
      });
      setLoad({ status: 'ready', data });
    } catch (error: unknown) {
      setLoad({ status: 'error', ...describeAuditReadError(error) });
    }
  }, [
    marketId,
    query,
    action,
    entityType,
    resultFilter,
    actorFilter,
    from,
    to,
  ]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries, retryKey]);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  const items = load.status === 'ready' ? load.data.items : [];

  async function requestRaw(stepUpToken?: string) {
    if (!marketId || !raw) return;
    const trimmed = raw.reason.trim();
    if (!auditReasonValid(trimmed)) {
      setRaw({
        ...raw,
        message: {
          tone: 'error',
          text: 'Enter a recorded reason of at least 8 characters to view raw evidence.',
        },
      });
      return;
    }
    setRaw({ ...raw, phase: 'loading', message: null });
    try {
      const evidence = await adminAuditOpsApi.getRawEntry(
        marketId,
        raw.entryId,
        {
          reason: trimmed,
          ...(stepUpToken ? { stepUpToken } : {}),
        },
      );
      setRaw({
        ...raw,
        phase: 'done',
        message: {
          tone: 'success',
          text: 'Raw evidence shown. Every sensitive view is server-audited.',
        },
        raw: evidence,
      });
    } catch (error: unknown) {
      if (
        error instanceof ApiError &&
        error.body.code === 'MFA_STEP_UP_REQUIRED'
      ) {
        try {
          const started = await adminApi.beginStepUp({
            action_class: 'audit.sensitive-diff.view',
            ...(marketId ? { market_id: marketId } : {}),
          });
          setRaw({
            ...raw,
            phase: 'stepup',
            challenge: started,
            message: null,
          });
        } catch (stepUpError: unknown) {
          setRaw({
            ...raw,
            phase: 'idle',
            message: { tone: 'error', text: describeRawError(stepUpError) },
          });
        }
        return;
      }
      setRaw({
        ...raw,
        phase: 'idle',
        message: { tone: 'error', text: describeRawError(error) },
      });
    }
  }

  async function verifyAndRequest() {
    if (!raw?.challenge || !raw || raw.code.trim().length !== 6) return;
    setRaw({ ...raw, verifying: true, message: null });
    try {
      const verified = await adminApi.verifyStepUp({
        challenge_id: raw.challenge.step_up_challenge_id,
        code: raw.code.trim(),
      });
      await requestRaw(verified.step_up_token);
    } catch (error: unknown) {
      setRaw({
        ...raw,
        verifying: false,
        message: { tone: 'error', text: describeRawError(error) },
      });
    }
  }

  function openRaw(entryId: string) {
    setRaw(initialRawState(entryId));
  }

  return (
    <div className="admin-page">
      <PageHeader
        title="Audit viewer"
        description="Selected-market immutable audit log (append-only, read-only). Evidence is masked for every role — identity-document fields are masked, token/secret fields are redacted and the source IP is never shown. The raw evidence view is restricted to roles with audit.sensitive-diff.view and requires a recorded reason and MFA step-up; Support never reads raw ledgers. No export exists on this surface."
      />

      <Card>
        <div className="admin-reward-form">
          <FormField label="Search" htmlFor="audit-search">
            <Input
              id="audit-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Action, entity type, entity id, actor id"
            />
          </FormField>
          <FormField label="Action" htmlFor="audit-action">
            <Input
              id="audit-action"
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder="e.g. REDEMPTION_REFUND_APPROVE"
            />
          </FormField>
          <FormField label="Entity type" htmlFor="audit-entity">
            <Input
              id="audit-entity"
              value={entityType}
              onChange={(event) => setEntityType(event.target.value)}
              placeholder="e.g. redemption_order"
            />
          </FormField>
          <FormField label="Result" htmlFor="audit-result">
            <Select
              id="audit-result"
              value={resultFilter}
              onChange={(event) => setResultFilter(event.target.value)}
            >
              {RESULT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 'ALL' ? 'All results' : option}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Actor type" htmlFor="audit-actor">
            <Select
              id="audit-actor"
              value={actorFilter}
              onChange={(event) => setActorFilter(event.target.value)}
            >
              {ACTOR_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 'ALL' ? 'All actors' : option}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="From" htmlFor="audit-from">
            <Input
              id="audit-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </FormField>
          <FormField label="To" htmlFor="audit-to">
            <Input
              id="audit-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </FormField>
        </div>
      </Card>

      {load.status === 'loading' ? <AuditSkeleton /> : null}

      {load.status === 'error' ? (
        <AuditErrorState
          title={load.title}
          description={load.description}
          onRetry={retry}
        />
      ) : null}

      {load.status === 'ready' && items.length === 0 ? (
        <AuditEmptyState />
      ) : null}

      {load.status === 'ready' && items.length > 0 ? (
        <Card>
          <p className="admin-reward-muted" data-testid="audit-total">
            {load.data.total} audit entr{load.data.total === 1 ? 'y' : 'ies'} ·{' '}
            as of {formatAuditUtc(load.data.asOf)}
          </p>
          <Table aria-label="Audit entries">
            <thead>
              <tr>
                <th scope="col">Occurred</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Entity</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr
                  key={entry.id}
                  data-testid={`audit-row-${entry.id}`}
                  onClick={() =>
                    setExpanded((current) =>
                      current === entry.id ? null : entry.id,
                    )
                  }
                >
                  <td>{formatAuditUtc(entry.occurredAt)}</td>
                  <td>
                    {entry.actorType}
                    {entry.actorId ? (
                      <>
                        <br />
                        <span className="admin-reward-muted">
                          {entry.actorId}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td>{entry.action}</td>
                  <td>
                    {entry.entityType}
                    <br />
                    <span className="admin-reward-muted">{entry.entityId}</span>
                  </td>
                  <td>
                    <AuditResultBadge result={entry.result} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {expanded ? (
            <>
              <AuditRowExpanded entry={entryById(items, expanded)} />
              <RawEvidenceSection
                entry={entryById(items, expanded)}
                raw={raw}
                permitted={rawPermitted}
                onOpen={openRaw}
                onRequestRaw={requestRaw}
                onVerify={verifyAndRequest}
                onChangeReason={(reason) =>
                  raw ? setRaw({ ...raw, reason }) : undefined
                }
                onChangeCode={(code) =>
                  raw ? setRaw({ ...raw, code }) : undefined
                }
              />
            </>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function entryById(
  items: AdminAuditEntryDto[],
  entryId: string,
): AdminAuditEntryDto {
  return items.find((entry) => entry.id === entryId) ?? items[0]!;
}

function RawEvidenceSection({
  entry,
  raw,
  permitted,
  onOpen,
  onRequestRaw,
  onVerify,
  onChangeReason,
  onChangeCode,
}: {
  entry: AdminAuditEntryDto;
  raw: RawState | null;
  permitted: boolean;
  onOpen: (entryId: string) => void;
  onRequestRaw: (stepUpToken?: string) => void;
  onVerify: () => void;
  onChangeReason: (reason: string) => void;
  onChangeCode: (code: string) => void;
}) {
  const active = raw?.entryId === entry.id ? raw : null;
  if (!permitted) {
    return (
      <p className="admin-audit-locked" role="status" data-testid="raw-locked">
        <strong>Raw evidence is locked.</strong> Viewing the full audit evidence
        requires the <code>audit.sensitive-diff.view</code> permission, a
        recorded reason and MFA step-up. The Support template is not granted
        this permission — support never reads raw ledgers. Masked evidence
        remains available above.
      </p>
    );
  }
  if (!active) {
    return (
      <div className="admin-reward-form">
        <Button
          variant="secondary"
          onClick={() => onOpen(entry.id)}
          data-testid="raw-open"
        >
          View raw evidence
        </Button>
      </div>
    );
  }

  if (active.phase === 'done' && active.raw) {
    return (
      <div className="admin-audit-detail" data-testid="raw-evidence">
        {active.message ? (
          <Alert tone={active.message.tone} title="Raw evidence" role="status">
            {active.message.text}
          </Alert>
        ) : null}
        <p className="admin-reward-muted">
          Full stored evidence (before/after as persisted, source IP, request
          id). This view is server-audited and performs no writes.
        </p>
        <details open>
          <summary>Before</summary>
          <pre className="admin-audit-pre">
            {JSON.stringify(active.raw.before, null, 2)}
          </pre>
        </details>
        <details open>
          <summary>After</summary>
          <pre className="admin-audit-pre">
            {JSON.stringify(active.raw.after, null, 2)}
          </pre>
        </details>
        <p className="admin-reward-muted">
          Source IP: {active.raw.ipAddress ?? 'none'} · Request:{' '}
          {active.raw.requestId ?? 'none'}
        </p>
      </div>
    );
  }

  if (active.phase === 'stepup') {
    return (
      <form
        className="admin-kyc-action__form"
        onSubmit={(event) => {
          event.preventDefault();
          onVerify();
        }}
        data-testid="raw-stepup"
      >
        <FormField label="MFA verification code" htmlFor="audit-raw-code">
          <Input
            id="audit-raw-code"
            value={active.code}
            onChange={(event) => onChangeCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-required="true"
            maxLength={6}
          />
        </FormField>
        <p className="admin-kyc-muted">
          Verify your identity to unlock raw audit evidence. The grant is
          consumed by one view.
        </p>
        <div className="admin-kyc-action__buttons">
          <Button
            type="submit"
            disabled={active.verifying || active.code.trim().length !== 6}
          >
            {active.verifying ? 'Verifying…' : 'Verify and view raw evidence'}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="admin-kyc-action__form"
      onSubmit={(event) => {
        event.preventDefault();
        onRequestRaw();
      }}
      data-testid="raw-reason-form"
    >
      {active.message ? (
        <Alert tone={active.message.tone} title="Raw evidence" role="status">
          {active.message.text}
        </Alert>
      ) : null}
      <FormField
        label="Reason for viewing raw evidence (required, server-recorded)"
        htmlFor="audit-raw-reason"
      >
        <Textarea
          id="audit-raw-reason"
          value={active.reason}
          onChange={(event) => onChangeReason(event.target.value)}
          maxLength={500}
          rows={3}
          aria-required="true"
        />
      </FormField>
      <p className="admin-kyc-muted">
        Reason must be 8–500 characters. MFA step-up is required and every view
        is audited.
      </p>
      <div className="admin-kyc-action__buttons">
        <Button type="submit" disabled={active.phase === 'loading'}>
          {active.phase === 'loading' ? 'Requesting…' : 'View raw evidence'}
        </Button>
      </div>
    </form>
  );
}

function describeRawError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.body.code) {
    case 'SENSITIVE_VIEW_REASON_REQUIRED':
      return 'A recorded reason of at least 8 characters is required.';
    case 'MFA_STEP_UP_REQUIRED':
      return 'MFA step-up is required to view raw evidence.';
    case 'PERMISSION_DENIED':
    case 'MARKET_ACCESS_DENIED':
      return 'Your server permissions do not allow viewing raw audit evidence.';
    default: {
      const message = error.body.message;
      return typeof message === 'string'
        ? message
        : Array.isArray(message)
          ? message.join(' ')
          : 'The raw evidence view failed.';
    }
  }
}

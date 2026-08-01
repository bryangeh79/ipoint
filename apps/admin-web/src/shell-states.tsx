import { ApiError, describeApiError } from '@ipoint/api-client';
import { Alert, Button, Card, EmptyState, Skeleton } from '@ipoint/ui';
import type { ReactNode } from 'react';

export type ShellStateKind =
  | 'loading'
  | 'empty'
  | 'error'
  | 'success'
  | 'disabled'
  | 'expired'
  | 'suspended'
  | 'permission-denied'
  | 'offline'
  | 'retry'
  | 'stale'
  | 'conflict'
  | 'blocked-prerequisite';

interface ShellStateProps {
  kind: ShellStateKind;
  title?: string;
  description?: string;
  action?: ReactNode;
  blockedPrerequisite?: string;
}

const defaultCopy: Record<
  Exclude<ShellStateKind, 'loading'>,
  { title: string; description: string }
> = {
  empty: {
    title: 'No records found',
    description: 'The server confirmed that this authorized view is empty.',
  },
  error: {
    title: 'Unable to load this route',
    description:
      'Retry the bounded request or use its reference ID for support.',
  },
  success: {
    title: 'Request completed',
    description: 'The server confirmed the operation.',
  },
  disabled: {
    title: 'Action disabled',
    description: 'A required condition is not currently satisfied.',
  },
  expired: {
    title: 'Session expired',
    description: 'Sign in with password and MFA to continue.',
  },
  suspended: {
    title: 'Admin access suspended',
    description:
      'This workspace cannot be used. Contact an authorized administrator.',
  },
  'permission-denied': {
    title: 'Permission denied',
    description: 'Your effective server permissions do not allow this route.',
  },
  offline: {
    title: 'You are offline',
    description: 'Reconnect to load current Admin data. No write was queued.',
  },
  retry: {
    title: 'Try again safely',
    description: 'The request did not complete. No success is assumed.',
  },
  stale: {
    title: 'Data is stale',
    description:
      'The last safe shell state is not current. Refresh before acting.',
  },
  conflict: {
    title: 'Server state changed',
    description: 'Refresh and review the current state before trying again.',
  },
  'blocked-prerequisite': {
    title: 'Capability unavailable',
    description: 'A required prerequisite has not been accepted.',
  },
};

export function ShellState({
  kind,
  title,
  description,
  action,
  blockedPrerequisite,
}: ShellStateProps) {
  if (kind === 'loading') {
    return (
      <section
        className="admin-loading"
        aria-label="Loading Admin route"
        aria-live="polite"
      >
        <Skeleton width="38%" height={30} />
        <Skeleton height={180} />
      </section>
    );
  }
  const copy = defaultCopy[kind];
  return (
    <Card className={`admin-shell-state admin-shell-state--${kind}`}>
      {kind === 'success' ? (
        <Alert tone="success" title={title ?? copy.title}>
          {description ?? copy.description}
        </Alert>
      ) : (
        <EmptyState
          title={title ?? copy.title}
          description={description ?? copy.description}
          action={action}
        />
      )}
      {kind === 'blocked-prerequisite' && blockedPrerequisite ? (
        <p className="admin-prerequisite">
          <span>CAPABILITY_UNAVAILABLE</span>
          <code>{blockedPrerequisite}</code>
        </p>
      ) : null}
    </Card>
  );
}

export function ApiErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const described = describeApiError(error);
  const code = error instanceof ApiError ? error.body.code : undefined;
  const prerequisite =
    error instanceof ApiError &&
    typeof error.body.details?.blockedPrerequisite === 'string'
      ? error.body.details.blockedPrerequisite
      : undefined;
  const kind: ShellStateKind =
    described.kind === 'offline'
      ? 'offline'
      : described.kind === 'expired'
        ? 'expired'
        : described.kind === 'forbidden'
          ? 'permission-denied'
          : described.kind === 'suspended'
            ? 'suspended'
            : described.kind === 'conflict'
              ? 'conflict'
              : described.kind === 'stale'
                ? 'stale'
                : described.kind === 'blocked'
                  ? 'blocked-prerequisite'
                  : 'error';
  return (
    <ShellState
      kind={kind}
      title={described.title}
      description={described.detail}
      blockedPrerequisite={prerequisite}
      action={retry ? <Button onClick={retry}>Retry</Button> : undefined}
    />
  );
}

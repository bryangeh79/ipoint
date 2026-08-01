import { ApiError, describeApiError } from '@ipoint/api-client';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Select,
  Table,
} from '@ipoint/ui';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi } from './admin-api.js';
import { useAdminSession } from './admin-session.js';
import { routePath } from './route-manifest.js';

export function LoginScreen() {
  const session = useAdminSession();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const returnTo = safeReturnTo(search.get('returnTo'));

  return (
    <AuthLayout
      eyebrow="Protected operations"
      title="Admin sign in"
      description="Use your eligible Admin account. Multi-factor verification is required before any workspace data is loaded."
    >
      {session.terminalCode ? (
        <TerminalSessionNotice code={session.terminalCode} />
      ) : null}
      {error ? <AuthError error={error} /> : null}
      <form
        className="admin-auth-form"
        onSubmit={async (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          setPending(true);
          setError(undefined);
          const data = new FormData(event.currentTarget);
          try {
            await session.beginLogin(
              formText(data, 'email'),
              formText(data, 'password'),
              returnTo,
            );
            navigate('/admin/mfa/challenge');
          } catch (caught) {
            if (
              caught instanceof ApiError &&
              caught.body.code === 'MFA_ENROLLMENT_REQUIRED'
            ) {
              navigate('/admin/mfa/enroll');
            } else {
              setError(caught);
            }
          } finally {
            setPending(false);
          }
        }}
      >
        <LabelledInput
          name="email"
          label="Admin email"
          type="email"
          autoComplete="username"
          required
        />
        <LabelledInput
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          minLength={12}
          required
        />
        <Button type="submit" fullWidth disabled={pending}>
          {pending ? 'Checking account…' : 'Continue securely'}
        </Button>
      </form>
      <p className="admin-auth-help">
        Setting up MFA for the first time?{' '}
        <Link to="/admin/mfa/enroll">Enroll a factor</Link>
      </p>
    </AuthLayout>
  );
}

export function MfaEnrollmentScreen() {
  const navigate = useNavigate();
  const [enrollment, setEnrollment] = useState<{
    challengeId: string;
    uri: string;
    expiresAt: string;
  }>();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);

  if (recoveryCodes) {
    return (
      <AuthLayout
        eyebrow="One-time recovery set"
        title="Store your recovery codes"
        description="Each code works once. They will not be shown again and are never stored by Admin Web."
      >
        <Alert tone="warning" title="Save these now">
          Store the codes in an approved password manager before continuing.
        </Alert>
        <ol className="admin-recovery-codes">
          {recoveryCodes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ol>
        <Button onClick={() => navigate('/admin/login')}>
          Return to sign in
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="Account protection"
      title="Set up multi-factor authentication"
      description="Confirm your password, add the live TOTP secret to your authenticator, then verify one six-digit code."
    >
      {error ? <AuthError error={error} /> : null}
      {!enrollment ? (
        <form
          className="admin-auth-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(undefined);
            const data = new FormData(event.currentTarget);
            try {
              const result = await adminApi.startMfaEnrollment({
                email: formText(data, 'email'),
                password: formText(data, 'password'),
              });
              setEnrollment({
                challengeId: result.enrollment_challenge_id,
                uri: result.otpauth_uri,
                expiresAt: result.expires_at,
              });
            } catch (caught) {
              setError(caught);
            } finally {
              setPending(false);
            }
          }}
        >
          <LabelledInput
            name="email"
            label="Admin email"
            type="email"
            autoComplete="username"
            required
          />
          <LabelledInput
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            minLength={12}
            required
          />
          <Button type="submit" fullWidth disabled={pending}>
            {pending ? 'Creating factor…' : 'Start enrollment'}
          </Button>
        </form>
      ) : (
        <form
          className="admin-auth-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(undefined);
            const data = new FormData(event.currentTarget);
            try {
              const result = await adminApi.confirmMfaEnrollment({
                challenge_id: enrollment.challengeId,
                code: formText(data, 'code'),
              });
              setEnrollment(undefined);
              setRecoveryCodes(result.recovery_codes);
            } catch (caught) {
              setError(caught);
            } finally {
              setPending(false);
            }
          }}
        >
          <div className="admin-secret-panel" role="status">
            <span>Authenticator setup URI</span>
            <code>{enrollment.uri}</code>
            <small>
              Expires {formatDate(enrollment.expiresAt)}. This value is held in
              memory only.
            </small>
          </div>
          <LabelledInput
            name="code"
            label="Six-digit verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            required
          />
          <Button type="submit" fullWidth disabled={pending}>
            {pending ? 'Verifying…' : 'Confirm enrollment'}
          </Button>
        </form>
      )}
      <p className="admin-auth-help">
        <Link to="/admin/login">Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}

export function MfaChallengeScreen() {
  const session = useAdminSession();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);

  if (!session.pendingChallenge) {
    return (
      <EmptyState
        title="MFA challenge expired"
        description="Restart sign in to receive a new live challenge."
        action={
          <Button onClick={() => navigate('/admin/login')}>
            Restart sign in
          </Button>
        }
      />
    );
  }

  return (
    <AuthLayout
      eyebrow="Second factor"
      title="Verify it’s you"
      description={`Enter the current six-digit code before ${formatDate(session.pendingChallenge.expiresAt)}.`}
    >
      {error ? <AuthError error={error} /> : null}
      <form
        className="admin-auth-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError(undefined);
          const data = new FormData(event.currentTarget);
          try {
            const bootstrap = await session.completeMfa(formText(data, 'code'));
            navigate(
              landingPath(
                bootstrap.currentMarket?.id,
                session.pendingChallenge?.returnTo,
              ),
              { replace: true },
            );
          } catch (caught) {
            setError(caught);
          } finally {
            setPending(false);
          }
        }}
      >
        <LabelledInput
          name="code"
          label="Authentication code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          autoFocus
          required
        />
        <Button type="submit" fullWidth disabled={pending}>
          {pending ? 'Verifying…' : 'Open Admin workspace'}
        </Button>
      </form>
      <p className="admin-auth-help">
        <Link to="/admin/mfa/recovery">Use a recovery code</Link>
      </p>
    </AuthLayout>
  );
}

export function MfaRecoveryScreen() {
  const session = useAdminSession();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  if (!session.pendingChallenge) {
    return (
      <EmptyState
        title="Recovery challenge expired"
        description="Restart sign in before using a recovery code."
        action={
          <Button onClick={() => navigate('/admin/login')}>
            Restart sign in
          </Button>
        }
      />
    );
  }
  return (
    <AuthLayout
      eyebrow="Account recovery"
      title="Use a recovery code"
      description="A recovery code is consumed once. After sign in, re-enroll MFA before any sensitive action."
    >
      {error ? <AuthError error={error} /> : null}
      <form
        className="admin-auth-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError(undefined);
          const data = new FormData(event.currentTarget);
          try {
            const bootstrap = await session.recoverMfa(
              formText(data, 'recoveryCode'),
            );
            navigate(
              landingPath(
                bootstrap.currentMarket?.id,
                session.pendingChallenge?.returnTo,
              ),
              { replace: true },
            );
          } catch (caught) {
            setError(caught);
          } finally {
            setPending(false);
          }
        }}
      >
        <LabelledInput
          name="recoveryCode"
          label="Recovery code"
          autoComplete="one-time-code"
          required
        />
        <Button type="submit" fullWidth disabled={pending}>
          {pending ? 'Checking code…' : 'Recover session'}
        </Button>
      </form>
      <p className="admin-auth-help">
        <Link to="/admin/mfa/challenge">Use authenticator instead</Link>
      </p>
    </AuthLayout>
  );
}

export function MarketSelector({ compact = false }: { compact?: boolean }) {
  const session = useAdminSession();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const id = useId();
  const items = session.markets?.items ?? [];

  if (items.length === 0) {
    return compact ? (
      <span className="admin-market-unavailable">No market access</span>
    ) : (
      <EmptyState
        title="No authorized markets"
        description="An active Market Access grant is required. No market was selected automatically."
      />
    );
  }

  return (
    <div
      className={`admin-market-selector${compact ? ' admin-market-selector--compact' : ''}`}
    >
      {error ? <AuthError error={error} /> : null}
      <FormField label="Current Admin Market" htmlFor={id}>
        <Select
          id={id}
          value={session.markets?.currentMarketId ?? ''}
          disabled={pending}
          onChange={async (event) => {
            const marketId = event.currentTarget.value;
            if (!marketId) return;
            setPending(true);
            setError(undefined);
            try {
              await session.selectMarket(marketId);
            } catch (caught) {
              setError(caught);
            } finally {
              setPending(false);
            }
          }}
        >
          <option value="">Select a market</option>
          {items.map((market) => (
            <option key={market.id} value={market.id}>
              {market.name} ({market.code})
            </option>
          ))}
        </Select>
      </FormField>
    </div>
  );
}

export function SessionsScreen() {
  const session = useAdminSession();
  const navigate = useNavigate();
  const [items, setItems] =
    useState<Awaited<ReturnType<typeof adminApi.sessions>>['sessions']>();
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const load = async () => {
    setError(undefined);
    try {
      setItems((await adminApi.sessions()).sessions);
    } catch (caught) {
      setError(caught);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Security"
        title="Sessions and security"
        description="Review masked device activity and revoke Admin sessions. Tokens and MFA material are never displayed."
      />
      {error ? <AuthError error={error} /> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!items ? (
        <p role="status">Loading sessions…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="No sessions available"
          description="The server returned no visible Admin sessions."
        />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Device</th>
                <th>Last activity</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.deviceLabel}
                    <small>{item.ipAddress ?? 'IP masked'}</small>
                  </td>
                  <td>{formatDate(item.lastActivityAt)}</td>
                  <td>
                    {item.current
                      ? 'Current'
                      : item.revokedAt
                        ? 'Revoked'
                        : 'Active'}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={Boolean(item.revokedAt)}
                      onClick={async () => {
                        try {
                          await adminApi.revokeSession(item.id);
                          if (item.current) {
                            session.clear('SESSION_REVOKED');
                            navigate('/admin/login', { replace: true });
                            return;
                          }
                          setNotice('Session revoked.');
                          await load();
                        } catch (caught) {
                          setError(caught);
                        }
                      }}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <Button
        variant="danger"
        onClick={async () => {
          try {
            await adminApi.revokeAllSessions();
            session.clear('SESSION_REVOKED');
            navigate('/admin/login', { replace: true });
          } catch (caught) {
            setError(caught);
          }
        }}
      >
        Revoke all sessions
      </Button>
    </>
  );
}

function AuthLayout({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-auth-layout">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <Card className="admin-auth-card">{children}</Card>
    </div>
  );
}

function LabelledInput({
  name,
  label,
  ...props
}: React.ComponentProps<typeof Input> & { name: string; label: string }) {
  const id = useId();
  return (
    <FormField label={label} htmlFor={id}>
      <Input id={id} name={name} {...props} />
    </FormField>
  );
}

function AuthError({ error }: { error: unknown }) {
  const description = describeApiError(error);
  return (
    <Alert tone="error" title={description.title}>
      {description.detail}
    </Alert>
  );
}

function TerminalSessionNotice({ code }: { code: string }) {
  const messages: Record<string, string> = {
    SESSION_IDLE_EXPIRED: 'Your session expired due to inactivity.',
    SESSION_ABSOLUTE_EXPIRED: 'Your session reached its absolute expiry.',
    SESSION_FAMILY_EXPIRED: 'Your session family expired.',
    SESSION_REUSE_DETECTED: 'Your session was ended for security.',
    SESSION_REVOKED: 'Your session was revoked.',
  };
  return (
    <Alert tone="warning" title="Sign in again">
      {messages[code] ?? 'Your Admin session ended safely.'}
    </Alert>
  );
}

function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString();
}

function safeReturnTo(value: string | null): string | undefined {
  if (!value || !value.startsWith('/admin/') || value.startsWith('//'))
    return undefined;
  return value;
}

function landingPath(marketId: string | undefined, returnTo?: string): string {
  if (returnTo) return returnTo;
  return marketId ? routePath('dashboard', { marketId }) : '/admin/settings';
}

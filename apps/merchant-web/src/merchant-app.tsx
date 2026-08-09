import { createIdempotencyKey, describeApiError } from '@ipoint/api-client';
import {
  Alert,
  AppShell,
  Badge,
  BottomNavigation,
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  SideNavigation,
  Skeleton,
  Table,
  Textarea,
  TopBar,
  type NavigationItem,
} from '@ipoint/ui';
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import { api } from './api/client';
import { TransactionsPage } from './transactions-page';

type MerchantPage =
  | 'overview'
  | 'access'
  | 'profile'
  | 'verification'
  | 'packages'
  | 'transactions'
  | 'mcp';
type JsonRecord = Record<string, unknown>;
interface MerchantContext {
  branchId: string;
  marketId: string;
}

const contextKey = 'ipoint.merchant.context';
const navigation: ReadonlyArray<NavigationItem> = [
  { id: 'overview', label: 'Overview' },
  { id: 'access', label: 'Access' },
  { id: 'profile', label: 'Profile' },
  { id: 'verification', label: 'Verification' },
  { id: 'packages', label: 'Packages' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'mcp', label: 'MCP' },
];

export function MerchantApp() {
  const [page, setPage] = useState<MerchantPage>('overview');
  const [sessionVersion, setSessionVersion] = useState(0);
  const [context, setContextState] = useState<MerchantContext | undefined>(
    readContext,
  );
  const [sessionExpired, setSessionExpired] = useState(false);
  const forcedState = new URLSearchParams(window.location.search).get('state');
  const items = navigation.map((item) => ({ ...item, href: `#${item.id}` }));

  useEffect(() => {
    const changed = () => setSessionVersion((value) => value + 1);
    const expired = () => {
      setSessionExpired(true);
      setPage('access');
      changed();
    };
    window.addEventListener('ipoint:session-changed', changed);
    window.addEventListener('ipoint:session-expired', expired);
    return () => {
      window.removeEventListener('ipoint:session-changed', changed);
      window.removeEventListener('ipoint:session-expired', expired);
    };
  }, []);

  const updateContext = (value: MerchantContext) => {
    window.localStorage.setItem(contextKey, JSON.stringify(value));
    setContextState(value);
  };
  const navigate = (item: NavigationItem) => setPage(item.id as MerchantPage);

  return (
    <AppShell
      className="merchant-app"
      topBar={
        <TopBar
          brand={<Wordmark />}
          actions={
            <Badge tone={api.tokens ? 'success' : 'warning'}>
              {api.tokens ? 'Live API' : 'Sign in'}
            </Badge>
          }
        />
      }
      sideNavigation={
        <SideNavigation
          items={items}
          activeId={page}
          onNavigate={navigate}
          label="Merchant navigation"
        />
      }
      bottomNavigation={
        <BottomNavigation
          items={items.filter((item) => item.id !== 'access')}
          activeId={page}
          onNavigate={navigate}
          label="Merchant mobile navigation"
        />
      }
    >
      {sessionExpired ? (
        <Alert tone="error" title="Session expired">
          Automatic refresh failed. Sign in again to continue.
        </Alert>
      ) : null}
      {forcedState ? (
        <ForcedState state={forcedState} />
      ) : (
        <MerchantPageView
          key={`${page}-${sessionVersion}`}
          page={page}
          context={context}
          onContext={updateContext}
          onNavigate={setPage}
        />
      )}
    </AppShell>
  );
}

function MerchantPageView(props: {
  page: MerchantPage;
  context?: MerchantContext;
  onContext: (context: MerchantContext) => void;
  onNavigate: (page: MerchantPage) => void;
}) {
  if (props.page === 'access') return <AccessPage {...props} />;
  if (!api.tokens)
    return <SignInRequired onSignIn={() => props.onNavigate('access')} />;
  if (!props.context) return <ContextRequired onSave={props.onContext} />;
  switch (props.page) {
    case 'profile':
      return <ProfilePage context={props.context} />;
    case 'verification':
      return <VerificationPage context={props.context} />;
    case 'packages':
      return <PackagesPage context={props.context} />;
    case 'transactions':
      return <TransactionsPage context={props.context} />;
    case 'mcp':
      return <McpPage context={props.context} />;
    default:
      return <OverviewPage context={props.context} />;
  }
}

function AccessPage(props: {
  context?: MerchantContext;
  onContext: (context: MerchantContext) => void;
  onNavigate: (page: MerchantPage) => void;
}) {
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const [otp, setOtp] = useState<{ id: string; code: string }>();
  const [resetOtp, setResetOtp] = useState<{ id: string; code: string }>();
  const run = async (operation: () => Promise<void>) => {
    setError(undefined);
    setNotice('');
    try {
      await operation();
    } catch (caught) {
      setError(caught);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Secure merchant access"
        title="Account access"
        description="Registration, OTP verification, login, refresh, and password recovery use the live Auth API."
      />
      {error ? <ErrorAlert error={error} /> : null}
      {notice ? (
        <Alert tone="success" title="Request completed">
          {notice}
        </Alert>
      ) : null}
      <div className="merchant-two-column">
        <Card>
          <SectionHeading title="Login" />
          <LiveForm
            submitLabel="Login"
            onSubmit={(data) =>
              run(async () => {
                await api.login(text(data, 'email'), text(data, 'password'));
                props.onContext({
                  branchId: text(data, 'branchId'),
                  marketId: text(data, 'marketId'),
                });
                props.onNavigate('overview');
              })
            }
          >
            <Field name="email" label="Login email" type="email" required />
            <Field
              name="password"
              label="Password"
              type="password"
              required
              minLength={12}
            />
            <Field
              name="branchId"
              label="Branch ID"
              required
              defaultValue={props.context?.branchId}
            />
            <Field
              name="marketId"
              label="Market ID"
              required
              defaultValue={props.context?.marketId}
            />
          </LiveForm>
          {api.tokens ? (
            <Button
              variant="secondary"
              onClick={() => {
                api.clearSession();
                setNotice('Signed out locally.');
              }}
            >
              Sign out
            </Button>
          ) : null}
        </Card>
        <Card>
          <SectionHeading title="Register merchant" />
          <LiveForm
            submitLabel={otp ? 'Verify OTP and register' : 'Issue email OTP'}
            onSubmit={(data) =>
              run(async () => {
                const email = text(data, 'email');
                if (!otp) {
                  const issued = await api.request<{
                    otp_id: string;
                    development_code?: string;
                  }>('/auth/otp/issue', {
                    method: 'POST',
                    anonymous: true,
                    body: { destination: email, purpose: 'EMAIL_VERIFICATION' },
                  });
                  setOtp({
                    id: issued.otp_id,
                    code: issued.development_code ?? '',
                  });
                  setNotice(
                    'OTP issued. Enter the delivered code and submit again.',
                  );
                  return;
                }
                const code = text(data, 'otpCode') || otp.code;
                await api.request('/auth/otp/verify', {
                  method: 'POST',
                  anonymous: true,
                  body: { otp_id: otp.id, code },
                });
                const registered = await api.request<{ branch_id: string }>(
                  '/merchant/register',
                  {
                    method: 'POST',
                    anonymous: true,
                    idempotencyKey: createIdempotencyKey(),
                    body: {
                      email,
                      password: text(data, 'password'),
                      otp_id: otp.id,
                      otp_code: code,
                      market_id: text(data, 'marketId'),
                      account_country: text(data, 'country'),
                      channel: text(data, 'channel'),
                      display_name: text(data, 'displayName'),
                      phone: text(data, 'phone') || undefined,
                      terms_version: text(data, 'termsVersion'),
                      locale: 'en-MY',
                    },
                  },
                );
                props.onContext({
                  branchId: registered.branch_id,
                  marketId: text(data, 'marketId'),
                });
                await api.login(email, text(data, 'password'));
                setNotice('Merchant registered and authenticated.');
                props.onNavigate('profile');
              })
            }
          >
            <Field name="email" label="Email" type="email" required />
            <Field
              name="password"
              label="Password"
              type="password"
              required
              minLength={12}
            />
            <Field name="displayName" label="Business display name" required />
            <Field name="phone" label="Phone" />
            <Field name="marketId" label="Market ID" required />
            <Field
              name="country"
              label="Account country"
              defaultValue="MY"
              required
              maxLength={2}
            />
            <Field name="channel" label="Channel" defaultValue="web" required />
            <Field
              name="termsVersion"
              label="Terms version"
              defaultValue="merchant-terms-v1"
              required
            />
            {otp ? (
              <Field
                name="otpCode"
                label="OTP code"
                defaultValue={otp.code}
                required
              />
            ) : null}
          </LiveForm>
        </Card>
        <Card>
          <SectionHeading title="Password reset" />
          <LiveForm
            submitLabel={
              resetOtp ? 'Verify and reset password' : 'Issue reset OTP'
            }
            onSubmit={(data) =>
              run(async () => {
                const email = text(data, 'email');
                if (!resetOtp) {
                  const issued = await api.request<{
                    otp_id: string;
                    development_code?: string;
                  }>('/auth/otp/issue', {
                    method: 'POST',
                    anonymous: true,
                    body: { destination: email, purpose: 'PASSWORD_RESET' },
                  });
                  setResetOtp({
                    id: issued.otp_id,
                    code: issued.development_code ?? '',
                  });
                  setNotice('Password reset OTP issued.');
                  return;
                }
                const code = text(data, 'otpCode') || resetOtp.code;
                await api.request('/auth/otp/verify', {
                  method: 'POST',
                  anonymous: true,
                  body: { otp_id: resetOtp.id, code },
                });
                await api.request('/auth/password/reset', {
                  method: 'POST',
                  anonymous: true,
                  body: {
                    otp_id: resetOtp.id,
                    new_password: text(data, 'newPassword'),
                  },
                });
                setNotice('Password reset completed.');
                setResetOtp(undefined);
              })
            }
          >
            <Field name="email" label="Login email" type="email" required />
            {resetOtp ? (
              <>
                <Field
                  name="otpCode"
                  label="OTP code"
                  defaultValue={resetOtp.code}
                  required
                />
                <Field
                  name="newPassword"
                  label="New password"
                  type="password"
                  required
                  minLength={12}
                />
              </>
            ) : null}
          </LiveForm>
        </Card>
      </div>
    </>
  );
}

function OverviewPage({ context }: { context: MerchantContext }) {
  const resource = useLiveResource(async () => {
    const options = { marketId: context.marketId };
    const [profile, application, kyc, packages, mcp] = await Promise.all([
      api.request<JsonRecord>(
        `/merchant/branches/${context.branchId}/profile`,
        options,
      ),
      api.request<JsonRecord>(
        `/merchant/branches/${context.branchId}/application`,
        options,
      ),
      api.request<JsonRecord>(
        `/merchant/branches/${context.branchId}/kyc`,
        options,
      ),
      api.request<JsonRecord>(
        `/merchant/branches/${context.branchId}/packages`,
        options,
      ),
      api.request<JsonRecord>(
        `/merchant/branches/${context.branchId}/mcp`,
        options,
      ),
    ]);
    return { profile, application, kyc, packages, mcp };
  }, [context.branchId, context.marketId]);
  return (
    <ResourceBoundary
      resource={resource}
      emptyMessage="No merchant branch data is available."
    >
      {(data) => (
        <>
          <PageHeader
            eyebrow={`Branch ${context.branchId}`}
            title={display(
              data.profile.display_name ?? data.profile.name,
              'Merchant overview',
            )}
            description="Live onboarding, package, and MCP state from PostgreSQL-backed APIs."
            actions={
              <Button variant="secondary" onClick={resource.reload}>
                Refresh
              </Button>
            }
          />
          <div className="merchant-stat-grid">
            <LiveCard
              title="Operational status"
              value={display(
                data.application.operational_status ??
                  data.profile.operational_status ??
                  data.profile.status,
                'Pending',
              ).replaceAll('_', ' ')}
            />
            <LiveCard
              title="Application"
              value={nestedStatus(data.application)}
            />
            <LiveCard title="KYC" value={nestedStatus(data.kyc)} />
            <LiveCard
              title="MCP available"
              value={display(data.mcp.available_balance, '0')}
            />
          </div>
          <Card>
            <SectionHeading title="Activation evidence" />
            <JsonDetails value={data} />
          </Card>
        </>
      )}
    </ResourceBoundary>
  );
}

function ProfilePage({ context }: { context: MerchantContext }) {
  const resource = useLiveResource(
    () =>
      api.request<JsonRecord>(
        `/merchant/branches/${context.branchId}/profile`,
        { marketId: context.marketId },
      ),
    [context.branchId, context.marketId],
  );
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  return (
    <ResourceBoundary resource={resource}>
      {(profile) => (
        <>
          <PageHeader
            eyebrow="Public merchant profile"
            title="Profile and media"
            description="Fields load from and save to the live branch profile endpoint."
          />
          {error ? <ErrorAlert error={error} /> : null}
          {result ? <Alert tone="success">Profile saved.</Alert> : null}
          <Card>
            <LiveForm
              submitLabel="Save profile"
              onSubmit={async (data) => {
                setError(undefined);
                try {
                  const saved = await api.request(
                    `/merchant/branches/${context.branchId}/profile`,
                    {
                      method: 'PATCH',
                      marketId: context.marketId,
                      idempotencyKey: createIdempotencyKey(),
                      body: {
                        display_name: text(data, 'displayName'),
                        phone: nullableText(data, 'phone'),
                        about: nullableText(data, 'about'),
                        website: nullableText(data, 'website'),
                        address: {
                          line_1: text(data, 'line1'),
                          city: text(data, 'city'),
                          state: text(data, 'state'),
                          postcode: text(data, 'postcode'),
                          country_code: text(data, 'country'),
                        },
                      },
                    },
                  );
                  setResult(saved);
                  resource.reload();
                } catch (caught) {
                  setError(caught);
                }
              }}
            >
              <div className="merchant-form-grid">
                <Field
                  name="displayName"
                  label="Display name"
                  defaultValue={stringValue(
                    profile.display_name ?? profile.name,
                  )}
                  required
                />
                <Field
                  name="phone"
                  label="Phone"
                  defaultValue={stringValue(profile.phone)}
                />
                <Field
                  name="website"
                  label="Website"
                  type="url"
                  defaultValue={stringValue(profile.website)}
                />
                <Field
                  name="line1"
                  label="Address line"
                  defaultValue={nestedString(profile, 'address', 'line_1')}
                  required
                />
                <Field
                  name="city"
                  label="City"
                  defaultValue={nestedString(profile, 'address', 'city')}
                  required
                />
                <Field
                  name="state"
                  label="State"
                  defaultValue={nestedString(profile, 'address', 'state')}
                  required
                />
                <Field
                  name="postcode"
                  label="Postcode"
                  defaultValue={nestedString(profile, 'address', 'postcode')}
                  required
                />
                <Field
                  name="country"
                  label="Country"
                  defaultValue={
                    nestedString(profile, 'address', 'country_code') || 'MY'
                  }
                  required
                  maxLength={2}
                />
              </div>
              <FormField label="About us" htmlFor="about">
                <Textarea
                  id="about"
                  name="about"
                  defaultValue={stringValue(profile.about)}
                  rows={4}
                />
              </FormField>
            </LiveForm>
          </Card>
        </>
      )}
    </ResourceBoundary>
  );
}

function VerificationPage({ context }: { context: MerchantContext }) {
  const resource = useLiveResource(
    async () => ({
      application: await api.request<JsonRecord>(
        `/merchant/branches/${context.branchId}/application`,
        { marketId: context.marketId },
      ),
      kyc: await api.request<JsonRecord>(
        `/merchant/branches/${context.branchId}/kyc`,
        { marketId: context.marketId },
      ),
    }),
    [context.branchId, context.marketId],
  );
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const submit = async (operation: () => Promise<void>) => {
    setError(undefined);
    setNotice('');
    try {
      await operation();
      resource.reload();
    } catch (caught) {
      setError(caught);
    }
  };
  return (
    <ResourceBoundary resource={resource}>
      {(data) => (
        <>
          <PageHeader
            eyebrow="Application and KYC"
            title="Verification center"
            description="Submissions and document intents are persisted as immutable evidence."
          />
          {error ? <ErrorAlert error={error} /> : null}
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          <div className="merchant-two-column">
            <Card>
              <SectionHeading
                title={`Application · ${nestedStatus(data.application)}`}
              />
              <JsonDetails value={data.application} />
              <LiveForm
                submitLabel="Submit application"
                onSubmit={(form) =>
                  submit(async () => {
                    await api.request(
                      `/merchant/branches/${context.branchId}/application/submit`,
                      {
                        method: 'POST',
                        marketId: context.marketId,
                        idempotencyKey: createIdempotencyKey(),
                        body: {
                          application_data: {
                            registration_number: text(
                              form,
                              'registrationNumber',
                            ),
                            business_activity: text(form, 'businessActivity'),
                          },
                        },
                      },
                    );
                    setNotice('Application submitted.');
                  })
                }
              >
                <Field
                  name="registrationNumber"
                  label="Registration number"
                  required
                />
                <Field
                  name="businessActivity"
                  label="Business activity"
                  required
                />
              </LiveForm>
            </Card>
            <Card>
              <SectionHeading title={`KYC · ${nestedStatus(data.kyc)}`} />
              <JsonDetails value={data.kyc} />
              <LiveForm
                submitLabel="Create documents and submit KYC"
                onSubmit={(form) =>
                  submit(async () => {
                    const ids: string[] = [];
                    for (const [type, character] of [
                      ['business_registration', 'a'],
                      ['pic_identity', 'b'],
                      ['pic_address_proof', 'c'],
                    ] as const) {
                      const document = await api.request<{ id: string }>(
                        `/merchant/branches/${context.branchId}/documents/upload-intent`,
                        {
                          method: 'POST',
                          marketId: context.marketId,
                          idempotencyKey: createIdempotencyKey(),
                          body: {
                            document_type: type,
                            file_name: `${type}.pdf`,
                            mime_type: 'application/pdf',
                            file_size_bytes: 1024,
                            content_hash: character.repeat(64),
                          },
                        },
                      );
                      ids.push(document.id);
                    }
                    await api.request(
                      `/merchant/branches/${context.branchId}/kyc/submit`,
                      {
                        method: 'POST',
                        marketId: context.marketId,
                        idempotencyKey: createIdempotencyKey(),
                        body: {
                          business_certification: {
                            registration_number: text(
                              form,
                              'registrationNumber',
                            ),
                            business_name_registered: text(
                              form,
                              'businessName',
                            ),
                            business_type: 'private_limited',
                            tax_id: text(form, 'taxId'),
                            registered_address: text(form, 'address'),
                            proof_of_registration_document_id: ids[0],
                          },
                          pic_identity: {
                            full_name: text(form, 'fullName'),
                            identity_type: 'nric',
                            identity_number: text(form, 'identityNumber'),
                            date_of_birth: text(form, 'dateOfBirth'),
                            nationality: text(form, 'nationality'),
                            proof_of_identity_document_id: ids[1],
                            proof_of_address_document_id: ids[2],
                          },
                          pic_contact: {
                            email: text(form, 'email'),
                            phone: text(form, 'phone'),
                          },
                        },
                      },
                    );
                    setNotice(
                      'KYC submitted with three private document records.',
                    );
                  })
                }
              >
                <Field
                  name="registrationNumber"
                  label="Registration number"
                  required
                />
                <Field
                  name="businessName"
                  label="Registered business name"
                  required
                />
                <Field name="taxId" label="Tax ID" required />
                <Field name="address" label="Registered address" required />
                <Field name="fullName" label="Person in charge" required />
                <Field name="identityNumber" label="Identity number" required />
                <Field
                  name="dateOfBirth"
                  label="Date of birth"
                  type="date"
                  required
                />
                <Field
                  name="nationality"
                  label="Nationality"
                  defaultValue="MY"
                  required
                />
                <Field
                  name="email"
                  label="Contact email"
                  type="email"
                  required
                />
                <Field name="phone" label="Contact phone" required />
              </LiveForm>
            </Card>
          </div>
        </>
      )}
    </ResourceBoundary>
  );
}

function PackagesPage({ context }: { context: MerchantContext }) {
  const resource = useLiveResource(
    () =>
      api.request<{ items: JsonRecord[] }>(
        `/merchant/branches/${context.branchId}/packages`,
        { marketId: context.marketId },
      ),
    [context.branchId, context.marketId],
  );
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const action = async (
    path: string,
    method: 'POST' | 'PATCH',
    body?: unknown,
  ) => {
    setError(undefined);
    try {
      await api.request(path, {
        method,
        body,
        marketId: context.marketId,
        idempotencyKey: createIdempotencyKey(),
      });
      setNotice('Package request completed.');
      resource.reload();
    } catch (caught) {
      setError(caught);
    }
  };
  return (
    <ResourceBoundary
      resource={resource}
      empty={(data) => data.items.length === 0}
    >
      {(data) => (
        <>
          <PageHeader
            eyebrow="Versioned service fees"
            title="Service fee packages"
            description="Live assignment state; last-active protection remains enforced by the API."
          />
          {error ? <ErrorAlert error={error} /> : null}
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          <Card>
            <Table>
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Rate</th>
                  <th>Status</th>
                  <th>Default</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={String(item.id)}>
                    <td>{String(item.name ?? item.code ?? item.id)}</td>
                    <td>{display(item.rate)}%</td>
                    <td>
                      <Badge>{String(item.status)}</Badge>
                    </td>
                    <td>{item.isDefault || item.is_default ? 'Yes' : 'No'}</td>
                    <td>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          action(
                            `/merchant/branches/${context.branchId}/packages/assignments/${String(item.id)}/${String(item.status).toUpperCase() === 'PAUSED' ? 'resume' : 'pause'}`,
                            'PATCH',
                          )
                        }
                      >
                        {String(item.status).toUpperCase() === 'PAUSED'
                          ? 'Resume'
                          : 'Pause'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card>
            <LiveForm
              submitLabel="Request package change"
              onSubmit={(form) =>
                action(
                  `/merchant/branches/${context.branchId}/packages/change-requests`,
                  'POST',
                  {
                    service_fee_version_id: text(form, 'versionId'),
                    reason: text(form, 'reason'),
                  },
                )
              }
            >
              <Field name="versionId" label="Service fee version ID" required />
              <Field name="reason" label="Reason" required />
            </LiveForm>
          </Card>
        </>
      )}
    </ResourceBoundary>
  );
}

function McpPage({ context }: { context: MerchantContext }) {
  const resource = useLiveResource(
    async () => ({
      summary: await api.request<JsonRecord>(
        `/merchant/branches/${context.branchId}/mcp`,
        { marketId: context.marketId },
      ),
      ledger: await api.request<{ items: JsonRecord[] }>(
        `/merchant/branches/${context.branchId}/mcp/ledger`,
        { marketId: context.marketId },
      ),
    }),
    [context.branchId, context.marketId],
  );
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  return (
    <ResourceBoundary resource={resource}>
      {(data) => (
        <>
          <PageHeader
            eyebrow="Append-only merchant credit"
            title="MCP account"
            description="Balances and entries load from the immutable MCP ledger."
          />
          {error ? <ErrorAlert error={error} /> : null}
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          <div className="merchant-stat-grid">
            <LiveCard
              title="Available"
              value={display(data.summary.available_balance, '0')}
            />
            <LiveCard
              title="Total"
              value={display(data.summary.total_balance, '0')}
            />
            <LiveCard title="Status" value={display(data.summary.status)} />
          </div>
          <Card>
            <Table>
              <thead>
                <tr>
                  <th>Sequence</th>
                  <th>Type</th>
                  <th>Direction</th>
                  <th>Amount</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {data.ledger.items.map((item) => (
                  <tr key={String(item.id)}>
                    <td>{String(item.sequence)}</td>
                    <td>{String(item.entryType ?? item.entry_type)}</td>
                    <td>{String(item.direction)}</td>
                    <td>{String(item.amount)}</td>
                    <td>{String(item.createdAt ?? item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <div className="merchant-two-column">
            <Card>
              <SectionHeading title="Refund request" />
              <LiveForm
                submitLabel="Submit refund"
                onSubmit={async (form) => {
                  setError(undefined);
                  try {
                    await api.request(
                      `/merchant/branches/${context.branchId}/mcp/refunds`,
                      {
                        method: 'POST',
                        marketId: context.marketId,
                        idempotencyKey: createIdempotencyKey(),
                        body: {
                          amount: text(form, 'amount'),
                          reason: text(form, 'reason'),
                        },
                      },
                    );
                    setNotice('Refund request submitted.');
                  } catch (caught) {
                    setError(caught);
                  }
                }}
              >
                <Field name="amount" label="Amount" required />
                <Field name="reason" label="Reason" required />
              </LiveForm>
            </Card>
            <Card>
              <SectionHeading title="Recharge assistance" />
              <Alert tone="info">
                Recharge creation is an Admin-authorized operation. The merchant
                view remains read-only until Finance verifies funds.
              </Alert>
            </Card>
          </div>
        </>
      )}
    </ResourceBoundary>
  );
}

function ResourceBoundary<T>({
  resource,
  children,
  empty,
  emptyMessage = 'No records found.',
}: {
  resource: Resource<T>;
  children: (data: T) => ReactNode;
  empty?: (data: T) => boolean;
  emptyMessage?: string;
}) {
  if (resource.loading) return <Loading />;
  if (resource.error)
    return (
      <>
        <ErrorState error={resource.error} retry={resource.reload} />
      </>
    );
  if (resource.data === undefined || empty?.(resource.data))
    return (
      <EmptyState
        title="Nothing here yet"
        description={emptyMessage}
        action={<Button onClick={resource.reload}>Retry</Button>}
      />
    );
  return children(resource.data);
}

interface Resource<T> {
  data?: T;
  error?: unknown;
  loading: boolean;
  reload: () => void;
}
function useLiveResource<T>(
  loader: () => Promise<T>,
  dependencies: ReadonlyArray<unknown>,
): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    loader()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [...dependencies, version]);
  return { data, error, loading, reload };
}

function LiveForm({
  children,
  submitLabel,
  onSubmit,
}: {
  children: ReactNode;
  submitLabel: string;
  onSubmit: (data: FormData) => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <form
      className="merchant-panel"
      onSubmit={async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setPending(true);
        try {
          await onSubmit(new FormData(event.currentTarget));
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
      <Button type="submit" disabled={pending}>
        {pending ? 'Working…' : submitLabel}
      </Button>
    </form>
  );
}
function Field(props: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  minLength?: number;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <FormField label={props.label} htmlFor={id}>
      <Input id={id} {...props} />
    </FormField>
  );
}
function ErrorAlert({ error }: { error: unknown }) {
  const described = describeApiError(error);
  return (
    <Alert tone="error" title={described.title}>
      {described.detail}
    </Alert>
  );
}
function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  const described = describeApiError(error);
  return (
    <EmptyState
      title={described.title}
      description={described.detail}
      action={<Button onClick={retry}>Retry</Button>}
    />
  );
}
function Loading() {
  return (
    <section
      aria-label="Loading merchant workspace"
      className="merchant-loading"
    >
      <Skeleton width="38%" height={28} />
      <Skeleton width="70%" height={18} />
      <Skeleton height={180} />
    </section>
  );
}
function SignInRequired({ onSignIn }: { onSignIn: () => void }) {
  return (
    <EmptyState
      title="Sign in required"
      description="Authenticate before loading protected merchant data."
      action={<Button onClick={onSignIn}>Open account access</Button>}
    />
  );
}
function ContextRequired({
  onSave,
}: {
  onSave: (context: MerchantContext) => void;
}) {
  return (
    <Card>
      <SectionHeading title="Select branch context" />
      <LiveForm
        submitLabel="Load branch"
        onSubmit={(data) =>
          onSave({
            branchId: text(data, 'branchId'),
            marketId: text(data, 'marketId'),
          })
        }
      >
        <Field name="branchId" label="Branch ID" required />
        <Field name="marketId" label="Market ID" required />
      </LiveForm>
    </Card>
  );
}
function ForcedState({ state }: { state: string }) {
  if (state === 'loading') return <Loading />;
  const map: Record<string, [string, string]> = {
    empty: [
      'No merchant data yet',
      'Complete registration to create the first branch.',
    ],
    offline: ['You are offline', 'Reconnect to load live merchant data.'],
    forbidden: [
      'Permission denied',
      'This account does not own the requested branch.',
    ],
    expired: ['Session expired', 'Log in again to continue.'],
    error: [
      'Unable to load the workspace',
      'Retry the request or contact support.',
    ],
  };
  const copy = map[state] ?? map.error!;
  return <EmptyState title={copy[0]} description={copy[1]} />;
}
function LiveCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <small>{title}</small>
      <h2>{value}</h2>
    </Card>
  );
}
function JsonDetails({ value }: { value: unknown }) {
  return (
    <pre className="merchant-live-json">{JSON.stringify(value, null, 2)}</pre>
  );
}
function SectionHeading({ title }: { title: string }) {
  return (
    <div className="merchant-section-heading">
      <h2>{title}</h2>
    </div>
  );
}
function Wordmark() {
  return (
    <span className="merchant-wordmark">
      <span aria-hidden="true">i</span>
      <strong>Point</strong>
      <small>Merchant</small>
    </span>
  );
}
function readContext(): MerchantContext | undefined {
  const value = window.localStorage.getItem(contextKey);
  if (!value) return undefined;
  try {
    return JSON.parse(value) as MerchantContext;
  } catch {
    return undefined;
  }
}
function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
function nullableText(data: FormData, key: string): string | null {
  return text(data, key) || null;
}
function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function display(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${value}`;
  return fallback;
}
function nestedString(
  value: JsonRecord,
  parent: string,
  child: string,
): string {
  const item = value[parent];
  return item && typeof item === 'object'
    ? stringValue((item as JsonRecord)[child])
    : '';
}
function nestedStatus(value: JsonRecord): string {
  const current = value.current;
  if (current && typeof current === 'object')
    return display((current as JsonRecord).status, 'Not submitted');
  return display(value.status ?? value.application_status, 'Not submitted');
}

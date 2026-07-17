import {
  ApiClient,
  createIdempotencyKey,
  describeApiError,
} from '@ipoint/api-client';
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  SideNavigation,
  Skeleton,
  Table,
  Tabs,
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

type AdminPage =
  | 'overview'
  | 'merchants'
  | 'reviews'
  | 'packages'
  | 'mcp'
  | 'audit';
type JsonRecord = Record<string, unknown>;
interface AdminContext {
  marketId: string;
  branchId?: string;
  accountId?: string;
}

const apiBaseUrl: string =
  typeof import.meta.env.VITE_API_BASE_URL === 'string'
    ? import.meta.env.VITE_API_BASE_URL
    : '/api/v1';
const api = new ApiClient(apiBaseUrl, 'ipoint.admin.session');
const contextKey = 'ipoint.admin.context';
const navigation: ReadonlyArray<NavigationItem> = [
  { id: 'overview', label: 'Overview' },
  { id: 'merchants', label: 'Merchants' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'packages', label: 'Packages' },
  { id: 'mcp', label: 'MCP' },
  { id: 'audit', label: 'Audit' },
];

export function AdminApp() {
  const [page, setPage] = useState<AdminPage>('overview');
  const [context, setContextState] = useState<AdminContext | undefined>(
    readContext,
  );
  const [sessionVersion, setSessionVersion] = useState(0);
  const [expired, setExpired] = useState(false);
  const forcedState = new URLSearchParams(window.location.search).get('state');
  useEffect(() => {
    const changed = () => setSessionVersion((value) => value + 1);
    const sessionExpired = () => {
      setExpired(true);
      changed();
    };
    window.addEventListener('ipoint:session-changed', changed);
    window.addEventListener('ipoint:session-expired', sessionExpired);
    return () => {
      window.removeEventListener('ipoint:session-changed', changed);
      window.removeEventListener('ipoint:session-expired', sessionExpired);
    };
  }, []);
  const updateContext = (value: AdminContext) => {
    window.localStorage.setItem(contextKey, JSON.stringify(value));
    setContextState(value);
  };
  const items = navigation.map((item) => ({ ...item, href: `#${item.id}` }));
  return (
    <AppShell
      className="admin-app"
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
          onNavigate={(item) => setPage(item.id as AdminPage)}
          label="Admin navigation"
        />
      }
    >
      {expired ? (
        <Alert tone="error" title="Session expired">
          Refresh failed. Log in again; no server data was lost.
        </Alert>
      ) : null}
      {forcedState ? (
        <ForcedState state={forcedState} />
      ) : (
        <AdminPageView
          key={`${page}-${sessionVersion}`}
          page={page}
          context={context}
          onContext={updateContext}
        />
      )}
    </AppShell>
  );
}

function AdminPageView({
  page,
  context,
  onContext,
}: {
  page: AdminPage;
  context?: AdminContext;
  onContext: (value: AdminContext) => void;
}) {
  if (!api.tokens || !context)
    return <AdminLogin context={context} onContext={onContext} />;
  switch (page) {
    case 'merchants':
      return <MerchantsPage context={context} onContext={onContext} />;
    case 'reviews':
      return <ReviewsPage context={context} />;
    case 'packages':
      return <PackagesPage context={context} />;
    case 'mcp':
      return <McpPage context={context} />;
    case 'audit':
      return <AuditPage context={context} />;
    default:
      return <OverviewPage context={context} />;
  }
}

function AdminLogin({
  context,
  onContext,
}: {
  context?: AdminContext;
  onContext: (value: AdminContext) => void;
}) {
  const [error, setError] = useState<unknown>();
  return (
    <>
      <PageHeader
        eyebrow="Protected operations"
        title="Admin login"
        description="Role, MarketAccess, and Action Permission remain server-enforced."
      />
      {error ? <ErrorAlert error={error} /> : null}
      <Card className="admin-auth-card">
        <LiveForm
          submitLabel="Login"
          onSubmit={async (data) => {
            setError(undefined);
            try {
              await api.login(text(data, 'email'), text(data, 'password'));
              onContext({
                marketId: text(data, 'marketId'),
                branchId: optional(data, 'branchId'),
                accountId: optional(data, 'accountId'),
              });
            } catch (caught) {
              setError(caught);
            }
          }}
        >
          <Field name="email" label="Admin email" type="email" required />
          <Field
            name="password"
            label="Password"
            type="password"
            minLength={12}
            required
          />
          <Field
            name="marketId"
            label="Market ID"
            defaultValue={context?.marketId}
            required
          />
          <Field
            name="branchId"
            label="Branch ID (optional)"
            defaultValue={context?.branchId}
          />
          <Field
            name="accountId"
            label="MCP account ID (optional)"
            defaultValue={context?.accountId}
          />
        </LiveForm>
      </Card>
    </>
  );
}

function OverviewPage({ context }: { context: AdminContext }) {
  const resource = useResource(
    () =>
      api.request<{ items: JsonRecord[] }>(
        `/admin/markets/${context.marketId}/merchants?limit=20`,
      ),
    [context.marketId],
  );
  return (
    <Boundary resource={resource}>
      {(data) => (
        <>
          <PageHeader
            eyebrow="Market operations"
            title="Admin command center"
            description="Merchant state is loaded from the live market-scoped API."
            actions={
              <Button variant="secondary" onClick={resource.reload}>
                Refresh
              </Button>
            }
          />
          <div className="admin-stat-grid">
            <Metric title="Merchants" value={String(data.items.length)} />
            <Metric
              title="Active"
              value={String(
                data.items.filter((item) => item.status === 'ACTIVE').length,
              )}
            />
            <Metric
              title="Pending review"
              value={String(
                data.items.filter((item) =>
                  String(item.status).startsWith('PENDING'),
                ).length,
              )}
            />
          </div>
          <Card>
            <Json value={data.items.slice(0, 5)} />
          </Card>
        </>
      )}
    </Boundary>
  );
}

function MerchantsPage({
  context,
  onContext,
}: {
  context: AdminContext;
  onContext: (value: AdminContext) => void;
}) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const resource = useResource(
    () =>
      api.request<{ items: JsonRecord[] }>(
        `/admin/markets/${context.marketId}/merchants?limit=100${query ? `&query=${encodeURIComponent(query)}` : ''}`,
      ),
    [context.marketId, query],
  );
  const statusAction = async (
    branchId: string,
    action: 'suspend' | 'reactivate',
  ) => {
    setError(undefined);
    try {
      await api.request(
        `/admin/markets/${context.marketId}/merchants/${branchId}/${action}`,
        {
          method: 'POST',
          idempotencyKey: createIdempotencyKey(),
          body: { reason: `${action} requested from Admin workspace.` },
        },
      );
      setNotice(`${action} completed.`);
      resource.reload();
    } catch (caught) {
      setError(caught);
    }
  };
  return (
    <Boundary resource={resource} empty={(data) => data.items.length === 0}>
      {(data) => (
        <>
          <PageHeader
            eyebrow="Market-scoped directory"
            title="Merchants"
            description="Search and operational status controls use live APIs."
          />
          {error ? <ErrorAlert error={error} /> : null}
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          <Card>
            <FormField label="Search merchants" htmlFor="merchant-search">
              <Input
                id="merchant-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </FormField>
            <Table>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Status</th>
                  <th>Application</th>
                  <th>KYC</th>
                  <th>MCP</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={String(item.branch_id)}>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          onContext({
                            ...context,
                            branchId: String(item.branch_id),
                            accountId:
                              stringValue(item.mcp_account_id) ||
                              context.accountId,
                          })
                        }
                      >
                        {String(item.name)}
                        <small>{String(item.merchant_id)}</small>
                      </Button>
                    </td>
                    <td>
                      <Status value={String(item.status)} />
                    </td>
                    <td>{display(item.application_status, 'DRAFT')}</td>
                    <td>{display(item.kyc_status, 'DRAFT')}</td>
                    <td>{display(item.available_balance, '0')}</td>
                    <td>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          statusAction(
                            String(item.branch_id),
                            item.status === 'SUSPENDED'
                              ? 'reactivate'
                              : 'suspend',
                          )
                        }
                      >
                        {item.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </Boundary>
  );
}

function ReviewsPage({ context }: { context: AdminContext }) {
  const [tab, setTab] = useState('application');
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const resource = useResource(
    async () => ({
      applications: await api.request<JsonRecord[]>(
        `/admin/markets/${context.marketId}/merchants/applications`,
      ),
      kyc: await api.request<JsonRecord[]>(
        `/admin/markets/${context.marketId}/merchants/kyc`,
      ),
    }),
    [context.marketId],
  );
  const review = async (
    branchId: string,
    type: 'application' | 'kyc',
    decision: string,
  ) => {
    setError(undefined);
    try {
      if (type === 'kyc')
        await api.request(
          `/admin/markets/${context.marketId}/merchants/${branchId}/kyc/review`,
        );
      await api.request(
        `/admin/markets/${context.marketId}/merchants/${branchId}/${type}/review`,
        {
          method: 'POST',
          idempotencyKey: createIdempotencyKey(),
          body:
            type === 'kyc'
              ? {
                  decision,
                  reason: 'Evidence verified in Admin workspace.',
                  rejected_fields: [],
                }
              : { decision, reason: 'Application evidence verified.' },
        },
      );
      setNotice(`${type} ${decision.toLowerCase()}.`);
      resource.reload();
    } catch (caught) {
      setError(caught);
    }
  };
  return (
    <Boundary resource={resource}>
      {(data) => {
        const items = tab === 'application' ? data.applications : data.kyc;
        return (
          <>
            <PageHeader
              eyebrow="Independent decisions"
              title="Application and KYC reviews"
              description="Application and KYC remain separate state machines."
            />
            {error ? <ErrorAlert error={error} /> : null}
            {notice ? <Alert tone="success">{notice}</Alert> : null}
            <Card>
              <Tabs
                label="Review queues"
                activeId={tab}
                onChange={setTab}
                tabs={[
                  { id: 'application', label: 'Application review' },
                  { id: 'kyc', label: 'KYC review' },
                ]}
              />
              {items.length === 0 ? (
                <EmptyState
                  title="Queue is empty"
                  description="No submitted records require review."
                />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>Branch</th>
                      <th>Status</th>
                      <th>Version</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const branchId = String(
                        item.branchId ??
                          item.branch_id ??
                          item.merchantBranchId ??
                          item.merchant_branch_id,
                      );
                      return (
                        <tr key={display(item.id, branchId)}>
                          <td>{branchId}</td>
                          <td>{String(item.status)}</td>
                          <td>
                            {display(
                              item.submissionVersion ?? item.submission_version,
                            )}
                          </td>
                          <td>
                            <Button
                              size="sm"
                              onClick={() =>
                                review(
                                  branchId,
                                  tab as 'application' | 'kyc',
                                  'APPROVED',
                                )
                              }
                            >
                              Approve
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card>
          </>
        );
      }}
    </Boundary>
  );
}

function PackagesPage({ context }: { context: AdminContext }) {
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<unknown>();
  const run = async (operation: () => Promise<unknown>) => {
    setError(undefined);
    try {
      setResult(await operation());
    } catch (caught) {
      setError(caught);
    }
  };
  const post = (
    path: string,
    body: unknown,
    method: 'POST' | 'PATCH' = 'POST',
  ) =>
    api.request(path, { method, body, idempotencyKey: createIdempotencyKey() });
  return (
    <>
      <PageHeader
        eyebrow="Versioned commercial rules"
        title="Service fee packages"
        description="Create profiles, versions, special rates, and assignments without mutable rate history."
      />
      {error ? <ErrorAlert error={error} /> : null}
      {result ? (
        <Alert tone="success" title="Package operation completed">
          <Json value={result} />
        </Alert>
      ) : null}
      <div className="admin-two-column">
        <Card>
          <Heading title="Create package profile" />
          <LiveForm
            submitLabel="Create profile"
            onSubmit={(data) =>
              run(() =>
                post(`/admin/markets/${context.marketId}/packages`, {
                  code: text(data, 'code'),
                  name: text(data, 'name'),
                  description: optional(data, 'description'),
                }),
              )
            }
          >
            <Field name="code" label="Code" required />
            <Field name="name" label="Name" required />
            <Field name="description" label="Description" />
          </LiveForm>
        </Card>
        <Card>
          <Heading title="Create and activate version" />
          <LiveForm
            submitLabel="Create version"
            onSubmit={(data) =>
              run(() =>
                post(
                  `/admin/markets/${context.marketId}/packages/${text(data, 'packageId')}/versions`,
                  {
                    rate: text(data, 'rate'),
                    effective_from: text(data, 'effectiveFrom'),
                    effective_to: optional(data, 'effectiveTo'),
                  },
                ),
              )
            }
          >
            <Field name="packageId" label="Package ID" required />
            <Field name="rate" label="Exact rate" required />
            <Field
              name="effectiveFrom"
              label="Effective from"
              defaultValue="2026-01-01T00:00:00.000Z"
              required
            />
            <Field name="effectiveTo" label="Effective to" />
          </LiveForm>
          <LiveForm
            submitLabel="Activate version"
            onSubmit={(data) =>
              run(() =>
                post(
                  `/admin/markets/${context.marketId}/packages/${text(data, 'packageId')}/versions/${text(data, 'versionId')}/activate`,
                  undefined,
                  'PATCH',
                ),
              )
            }
          >
            <Field name="packageId" label="Package ID" required />
            <Field name="versionId" label="Version ID" required />
          </LiveForm>
        </Card>
        <Card>
          <Heading title="Special percentage" />
          <LiveForm
            submitLabel="Create special percentage"
            onSubmit={(data) =>
              run(() =>
                post(`/admin/markets/${context.marketId}/special-percentages`, {
                  rate: text(data, 'rate'),
                  description: text(data, 'description'),
                }),
              )
            }
          >
            <Field name="rate" label="Rate (>0 and <=100)" required />
            <Field name="description" label="Description" required />
          </LiveForm>
        </Card>
        <Card>
          <Heading title="Assign and set default" />
          <LiveForm
            submitLabel="Assign package"
            onSubmit={(data) =>
              run(() =>
                post(
                  `/admin/markets/${context.marketId}/merchants/${text(data, 'branchId')}/packages/assignments`,
                  {
                    service_fee_version_id: text(data, 'versionId'),
                    is_default: data.get('isDefault') === 'true',
                  },
                ),
              )
            }
          >
            <Field
              name="branchId"
              label="Branch ID"
              defaultValue={context.branchId}
              required
            />
            <Field name="versionId" label="Version ID" required />
            <Field
              name="isDefault"
              label="Default (true/false)"
              defaultValue="true"
              required
            />
          </LiveForm>
          <LiveForm
            submitLabel="Set default"
            onSubmit={(data) =>
              run(() =>
                post(
                  `/admin/markets/${context.marketId}/merchants/${text(data, 'branchId')}/packages/assignments/${text(data, 'assignmentId')}/set-default`,
                  undefined,
                  'PATCH',
                ),
              )
            }
          >
            <Field
              name="branchId"
              label="Branch ID"
              defaultValue={context.branchId}
              required
            />
            <Field name="assignmentId" label="Assignment ID" required />
          </LiveForm>
        </Card>
      </div>
    </>
  );
}

function McpPage({ context }: { context: AdminContext }) {
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<unknown>();
  const resource = useResource(
    async () =>
      context.accountId
        ? {
            account: await api.request<JsonRecord>(
              `/admin/markets/${context.marketId}/mcp/accounts/${context.accountId}`,
            ),
            ledger: await api.request<{ items: JsonRecord[] }>(
              `/admin/markets/${context.marketId}/mcp/accounts/${context.accountId}/ledger`,
            ),
          }
        : { account: {}, ledger: { items: [] } },
    [context.marketId, context.accountId],
  );
  const run = async (operation: () => Promise<unknown>, reload = false) => {
    setError(undefined);
    try {
      setResult(await operation());
      if (reload) resource.reload();
    } catch (caught) {
      setError(caught);
    }
  };
  const request = (path: string, body?: unknown) =>
    api.request(path, {
      method: 'POST',
      body,
      idempotencyKey: createIdempotencyKey(),
    });
  return (
    <Boundary resource={resource}>
      {(data) => (
        <>
          <PageHeader
            eyebrow="Governed financial operations"
            title="MCP operations"
            description="Recharge, refund, and adjustment actions are real server writes; no provider payment is triggered."
          />
          {error ? <ErrorAlert error={error} /> : null}
          {result ? (
            <Alert tone="success" title="Operation completed">
              <Json value={result} />
            </Alert>
          ) : null}
          {!context.accountId ? (
            <Alert tone="warning">
              Select a merchant with an MCP account from the Merchants screen.
            </Alert>
          ) : (
            <>
              <div className="admin-stat-grid">
                <Metric
                  title="Available"
                  value={display(data.account.available_balance, '0')}
                />
                <Metric
                  title="Total"
                  value={display(data.account.total_balance, '0')}
                />
                <Metric title="Status" value={display(data.account.status)} />
              </div>
              <Card>
                <Table>
                  <thead>
                    <tr>
                      <th>Seq</th>
                      <th>Type</th>
                      <th>Direction</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ledger.items.map((item) => (
                      <tr key={String(item.id)}>
                        <td>{String(item.sequence)}</td>
                        <td>{String(item.entryType ?? item.entry_type)}</td>
                        <td>{String(item.direction)}</td>
                        <td>{String(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </>
          )}
          <div className="admin-two-column">
            <Card>
              <Heading title="Recharge create / review" />
              <LiveForm
                submitLabel="Create recharge"
                onSubmit={(form) =>
                  run(() =>
                    request(
                      `/admin/markets/${context.marketId}/merchants/${text(form, 'branchId')}/recharge`,
                      {
                        amount: text(form, 'amount'),
                        reason: text(form, 'reason'),
                      },
                    ),
                  )
                }
              >
                <Field
                  name="branchId"
                  label="Branch ID"
                  defaultValue={context.branchId}
                  required
                />
                <Field name="amount" label="Amount" required />
                <Field name="reason" label="Reason" required />
              </LiveForm>
              <LiveForm
                submitLabel="Complete recharge"
                onSubmit={(form) =>
                  run(
                    () =>
                      request(
                        `/admin/markets/${context.marketId}/recharge/${text(form, 'requestId')}/review`,
                        { decision: 'COMPLETED', reason: text(form, 'reason') },
                      ),
                    true,
                  )
                }
              >
                <Field name="requestId" label="Recharge request ID" required />
                <Field name="reason" label="Review reason" required />
              </LiveForm>
            </Card>
            <Card>
              <Heading title="Refund create / review" />
              <LiveForm
                submitLabel="Create refund"
                onSubmit={(form) =>
                  run(() =>
                    request(
                      `/admin/markets/${context.marketId}/merchants/${text(form, 'branchId')}/refund`,
                      {
                        amount: text(form, 'amount'),
                        reason: text(form, 'reason'),
                      },
                    ),
                  )
                }
              >
                <Field
                  name="branchId"
                  label="Branch ID"
                  defaultValue={context.branchId}
                  required
                />
                <Field name="amount" label="Amount" required />
                <Field name="reason" label="Reason" required />
              </LiveForm>
              <LiveForm
                submitLabel="Advance refund review"
                onSubmit={(form) =>
                  run(
                    () =>
                      request(
                        `/admin/markets/${context.marketId}/refund/${text(form, 'requestId')}/review`,
                        {
                          decision: text(form, 'decision'),
                          reason: text(form, 'reason'),
                        },
                      ),
                    true,
                  )
                }
              >
                <Field name="requestId" label="Refund request ID" required />
                <Field
                  name="decision"
                  label="UNDER_REVIEW / APPROVED / REJECTED"
                  required
                />
                <Field name="reason" label="Review reason" required />
              </LiveForm>
            </Card>
            <Card>
              <Heading title="Maker / Checker adjustment" />
              <LiveForm
                submitLabel="Maker creates request"
                onSubmit={(form) =>
                  run(() =>
                    request(
                      `/admin/markets/${context.marketId}/merchants/${text(form, 'branchId')}/adjustments`,
                      {
                        type: text(form, 'type'),
                        amount: text(form, 'amount'),
                        reason: text(form, 'reason'),
                        evidence: { ticket: text(form, 'ticket') },
                      },
                    ),
                  )
                }
              >
                <Field
                  name="branchId"
                  label="Branch ID"
                  defaultValue={context.branchId}
                  required
                />
                <Field
                  name="type"
                  label="MANUAL_CREDIT / MANUAL_DEBIT"
                  defaultValue="MANUAL_CREDIT"
                  required
                />
                <Field name="amount" label="Amount" required />
                <Field name="reason" label="Reason" required />
                <Field name="ticket" label="Evidence ticket" required />
              </LiveForm>
              <LiveForm
                submitLabel="Maker submits"
                onSubmit={(form) =>
                  run(() =>
                    request(
                      `/admin/markets/${context.marketId}/mcp/adjustments/${text(form, 'requestId')}/submit`,
                    ),
                  )
                }
              >
                <Field
                  name="requestId"
                  label="Adjustment request ID"
                  required
                />
              </LiveForm>
              <LiveForm
                submitLabel="Checker approves"
                onSubmit={(form) =>
                  run(() =>
                    request(
                      `/admin/markets/${context.marketId}/adjustments/${text(form, 'requestId')}/approve`,
                      { reason: text(form, 'reason') },
                    ),
                  )
                }
              >
                <Field
                  name="requestId"
                  label="Adjustment request ID"
                  required
                />
                <Field name="reason" label="Approval reason" required />
              </LiveForm>
              <LiveForm
                submitLabel="Execute exactly once"
                onSubmit={(form) =>
                  run(
                    () =>
                      request(
                        `/admin/markets/${context.marketId}/adjustments/${text(form, 'requestId')}/execute`,
                        { reason: text(form, 'reason') },
                      ),
                    true,
                  )
                }
              >
                <Field
                  name="requestId"
                  label="Adjustment request ID"
                  required
                />
                <Field name="reason" label="Execution reason" required />
              </LiveForm>
            </Card>
          </div>
        </>
      )}
    </Boundary>
  );
}

function AuditPage({ context }: { context: AdminContext }) {
  const [entityId, setEntityId] = useState(context.branchId ?? '');
  const [version, setVersion] = useState(0);
  const resource = useResource(
    () =>
      entityId
        ? api.request<{ logs: JsonRecord[]; timeline: JsonRecord[] }>(
            `/admin/audit?entityType=merchant_branch&entityId=${encodeURIComponent(entityId)}`,
          )
        : Promise.resolve({ logs: [], timeline: [] }),
    [entityId, version],
  );
  return (
    <Boundary resource={resource}>
      {(data) => (
        <>
          <PageHeader
            eyebrow="Immutable evidence"
            title="Audit log and entity timeline"
            description="MarketAccess-filtered privileged action history."
          />
          <Card>
            <FormField label="Merchant branch ID" htmlFor="audit-entity">
              <Input
                id="audit-entity"
                value={entityId}
                onChange={(event) => setEntityId(event.currentTarget.value)}
              />
            </FormField>
            <Button onClick={() => setVersion((value) => value + 1)}>
              Load audit
            </Button>
          </Card>
          <div className="admin-two-column">
            <Card>
              <Heading title="Audit logs" />
              <Json value={data.logs} />
            </Card>
            <Card>
              <Heading title="Entity timeline" />
              <Json value={data.timeline} />
            </Card>
          </div>
        </>
      )}
    </Boundary>
  );
}

interface Resource<T> {
  data?: T;
  error?: unknown;
  loading: boolean;
  reload: () => void;
}
function useResource<T>(
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
function Boundary<T>({
  resource,
  children,
  empty,
}: {
  resource: Resource<T>;
  children: (data: T) => ReactNode;
  empty?: (data: T) => boolean;
}) {
  if (resource.loading) return <Loading />;
  if (resource.error)
    return <ErrorState error={resource.error} retry={resource.reload} />;
  if (resource.data === undefined || empty?.(resource.data))
    return (
      <EmptyState
        title="No records found"
        description="The live API returned an empty result."
        action={<Button onClick={resource.reload}>Retry</Button>}
      />
    );
  return children(resource.data);
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
      className="admin-action-form"
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
}) {
  const id = useId();
  return (
    <FormField label={props.label} htmlFor={id}>
      <Input id={id} {...props} />
    </FormField>
  );
}
function ErrorAlert({ error }: { error: unknown }) {
  const value = describeApiError(error);
  return (
    <Alert tone="error" title={value.title}>
      {value.detail}
    </Alert>
  );
}
function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  const value = describeApiError(error);
  return (
    <EmptyState
      title={value.title}
      description={value.detail}
      action={<Button onClick={retry}>Retry</Button>}
    />
  );
}
function Loading() {
  return (
    <section aria-label="Loading admin workspace" className="admin-loading">
      <Skeleton width="35%" height={28} />
      <Skeleton height={180} />
    </section>
  );
}
function ForcedState({ state }: { state: string }) {
  if (state === 'loading') return <Loading />;
  const values: Record<string, [string, string]> = {
    empty: ['No operational records', 'This market has no matching records.'],
    offline: ['You are offline', 'Reconnect before making privileged changes.'],
    forbidden: ['Permission denied', 'Your role lacks this action permission.'],
    market: [
      'Market access denied',
      'Your administrator account cannot access this market.',
    ],
    expired: ['Session expired', 'Log in again to continue.'],
    error: [
      'Unable to load admin workspace',
      'Retry or use the request ID when contacting support.',
    ],
  };
  const value = values[state] ?? values.error!;
  return <EmptyState title={value[0]} description={value[1]} />;
}
function Metric({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <small>{title}</small>
      <h2>{value}</h2>
    </Card>
  );
}
function Heading({ title }: { title: string }) {
  return (
    <div className="admin-section-heading">
      <h2>{title}</h2>
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <Badge
      tone={
        value === 'ACTIVE'
          ? 'success'
          : value === 'SUSPENDED'
            ? 'error'
            : 'warning'
      }
    >
      {value.replaceAll('_', ' ')}
    </Badge>
  );
}
function Json({ value }: { value: unknown }) {
  return (
    <pre className="admin-live-json">{JSON.stringify(value, null, 2)}</pre>
  );
}
function Wordmark() {
  return (
    <span className="admin-wordmark">
      <span aria-hidden="true">i</span>
      <strong>Point</strong>
      <small>Admin</small>
    </span>
  );
}
function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
function optional(data: FormData, key: string): string | undefined {
  return text(data, key) || undefined;
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
function readContext(): AdminContext | undefined {
  const value = window.localStorage.getItem(contextKey);
  if (!value) return undefined;
  try {
    return JSON.parse(value) as AdminContext;
  } catch {
    return undefined;
  }
}

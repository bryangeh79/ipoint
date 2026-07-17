import {
  Alert,
  AppShell,
  Badge,
  BottomNavigation,
  Button,
  Card,
  Checkbox,
  Drawer,
  EmptyState,
  FilterBar,
  FormField,
  Input,
  PageHeader,
  SearchField,
  Select,
  SideNavigation,
  StatCard,
  Table,
  Tabs,
  Textarea,
  TopBar,
  type NavigationItem,
} from '@ipoint/ui';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  activationHints,
  onboardingProgress,
  operationalStatus,
  type ActivationState,
} from './merchant-model.js';

type MerchantPage =
  | 'overview'
  | 'access'
  | 'profile'
  | 'verification'
  | 'packages'
  | 'mcp';

const navigation: ReadonlyArray<NavigationItem> = [
  { id: 'overview', label: 'Overview' },
  { id: 'access', label: 'Access' },
  { id: 'profile', label: 'Profile' },
  { id: 'verification', label: 'Verification' },
  { id: 'packages', label: 'Packages' },
  { id: 'mcp', label: 'MCP' },
];

const activation: ActivationState = {
  emailVerified: true,
  termsAccepted: true,
  applicationApproved: true,
  kycApproved: false,
  mcpBalance: '86.0000000000',
};

const ledger = [
  {
    id: 'MCP-00021',
    type: 'Recharge',
    direction: 'Credit',
    amount: '100.0000000000',
    status: 'Completed',
    time: '17 Jul 2026, 09:42',
  },
  {
    id: 'MCP-00020',
    type: 'Manual debit',
    direction: 'Debit',
    amount: '14.0000000000',
    status: 'Executed',
    time: '16 Jul 2026, 15:08',
  },
] as const;

const statusTone = {
  ACTIVE: 'success',
  PENDING_APPLICATION: 'warning',
  PENDING_KYC: 'warning',
  PENDING_MCP: 'warning',
  SUSPENDED: 'error',
} as const;

export function MerchantApp() {
  const [page, setPage] = useState<MerchantPage>('overview');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [suspendedPreview, setSuspendedPreview] = useState(false);
  const status = operationalStatus(activation, suspendedPreview);
  const items = navigation.map((item) => ({ ...item, href: `#${item.id}` }));

  const navigate = (item: NavigationItem) => {
    setPage(item.id as MerchantPage);
    setDrawerOpen(false);
  };

  return (
    <AppShell
      className="merchant-app"
      topBar={
        <TopBar
          brand={<Wordmark label="Merchant" />}
          onMenuClick={() => setDrawerOpen(true)}
          actions={
            <Badge tone={statusTone[status]}>{labelStatus(status)}</Badge>
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
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Merchant navigation"
        placement="left"
      >
        <SideNavigation items={items} activeId={page} onNavigate={navigate} />
      </Drawer>
      {notice ? (
        <Alert
          tone="success"
          title="Saved"
          onDismiss={() => setNotice(undefined)}
        >
          {notice}
        </Alert>
      ) : null}
      {status === 'SUSPENDED' ? (
        <Alert tone="error" title="Merchant access is read-only">
          MCP is preserved. Profile, package, recharge, and refund changes
          remain disabled until an authorized administrator reactivates this
          merchant.
        </Alert>
      ) : null}
      {renderPage(page, {
        readOnly: status === 'SUSPENDED',
        onSaved: setNotice,
        suspendedPreview,
        setSuspendedPreview,
      })}
    </AppShell>
  );
}

function renderPage(
  page: MerchantPage,
  context: {
    readOnly: boolean;
    onSaved: (message: string) => void;
    suspendedPreview: boolean;
    setSuspendedPreview: (value: boolean) => void;
  },
) {
  switch (page) {
    case 'access':
      return <AccessPage onSaved={context.onSaved} />;
    case 'profile':
      return (
        <ProfilePage readOnly={context.readOnly} onSaved={context.onSaved} />
      );
    case 'verification':
      return (
        <VerificationPage
          readOnly={context.readOnly}
          onSaved={context.onSaved}
        />
      );
    case 'packages':
      return (
        <PackagesPage readOnly={context.readOnly} onSaved={context.onSaved} />
      );
    case 'mcp':
      return <McpPage readOnly={context.readOnly} onSaved={context.onSaved} />;
    default:
      return (
        <OverviewPage
          suspendedPreview={context.suspendedPreview}
          setSuspendedPreview={context.setSuspendedPreview}
        />
      );
  }
}

function OverviewPage({
  suspendedPreview,
  setSuspendedPreview,
}: {
  suspendedPreview: boolean;
  setSuspendedPreview: (value: boolean) => void;
}) {
  const progress = onboardingProgress(activation);
  const hints = activationHints(activation);
  return (
    <>
      <PageHeader
        eyebrow="Merchant MY-OF-000127"
        title="Good afternoon, Northstar Coffee"
        description="Finish the remaining verification step to activate this branch."
        actions={
          <Button
            variant="secondary"
            onClick={() => setSuspendedPreview(!suspendedPreview)}
          >
            {suspendedPreview
              ? 'Exit suspended preview'
              : 'Preview suspended state'}
          </Button>
        }
      />
      <section className="merchant-progress" aria-label="Onboarding progress">
        <div>
          <span>Onboarding progress</span>
          <strong>{progress}%</strong>
        </div>
        <progress value={progress} max="100">
          {progress}%
        </progress>
      </section>
      <section className="merchant-stat-grid" aria-label="Merchant summary">
        <StatCard
          label="MCP available"
          value="86.00"
          helper="MCP ledger balance"
        />
        <StatCard
          label="Application"
          value="Approved"
          helper="Reviewed 17 Jul"
        />
        <StatCard
          label="KYC"
          value="Action needed"
          helper="1 field to resubmit"
        />
        <StatCard
          label="Default package"
          value="C · 10%"
          helper="Active version 3"
        />
      </section>
      <div className="merchant-two-column">
        <Card>
          <SectionHeading title="Activation checklist" badge="3 of 4 ready" />
          <ol className="merchant-checklist">
            <CheckItem
              done
              label="Email verified"
              detail="bryan@northstar.example"
            />
            <CheckItem
              done
              label="Terms accepted"
              detail="Merchant Terms v1.2"
            />
            <CheckItem done label="Application approved" detail="APP-000127" />
            <CheckItem
              label="KYC approved"
              detail="Address proof needs resubmission"
            />
          </ol>
          {hints.length ? (
            <Alert tone="warning" title="Activation is waiting">
              {hints.join(' · ')}
            </Alert>
          ) : null}
        </Card>
        <Card>
          <SectionHeading title="Branch identity" badge="Malaysia" />
          <DefinitionList
            items={[
              ['Merchant ID', 'MY-OF-000127'],
              ['Default group', 'Northstar Coffee Group'],
              ['Referrer', 'IPT-MY-018842 · A. Rahman'],
              ['Login email', 'bryan@northstar.example (immutable)'],
            ]}
          />
        </Card>
      </div>
    </>
  );
}

function AccessPage({ onSaved }: { onSaved: (message: string) => void }) {
  const [tab, setTab] = useState('login');
  return (
    <>
      <PageHeader
        eyebrow="Secure merchant access"
        title="Account access"
        description="Email OTP protects registration and password recovery."
      />
      <Card className="merchant-auth-card">
        <Tabs
          label="Account access flows"
          activeId={tab}
          onChange={setTab}
          tabs={[
            { id: 'login', label: 'Login' },
            { id: 'register', label: 'Register' },
            { id: 'reset', label: 'Reset password' },
          ]}
        />
        <div role="tabpanel" id={`ip-panel-${tab}`} className="merchant-panel">
          {tab === 'login' ? (
            <SimpleForm
              submitLabel="Login"
              onSubmit={() =>
                onSaved('Login request prepared for the Auth API.')
              }
            >
              <TextField id="login-email" label="Login email" type="email" />
              <TextField id="login-password" label="Password" type="password" />
            </SimpleForm>
          ) : null}
          {tab === 'register' ? (
            <SimpleForm
              submitLabel="Verify email and continue"
              onSubmit={() => onSaved('Verification OTP request prepared.')}
            >
              <div className="merchant-form-grid">
                <TextField id="register-email" label="Email" type="email" />
                <TextField id="register-name" label="Business display name" />
                <TextField
                  id="register-password"
                  label="Password"
                  type="password"
                />
                <TextField
                  id="register-referrer"
                  label="Referrer ID"
                  optional
                />
              </div>
              <FormField label="Current legal versions" htmlFor="terms-version">
                <Input
                  id="terms-version"
                  value="Terms v1.2 · Disclaimer v1.1"
                  readOnly
                />
              </FormField>
              <Checkbox
                label="I accept Merchant Terms v1.2 and Disclaimer v1.1"
                description="Acceptance is recorded with version, time, locale, device, and IP."
                required
              />
            </SimpleForm>
          ) : null}
          {tab === 'reset' ? (
            <SimpleForm
              submitLabel="Send password reset OTP"
              onSubmit={() => onSaved('Password reset OTP request prepared.')}
            >
              <TextField id="reset-email" label="Login email" type="email" />
              <Alert tone="info">
                Reset is available by email OTP only. The login email cannot be
                changed.
              </Alert>
            </SimpleForm>
          ) : null}
        </div>
      </Card>
    </>
  );
}

function ProfilePage({
  readOnly,
  onSaved,
}: {
  readOnly: boolean;
  onSaved: (message: string) => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Public merchant profile"
        title="Profile and media"
        description="Keep information accurate for customers. Login email stays immutable."
      />
      <div className="merchant-two-column merchant-two-column--profile">
        <Card>
          <SectionHeading title="Business details" badge="Autosave off" />
          <SimpleForm
            submitLabel="Save profile"
            disabled={readOnly}
            onSubmit={() => onSaved('Merchant profile changes saved.')}
          >
            <div className="merchant-form-grid">
              <TextField
                id="display-name"
                label="Display name"
                value="Northstar Coffee"
              />
              <TextField id="phone" label="Phone" value="+60 12-345 6789" />
              <TextField
                id="address"
                label="Address"
                value="12 Jalan Ampang, Kuala Lumpur"
              />
              <TextField
                id="website"
                label="Website"
                value="https://northstar.example"
              />
              <TextField
                id="business-hours"
                label="Business hours"
                value="Mon–Sun, 08:00–20:00"
              />
              <TextField
                id="login-email-readonly"
                label="Login email"
                value="bryan@northstar.example"
                readOnly
              />
            </div>
            <FormField label="About us" htmlFor="about">
              <Textarea
                id="about"
                defaultValue="Neighbourhood coffee, roasted in Kuala Lumpur and served with care."
                maxLength={1000}
                rows={5}
              />
            </FormField>
          </SimpleForm>
        </Card>
        <Card>
          <SectionHeading
            title="Logo, banner and gallery"
            badge="4 of 12 assets"
          />
          <div className="merchant-media-preview merchant-media-preview--banner">
            <span>Banner · 16:9</span>
          </div>
          <div className="merchant-media-row">
            <div className="merchant-media-preview merchant-media-preview--logo">
              <span>Logo</span>
            </div>
            <div>
              <strong>Storefront gallery</strong>
              <p>Up to 10 JPG, PNG, or WebP images. Reorder after upload.</p>
            </div>
          </div>
          <Button
            variant="secondary"
            disabled={readOnly}
            onClick={() => onSaved('Media upload intent prepared.')}
          >
            Manage media
          </Button>
        </Card>
      </div>
    </>
  );
}

function VerificationPage({
  readOnly,
  onSaved,
}: {
  readOnly: boolean;
  onSaved: (message: string) => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Application and KYC"
        title="Verification center"
        description="Every resubmission creates a new immutable evidence snapshot."
      />
      <div className="merchant-two-column">
        <Card>
          <SectionHeading
            title="Merchant application"
            badge="Approved"
            tone="success"
          />
          <DefinitionList
            items={[
              ['Application', 'APP-000127 · version 2'],
              ['Submitted', '16 Jul 2026, 11:32'],
              ['Reviewed', '17 Jul 2026, 08:12'],
              ['Decision', 'Approved'],
            ]}
          />
          <Button variant="secondary">View submission snapshot</Button>
        </Card>
        <Card>
          <SectionHeading
            title="Business and responsible person KYC"
            badge="Resubmission required"
            tone="warning"
          />
          <Alert tone="warning" title="Address proof is incomplete">
            Upload a document issued within the last three months. Previous
            evidence remains retained in the review history.
          </Alert>
          <SimpleForm
            submitLabel="Submit KYC version 3"
            disabled={readOnly}
            onSubmit={() =>
              onSaved('KYC resubmission prepared as a new snapshot.')
            }
          >
            <TextField
              id="registration-number"
              label="Registration number"
              value="202601127K"
            />
            <TextField
              id="pic-full-name"
              label="Person in charge"
              value="Bryan Geh"
            />
            <FormField
              label="Replacement address proof"
              htmlFor="address-proof"
            >
              <Input
                id="address-proof"
                type="file"
                accept="image/*,application/pdf"
              />
            </FormField>
          </SimpleForm>
        </Card>
      </div>
    </>
  );
}

function PackagesPage({
  readOnly,
  onSaved,
}: {
  readOnly: boolean;
  onSaved: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const packages = [
    {
      id: 'PKG-C',
      name: 'Growth C',
      rate: '10%',
      status: 'Active',
      default: true,
    },
    {
      id: 'PKG-X8',
      name: 'Cafe Special',
      rate: '8%',
      status: 'Active',
      default: false,
    },
    {
      id: 'PKG-B',
      name: 'Starter B',
      rate: '5%',
      status: 'Paused',
      default: false,
    },
  ];
  const filtered = useMemo(
    () =>
      packages.filter((item) =>
        `${item.name} ${item.rate}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );
  return (
    <>
      <PageHeader
        eyebrow="Versioned service fees"
        title="Service fee packages"
        description="At least one assignment must stay active. The default is used first."
        actions={
          <Button
            disabled={readOnly}
            onClick={() => onSaved('Package change request opened.')}
          >
            Request change
          </Button>
        }
      />
      <Card>
        <FilterBar
          search={
            <SearchField
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onClear={() => setQuery('')}
              label="Search packages"
              placeholder="Search name or rate"
            />
          }
          resultSummary={`${filtered.length} assignments`}
        />
        <Table>
          <thead>
            <tr>
              <th>Package</th>
              <th>Rate</th>
              <th>Status</th>
              <th>Assignment</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                  <small>{item.id}</small>
                </td>
                <td>{item.rate}</td>
                <td>
                  <Badge
                    tone={item.status === 'Active' ? 'success' : 'neutral'}
                  >
                    {item.status}
                  </Badge>
                </td>
                <td>
                  {item.default ? (
                    <Badge tone="brand">Default</Badge>
                  ) : (
                    'Additional'
                  )}
                </td>
                <td>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      readOnly || (item.default && item.status === 'Active')
                    }
                    onClick={() =>
                      onSaved(
                        `${item.name} ${item.status === 'Active' ? 'pause' : 'resume'} request prepared.`,
                      )
                    }
                  >
                    {item.status === 'Active' ? 'Pause' : 'Resume'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

function McpPage({
  readOnly,
  onSaved,
}: {
  readOnly: boolean;
  onSaved: (message: string) => void;
}) {
  const [tab, setTab] = useState('ledger');
  return (
    <>
      <PageHeader
        eyebrow="Append-only merchant credit"
        title="MCP account"
        description="MCP history is immutable. Refund approval records a non-cash obligation only."
      />
      <section className="merchant-stat-grid merchant-stat-grid--mcp">
        <StatCard
          label="Available"
          value="86.00 MCP"
          helper="Spendable position"
        />
        <StatCard label="Frozen" value="0.00 MCP" helper="No active holds" />
        <StatCard
          label="Account status"
          value="Active"
          helper="Malaysia market"
        />
      </section>
      <Card>
        <Tabs
          label="MCP account sections"
          activeId={tab}
          onChange={setTab}
          tabs={[
            { id: 'ledger', label: 'Ledger' },
            { id: 'recharge', label: 'Recharge request' },
            { id: 'refund', label: 'Refund request' },
          ]}
        />
        <div role="tabpanel" id={`ip-panel-${tab}`} className="merchant-panel">
          {tab === 'ledger' ? <LedgerTable /> : null}
          {tab === 'recharge' ? (
            <SimpleForm
              disabled={readOnly}
              submitLabel="Submit recharge request"
              onSubmit={() =>
                onSaved('Recharge request submitted with Pending status.')
              }
            >
              <TextField
                id="recharge-amount"
                label="MCP amount"
                type="number"
              />
              <FormField label="Reason / reference" htmlFor="recharge-reason">
                <Textarea id="recharge-reason" rows={4} required />
              </FormField>
              <Alert tone="info">
                No payment provider is connected in Phase 1. An authorized admin
                completes or fails this request.
              </Alert>
            </SimpleForm>
          ) : null}
          {tab === 'refund' ? (
            <SimpleForm
              disabled={readOnly}
              submitLabel="Submit refund request"
              onSubmit={() =>
                onSaved('Refund foundation request submitted for review.')
              }
            >
              <TextField
                id="refund-amount"
                label="Eligible MCP amount"
                type="number"
              />
              <FormField label="Reason" htmlFor="refund-reason">
                <Textarea id="refund-reason" rows={4} required />
              </FormField>
              <Alert tone="warning">
                Approval debits eligible MCP and records an obligation. It does
                not send money or call a provider.
              </Alert>
            </SimpleForm>
          ) : null}
        </div>
      </Card>
    </>
  );
}

function LedgerTable() {
  const [query, setQuery] = useState('');
  const rows = ledger.filter((item) =>
    `${item.id} ${item.type}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <FilterBar
        search={
          <SearchField
            label="Search MCP ledger"
            placeholder="Entry ID or type"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onClear={() => setQuery('')}
          />
        }
        filters={
          <Select aria-label="Ledger direction">
            <option>All directions</option>
            <option>Credit</option>
            <option>Debit</option>
          </Select>
        }
        resultSummary={`${rows.length} entries`}
      />
      {rows.length ? (
        <Table>
          <thead>
            <tr>
              <th>Entry</th>
              <th>Type</th>
              <th>Direction</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Effective time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.type}</td>
                <td>{item.direction}</td>
                <td>{item.amount} MCP</td>
                <td>
                  <Badge tone="success">{item.status}</Badge>
                </td>
                <td>{item.time}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title="No ledger entries match"
          description="Clear the search to view immutable MCP history."
        />
      )}
    </>
  );
}

function SimpleForm({
  children,
  submitLabel,
  onSubmit,
  disabled,
}: {
  children: ReactNode;
  submitLabel: string;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="merchant-form" onSubmit={submit}>
      <fieldset disabled={disabled}>
        {children}
        <Button type="submit">{submitLabel}</Button>
      </fieldset>
    </form>
  );
}

function TextField({
  id,
  label,
  optional,
  value,
  ...props
}: {
  id: string;
  label: string;
  optional?: boolean;
  value?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FormField label={label} htmlFor={id} optional={optional}>
      <Input id={id} defaultValue={value} {...props} />
    </FormField>
  );
}

function Wordmark({ label }: { label: string }) {
  return (
    <span className="ip-wordmark">
      <span aria-hidden="true">i</span>Point <small>{label}</small>
    </span>
  );
}

function SectionHeading({
  title,
  badge,
  tone = 'neutral',
}: {
  title: string;
  badge: string;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  return (
    <div className="merchant-section-heading">
      <h2>{title}</h2>
      <Badge tone={tone}>{badge}</Badge>
    </div>
  );
}

function CheckItem({
  done = false,
  label,
  detail,
}: {
  done?: boolean;
  label: string;
  detail: string;
}) {
  return (
    <li className={done ? 'is-done' : ''}>
      <span aria-hidden="true">{done ? '✓' : '!'}</span>
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
    </li>
  );
}

function DefinitionList({
  items,
}: {
  items: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <dl className="merchant-definition-list">
      {items.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function labelStatus(status: string) {
  return status
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (value) => value.toUpperCase());
}

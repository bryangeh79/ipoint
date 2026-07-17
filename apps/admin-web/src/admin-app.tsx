import {
  Alert,
  AppShell,
  Badge,
  BottomNavigation,
  Button,
  Card,
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
  canExecuteAdjustment,
  filterMerchants,
  kycDiff,
  type MerchantListItem,
} from './admin-model.js';

type AdminPage =
  | 'overview'
  | 'merchants'
  | 'reviews'
  | 'packages'
  | 'mcp'
  | 'audit';

const navigation: ReadonlyArray<NavigationItem> = [
  { id: 'overview', label: 'Overview' },
  { id: 'merchants', label: 'Merchants' },
  { id: 'reviews', label: 'Reviews', badge: '5' },
  { id: 'packages', label: 'Packages' },
  { id: 'mcp', label: 'MCP' },
  { id: 'audit', label: 'Audit' },
];

const merchantRows = [
  {
    id: 'MY-OF-000127',
    name: 'Northstar Coffee',
    market: 'MY',
    application: 'APPROVED',
    kyc: 'RESUBMISSION_REQUIRED',
    status: 'PENDING_KYC',
  },
  {
    id: 'MY-ON-000128',
    name: 'Atlas Home',
    market: 'MY',
    application: 'SUBMITTED',
    kyc: 'DRAFT',
    status: 'PENDING_APPLICATION',
  },
  {
    id: 'MY-OF-000119',
    name: 'Kite & Co',
    market: 'MY',
    application: 'APPROVED',
    kyc: 'APPROVED',
    status: 'ACTIVE',
  },
  {
    id: 'MY-OF-000102',
    name: 'Greenfield Market',
    market: 'MY',
    application: 'APPROVED',
    kyc: 'APPROVED',
    status: 'SUSPENDED',
  },
] as const;

export function AdminApp() {
  const [page, setPage] = useState<AdminPage>('overview');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<string>();
  const items = navigation.map((item) => ({ ...item, href: `#${item.id}` }));
  const navigate = (item: NavigationItem) => {
    setPage(item.id as AdminPage);
    setDrawerOpen(false);
  };
  return (
    <AppShell
      className="admin-app"
      topBar={
        <TopBar
          brand={<Wordmark />}
          onMenuClick={() => setDrawerOpen(true)}
          actions={
            <>
              <Badge tone="info">Malaysia</Badge>
              <Badge tone="success">Finance Admin</Badge>
            </>
          }
        />
      }
      sideNavigation={
        <SideNavigation
          items={items}
          activeId={page}
          onNavigate={navigate}
          label="Admin navigation"
        />
      }
      bottomNavigation={
        <BottomNavigation
          items={items.slice(0, 5)}
          activeId={page}
          onNavigate={navigate}
          label="Admin mobile navigation"
        />
      }
    >
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Admin navigation"
        placement="left"
      >
        <SideNavigation items={items} activeId={page} onNavigate={navigate} />
      </Drawer>
      {notice ? (
        <Alert
          tone="success"
          title="Action recorded"
          onDismiss={() => setNotice(undefined)}
        >
          {notice}
        </Alert>
      ) : null}
      {renderPage(page, setNotice)}
    </AppShell>
  );
}

function renderPage(page: AdminPage, onSaved: (message: string) => void) {
  switch (page) {
    case 'merchants':
      return <MerchantsPage onSaved={onSaved} />;
    case 'reviews':
      return <ReviewsPage onSaved={onSaved} />;
    case 'packages':
      return <PackagesPage onSaved={onSaved} />;
    case 'mcp':
      return <McpPage onSaved={onSaved} />;
    case 'audit':
      return <AuditPage />;
    default:
      return <OverviewPage />;
  }
}

function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operations cockpit"
        title="Merchant onboarding"
        description="Review market-scoped work, financial controls, and activation blockers."
      />
      <section className="admin-stat-grid" aria-label="Admin summary">
        <StatCard
          label="Applications awaiting review"
          value="3"
          helper="Oldest: 18 hours"
        />
        <StatCard label="KYC actions" value="2" helper="1 resubmission" />
        <StatCard
          label="MCP recharge requests"
          value="4"
          helper="286.00 MCP total"
        />
        <StatCard label="Maker / Checker" value="1" helper="Awaiting checker" />
      </section>
      <div className="admin-two-column">
        <Card>
          <SectionHeading title="Priority queue" badge="5 open" />
          <ul className="admin-priority-list">
            <PriorityItem
              label="KYC resubmission"
              merchant="MY-OF-000127 · Northstar Coffee"
              age="26 min"
              tone="warning"
            />
            <PriorityItem
              label="Recharge review"
              merchant="MY-OF-000119 · Kite & Co"
              age="41 min"
              tone="info"
            />
            <PriorityItem
              label="Manual debit approval"
              merchant="MY-OF-000102 · Greenfield Market"
              age="1 h"
              tone="error"
            />
          </ul>
        </Card>
        <Card>
          <SectionHeading
            title="Control health"
            badge="Normal"
            tone="success"
          />
          <DefinitionList
            items={[
              ['Market access', 'Malaysia · Active grant'],
              ['Action permissions', '12 effective permissions'],
              ['Ledger reconciliation', 'No discrepancy'],
              ['Last audit append', '18 seconds ago'],
            ]}
          />
        </Card>
      </div>
    </>
  );
}

function MerchantsPage({ onSaved }: { onSaved: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [selected, setSelected] = useState<MerchantListItem>(merchantRows[0]);
  const rows = useMemo(
    () => filterMerchants(merchantRows, query, status),
    [query, status],
  );
  return (
    <>
      <PageHeader
        eyebrow="Market-scoped directory"
        title="Merchants"
        description="Search, filter, review, suspend, and reactivate without deleting history."
      />
      <Card>
        <FilterBar
          search={
            <SearchField
              label="Search merchants"
              placeholder="Merchant ID or name"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onClear={() => setQuery('')}
            />
          }
          filters={
            <Select
              aria-label="Filter by operational status"
              value={status}
              onChange={(event) => setStatus(event.currentTarget.value)}
            >
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="PENDING_APPLICATION">Pending application</option>
              <option value="PENDING_KYC">Pending KYC</option>
              <option value="SUSPENDED">Suspended</option>
            </Select>
          }
          resultSummary={`${rows.length} merchants in authorized market`}
        />
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Application</th>
                <th>KYC</th>
                <th>Operational status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    <small>
                      {row.id} · {row.market}
                    </small>
                  </td>
                  <td>
                    <StatusBadge value={row.application} />
                  </td>
                  <td>
                    <StatusBadge value={row.kyc} />
                  </td>
                  <td>
                    <StatusBadge value={row.status} />
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSelected(row)}
                    >
                      View details
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title="No merchants match"
            description="Adjust the market-safe filters to find a merchant."
          />
        )}
      </Card>
      <Card className="admin-detail-card">
        <SectionHeading title={selected.name} badge={selected.id} />
        <div className="admin-detail-grid">
          <DefinitionList
            items={[
              ['Application', selected.application],
              ['KYC', selected.kyc],
              ['Operational status', selected.status],
              ['MCP available', '86.0000000000'],
              ['Default package', 'Growth C · version 3'],
            ]}
          />
          <ActionForm
            title="Suspend / Reactivate merchant"
            submitLabel={
              selected.status === 'SUSPENDED'
                ? 'Reactivate merchant'
                : 'Suspend merchant'
            }
            tone={selected.status === 'SUSPENDED' ? 'primary' : 'danger'}
            onSubmit={() =>
              onSaved(
                `${selected.id} status action recorded with reason, audit, and timeline.`,
              )
            }
          >
            <FormField label="Mandatory reason" htmlFor="status-reason">
              <Textarea id="status-reason" rows={4} required />
            </FormField>
            <Alert tone="info">
              Application, KYC, and MCP positions are preserved.
            </Alert>
          </ActionForm>
        </div>
      </Card>
    </>
  );
}

function ReviewsPage({ onSaved }: { onSaved: (message: string) => void }) {
  const [tab, setTab] = useState('application');
  const diff = kycDiff(
    {
      registered_name: 'Northstar Coffee Sdn Bhd',
      registration_number: '202601127K',
      registered_address: '12 Jalan Ampang, 50450 Kuala Lumpur',
      pic_identity: '********4431',
    },
    {
      registered_name: 'Northstar Coffee Sdn Bhd',
      registration_number: '202601127K',
      registered_address: '8 Jalan Ampang, 50450 Kuala Lumpur',
      pic_identity: '********4431',
    },
  );
  return (
    <>
      <PageHeader
        eyebrow="Independent decisions"
        title="Application and KYC review"
        description="Application, KYC, and operational activation remain separate state machines."
      />
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
        <div className="admin-panel" role="tabpanel" id={`ip-panel-${tab}`}>
          {tab === 'application' ? (
            <ReviewLayout
              title="Atlas Home · MY-ON-000128"
              meta="Application version 1 · Submitted 52 minutes ago"
              onSaved={onSaved}
            />
          ) : (
            <>
              <SectionHeading
                title="Northstar Coffee · KYC version 3"
                badge="Resubmitted"
                tone="warning"
              />
              <Alert tone="info" title="Side-by-side immutable snapshot">
                Changed fields are highlighted. Sensitive identity values stay
                masked.
              </Alert>
              <Table>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Previous version</th>
                    <th>Current version</th>
                    <th>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.map((row) => (
                    <tr
                      key={row.field}
                      className={row.changed ? 'is-changed' : ''}
                    >
                      <td>{label(row.field)}</td>
                      <td>{row.previous}</td>
                      <td>{row.current}</td>
                      <td>
                        {row.changed ? (
                          <Badge tone="warning">Changed</Badge>
                        ) : (
                          <Badge>Unchanged</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <DecisionForm subject="KYC" onSaved={onSaved} />
            </>
          )}
        </div>
      </Card>
    </>
  );
}

function ReviewLayout({
  title,
  meta,
  onSaved,
}: {
  title: string;
  meta: string;
  onSaved: (message: string) => void;
}) {
  return (
    <div className="admin-review-layout">
      <div>
        <SectionHeading title={title} badge="Submitted" tone="warning" />
        <p className="admin-muted">{meta}</p>
        <DefinitionList
          items={[
            ['Display name', 'Atlas Home'],
            ['Channel', 'Online'],
            ['Market', 'Malaysia'],
            ['Referrer', 'IPT-MY-018842'],
            ['Terms', 'Merchant Terms v1.2 / Disclaimer v1.1'],
          ]}
        />
      </div>
      <DecisionForm subject="Application" onSaved={onSaved} />
    </div>
  );
}

function DecisionForm({
  subject,
  onSaved,
}: {
  subject: string;
  onSaved: (message: string) => void;
}) {
  return (
    <ActionForm
      title={`${subject} decision`}
      submitLabel="Record decision"
      onSubmit={() =>
        onSaved(
          `${subject} decision appended with audit and timeline evidence.`,
        )
      }
    >
      <FormField label="Decision" htmlFor={`${subject}-decision`}>
        <Select id={`${subject}-decision`} required>
          <option value="">Select decision</option>
          <option>APPROVED</option>
          <option>REJECTED</option>
          <option>RESUBMISSION_REQUIRED</option>
        </Select>
      </FormField>
      <FormField label="Reason" htmlFor={`${subject}-reason`}>
        <Textarea id={`${subject}-reason`} rows={5} required />
      </FormField>
      {subject === 'KYC' ? (
        <FormField label="Rejected fields" htmlFor="rejected-fields">
          <Input id="rejected-fields" placeholder="registered_address" />
        </FormField>
      ) : null}
    </ActionForm>
  );
}

function PackagesPage({ onSaved }: { onSaved: (message: string) => void }) {
  const [tab, setTab] = useState('versions');
  return (
    <>
      <PageHeader
        eyebrow="Exact decimal · effective-time rules"
        title="Package governance"
        description="Create drafts and new versions; never overwrite a used rate."
      />
      <Card>
        <Tabs
          label="Package operations"
          activeId={tab}
          onChange={setTab}
          tabs={[
            { id: 'versions', label: 'Versions' },
            { id: 'special', label: 'Special percentage' },
            { id: 'assign', label: 'Assignment' },
          ]}
        />
        <div className="admin-panel" role="tabpanel" id={`ip-panel-${tab}`}>
          {tab === 'versions' ? (
            <>
              <Table>
                <thead>
                  <tr>
                    <th>Package</th>
                    <th>Version</th>
                    <th>Rate</th>
                    <th>Effective window</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Growth C</td>
                    <td>v3</td>
                    <td>10.000000%</td>
                    <td>01 Jul 2026 → Open</td>
                    <td>
                      <Badge tone="success">Active</Badge>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          onSaved(
                            'Active history remains immutable; a new draft will be created.',
                          )
                        }
                      >
                        New version
                      </Button>
                    </td>
                  </tr>
                  <tr>
                    <td>Growth C</td>
                    <td>v4</td>
                    <td>9.500000%</td>
                    <td>01 Aug 2026 → Open</td>
                    <td>
                      <Badge>Draft</Badge>
                    </td>
                    <td className="admin-button-row">
                      <Button
                        size="sm"
                        onClick={() =>
                          onSaved(
                            'Draft version activated after conflict checks.',
                          )
                        }
                      >
                        Activate
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onSaved('Draft version update opened.')}
                      >
                        Update
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() =>
                          onSaved(
                            'Draft version cancelled without deleting history.',
                          )
                        }
                      >
                        Cancel
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </Table>
              <ActionForm
                title="Create package version"
                submitLabel="Create draft version"
                onSubmit={() =>
                  onSaved(
                    'Package draft version created with exact rate and effective window.',
                  )
                }
              >
                <FormGrid>
                  <TextField
                    id="package-rate"
                    label="Rate (%)"
                    placeholder="10.000000"
                  />
                  <TextField
                    id="package-effective"
                    label="Effective from"
                    type="datetime-local"
                  />
                </FormGrid>
              </ActionForm>
            </>
          ) : null}
          {tab === 'special' ? (
            <ActionForm
              title="Create approved special percentage"
              submitLabel="Create special percentage"
              onSubmit={() =>
                onSaved(
                  'Special percentage created within the locked >0 and <=100 range.',
                )
              }
            >
              <TextField
                id="special-rate"
                label="Exact rate (%)"
                placeholder="8.000000"
              />
              <FormField label="Business reason" htmlFor="special-reason">
                <Textarea id="special-reason" rows={4} required />
              </FormField>
              <Alert tone="info">
                Allowed range is greater than 0 and less than or equal to 100.
                Increment and threshold are not invented.
              </Alert>
            </ActionForm>
          ) : null}
          {tab === 'assign' ? (
            <ActionForm
              title="Assign and set default"
              submitLabel="Assign package"
              onSubmit={() =>
                onSaved(
                  'Package assignment created; default uniqueness will be enforced atomically.',
                )
              }
            >
              <FormGrid>
                <TextField
                  id="assign-merchant"
                  label="Merchant ID"
                  value="MY-OF-000127"
                />
                <FormField label="Package version" htmlFor="assign-package">
                  <Select id="assign-package">
                    <option>Growth C · v3 · 10%</option>
                    <option>Cafe Special · 8%</option>
                  </Select>
                </FormField>
              </FormGrid>
              <Button
                variant="secondary"
                onClick={() =>
                  onSaved('Selected assignment set as the only active default.')
                }
              >
                Set selected as default
              </Button>
            </ActionForm>
          ) : null}
        </div>
      </Card>
    </>
  );
}

function McpPage({ onSaved }: { onSaved: (message: string) => void }) {
  const [tab, setTab] = useState('account');
  const executable = canExecuteAdjustment({
    status: 'APPROVED',
    makerId: 'admin-maker-17',
    checkerId: 'admin-checker-09',
    currentActorId: 'admin-checker-09',
  });
  return (
    <>
      <PageHeader
        eyebrow="Append-only financial controls"
        title="MCP operations"
        description="Recharge uses normal review. Manual credit and debit always use Maker / Checker."
      />
      <section className="admin-stat-grid admin-stat-grid--mcp">
        <StatCard label="Available" value="86.00 MCP" helper="MY-OF-000127" />
        <StatCard
          label="Ledger sequence"
          value="#21"
          helper="No gaps detected"
        />
        <StatCard
          label="Reconciliation"
          value="Matched"
          helper="Available + frozen = total"
        />
      </section>
      <Card>
        <Tabs
          label="MCP operations"
          activeId={tab}
          onChange={setTab}
          tabs={[
            { id: 'account', label: 'Account and ledger' },
            { id: 'recharge', label: 'Recharge review' },
            { id: 'refund', label: 'Refund review' },
            { id: 'adjustment', label: 'Maker / Checker' },
          ]}
        />
        <div className="admin-panel" role="tabpanel" id={`ip-panel-${tab}`}>
          {tab === 'account' ? <LedgerView /> : null}
          {tab === 'recharge' ? (
            <ActionForm
              title="Recharge REQ-00083"
              submitLabel="Record recharge decision"
              onSubmit={() =>
                onSaved(
                  'Recharge completed or failed exactly once; no Maker / Checker applied.',
                )
              }
            >
              <DefinitionList
                items={[
                  ['Merchant', 'MY-OF-000119 · Kite & Co'],
                  ['Amount', '200.0000000000 MCP'],
                  ['Status', 'PROCESSING'],
                  ['Reference', 'Manual bank evidence · metadata only'],
                ]}
              />
              <FormField label="Decision" htmlFor="recharge-decision">
                <Select id="recharge-decision">
                  <option>COMPLETED</option>
                  <option>FAILED</option>
                </Select>
              </FormField>
              <FormField label="Reason" htmlFor="recharge-review-reason">
                <Textarea id="recharge-review-reason" rows={4} required />
              </FormField>
            </ActionForm>
          ) : null}
          {tab === 'refund' ? (
            <ActionForm
              title="Refund foundation RF-00014"
              submitLabel="Record refund review"
              onSubmit={() =>
                onSaved(
                  'Refund review recorded; approval creates only a ledger debit and non-cash obligation.',
                )
              }
            >
              <DefinitionList
                items={[
                  ['Merchant', 'MY-OF-000102 · Greenfield Market'],
                  ['Eligible MCP', '58.0000000000'],
                  ['Requested MCP', '40.0000000000'],
                  ['Status', 'UNDER_REVIEW'],
                ]}
              />
              <FormField label="Decision" htmlFor="refund-decision">
                <Select id="refund-decision">
                  <option>APPROVED</option>
                  <option>REJECTED</option>
                </Select>
              </FormField>
              <FormField label="Reason" htmlFor="refund-review-reason">
                <Textarea id="refund-review-reason" rows={4} required />
              </FormField>
              <Alert tone="warning">
                No bank, gateway, payment, or payout call is performed.
              </Alert>
            </ActionForm>
          ) : null}
          {tab === 'adjustment' ? (
            <div className="admin-adjustment-grid">
              <ActionForm
                title="1 · Maker creates request"
                submitLabel="Submit for checker approval"
                onSubmit={() =>
                  onSaved(
                    'Manual adjustment submitted by maker with immutable reason and evidence.',
                  )
                }
              >
                <FormField label="Type" htmlFor="adjustment-type">
                  <Select id="adjustment-type">
                    <option>MANUAL_CREDIT</option>
                    <option>MANUAL_DEBIT</option>
                  </Select>
                </FormField>
                <TextField
                  id="adjustment-amount"
                  label="Exact MCP amount"
                  placeholder="10.0000000000"
                />
                <FormField
                  label="Reason and evidence"
                  htmlFor="adjustment-reason"
                >
                  <Textarea id="adjustment-reason" rows={4} required />
                </FormField>
              </ActionForm>
              <ActionForm
                title="2 · Checker decides"
                submitLabel="Approve as checker"
                onSubmit={() => onSaved('Distinct checker decision appended.')}
              >
                <DefinitionList
                  items={[
                    ['Request', 'ADJ-00031'],
                    ['Maker', 'admin-maker-17'],
                    ['Checker', 'admin-checker-09'],
                    ['Status', 'PENDING_APPROVAL'],
                  ]}
                />
                <FormField label="Decision reason" htmlFor="checker-reason">
                  <Textarea id="checker-reason" rows={4} required />
                </FormField>
              </ActionForm>
              <Card>
                <SectionHeading
                  title="3 · Execute approved adjustment"
                  badge="Approved"
                  tone="success"
                />
                <DefinitionList
                  items={[
                    ['Separation', 'Maker ≠ Checker'],
                    ['Available after', '96.0000000000 MCP'],
                    ['Idempotency', 'Ready'],
                    ['Audit context', 'Complete'],
                  ]}
                />
                <Button
                  disabled={!executable}
                  onClick={() =>
                    onSaved(
                      'Approved adjustment executed once and appended to the MCP ledger.',
                    )
                  }
                >
                  Execute exactly once
                </Button>
              </Card>
            </div>
          ) : null}
        </div>
      </Card>
    </>
  );
}

function LedgerView() {
  const rows = [
    [
      '#21',
      'RECHARGE',
      'CREDIT',
      '100.0000000000',
      '86.0000000000',
      'REQ-00082',
    ],
    [
      '#20',
      'MANUAL_DEBIT',
      'DEBIT',
      '14.0000000000',
      '-14.0000000000',
      'ADJ-00029',
    ],
  ];
  return (
    <Table>
      <thead>
        <tr>
          <th>Sequence</th>
          <th>Type</th>
          <th>Direction</th>
          <th>Amount</th>
          <th>Delta</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]}>
            {row.map((cell) => (
              <td key={cell}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function AuditPage() {
  const [query, setQuery] = useState('');
  const events = [
    {
      time: '13:18:04',
      type: 'AuditLog',
      action: 'MCP_ADJUSTMENT_APPROVED',
      actor: 'admin-checker-09',
      entity: 'ADJ-00031',
      result: 'SUCCESS',
    },
    {
      time: '13:17:42',
      type: 'EntityTimeline',
      action: 'MERCHANT_KYC_RESUBMITTED',
      actor: 'account-000127',
      entity: 'MY-OF-000127',
      result: 'SUCCESS',
    },
    {
      time: '13:15:16',
      type: 'AuditLog',
      action: 'MERCHANT_SUSPENDED',
      actor: 'admin-ops-03',
      entity: 'MY-OF-000102',
      result: 'SUCCESS',
    },
  ];
  const filtered = events.filter((event) =>
    `${event.action} ${event.actor} ${event.entity}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="Append-only evidence"
        title="Audit log and entity timeline"
        description="Audit answers who changed what; timeline explains what happened to the entity."
      />
      <Card>
        <FilterBar
          search={
            <SearchField
              label="Search audit evidence"
              placeholder="Action, actor, entity"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onClear={() => setQuery('')}
            />
          }
          filters={
            <Select aria-label="Evidence type">
              <option>All evidence</option>
              <option>AuditLog</option>
              <option>EntityTimeline</option>
            </Select>
          }
          resultSummary={`${filtered.length} events`}
        />
        {filtered.length ? (
          <Table>
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Evidence</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Entity</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr key={`${event.time}-${event.action}`}>
                  <td>{event.time}</td>
                  <td>
                    <Badge tone={event.type === 'AuditLog' ? 'info' : 'brand'}>
                      {event.type}
                    </Badge>
                  </td>
                  <td>{event.action}</td>
                  <td>{event.actor}</td>
                  <td>{event.entity}</td>
                  <td>
                    <Badge tone="success">{event.result}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title="No evidence matches"
            description="Clear the search to restore the immutable event list."
          />
        )}
      </Card>
    </>
  );
}

function ActionForm({
  title,
  submitLabel,
  onSubmit,
  children,
  tone = 'primary',
}: {
  title: string;
  submitLabel: string;
  onSubmit: () => void;
  children: ReactNode;
  tone?: 'primary' | 'danger';
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="admin-action-form" onSubmit={submit}>
      <h3>{title}</h3>
      {children}
      <Button type="submit" variant={tone}>
        {submitLabel}
      </Button>
    </form>
  );
}

function TextField({
  id,
  label: fieldLabel,
  value,
  ...props
}: {
  id: string;
  label: string;
  value?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FormField label={fieldLabel} htmlFor={id}>
      <Input id={id} defaultValue={value} required {...props} />
    </FormField>
  );
}

function FormGrid({ children }: { children: ReactNode }) {
  return <div className="admin-form-grid">{children}</div>;
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
    <div className="admin-section-heading">
      <h2>{title}</h2>
      <Badge tone={tone}>{badge}</Badge>
    </div>
  );
}

function DefinitionList({
  items,
}: {
  items: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <dl className="admin-definition-list">
      {items.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PriorityItem({
  label: itemLabel,
  merchant,
  age,
  tone,
}: {
  label: string;
  merchant: string;
  age: string;
  tone: 'warning' | 'info' | 'error';
}) {
  return (
    <li>
      <Badge tone={tone}>{itemLabel}</Badge>
      <div>
        <strong>{merchant}</strong>
        <small>{age} ago</small>
      </div>
    </li>
  );
}

function StatusBadge({ value }: { value: string }) {
  const tone =
    value === 'ACTIVE' || value === 'APPROVED'
      ? 'success'
      : value === 'SUSPENDED' || value === 'REJECTED'
        ? 'error'
        : value.includes('PENDING') ||
            value.includes('SUBMISSION') ||
            value === 'SUBMITTED'
          ? 'warning'
          : 'neutral';
  return <Badge tone={tone}>{label(value)}</Badge>;
}

function Wordmark() {
  return (
    <span className="ip-wordmark">
      <span aria-hidden="true">i</span>Point <small>Admin</small>
    </span>
  );
}
function label(value: string) {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
}

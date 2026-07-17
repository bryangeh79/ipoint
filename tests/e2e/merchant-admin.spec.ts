import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  accounts,
  adminUsers,
  credentials,
  marketAccess,
  markets,
  mcpAccounts,
  roleAssignments,
  roles,
  serviceFeeProfiles,
  serviceFeeVersions,
} from '../../packages/database/schema/index.js';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { createDatabase } from '../../packages/database/src/client.js';
import { and, eq } from 'drizzle-orm';
import { PasswordHasher } from '../../apps/api/src/auth/password-hasher.js';

const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  'postgresql://ipoint_test:ipoint_test@127.0.0.1:55440/ipoint_database_test';
const database = createDatabase(databaseUrl);

interface AdminFixture {
  email: string;
  password: string;
  adminUserId: string;
}
interface LiveFixture {
  marketId: string;
  packageVersionId: string;
  maker: AdminFixture;
  checker: AdminFixture;
}

let fixture: LiveFixture;
let acceptedBranchId = '';
let acceptedAccountId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await seedFoundation(database.db);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase();
  const marketRows = await database.db
    .insert(markets)
    .values({
      code: `E${suffix}`,
      name: 'Playwright Acceptance Market',
      status: 'ACTIVE',
      currencyCode: 'MYR',
      timezone: 'Asia/Kuala_Lumpur',
      defaultLocale: 'en-MY',
    })
    .returning({ id: markets.id });
  const marketId = marketRows[0]?.id ?? '';
  const roleRows = await database.db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, 'SUPER_ADMIN'));
  const roleId = roleRows[0]?.id ?? '';
  const maker = await createAdmin('Maker Admin', marketId, roleId);
  const checker = await createAdmin('Checker Admin', marketId, roleId);
  const versionRows = await database.db
    .select({ id: serviceFeeVersions.id })
    .from(serviceFeeVersions)
    .innerJoin(
      serviceFeeProfiles,
      eq(serviceFeeProfiles.id, serviceFeeVersions.serviceFeeProfileId),
    )
    .where(
      and(
        eq(serviceFeeProfiles.code, 'C'),
        eq(serviceFeeVersions.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  fixture = {
    marketId,
    maker,
    checker,
    packageVersionId: versionRows[0]?.id ?? '',
  };
});

test.afterAll(async () => {
  await database.pool.end();
});

test('merchant and admin complete the real UI to API to PostgreSQL lifecycle', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const merchantPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const adminPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const merchantEmail = `${randomUUID()}@example.com`;
  const merchantPassword = 'Merchant-Live-E2E-Password-123!';

  await registerMerchant(merchantPage, merchantEmail, merchantPassword);
  const merchantContext = await merchantPage.evaluate(
    () =>
      JSON.parse(localStorage.getItem('ipoint.merchant.context') ?? '{}') as {
        branchId: string;
        marketId: string;
      },
  );
  expect(merchantContext.marketId).toBe(fixture.marketId);

  await merchantPage.getByRole('link', { name: 'Profile' }).first().click();
  await expect(
    merchantPage.getByRole('heading', { name: 'Profile and media' }),
  ).toBeVisible();
  await merchantPage.getByLabel('Display name').fill('Northstar Live Coffee');
  await merchantPage.getByLabel('Phone').fill('+60123456789');
  await merchantPage.getByLabel('Address line').fill('12 Jalan Ampang');
  await merchantPage.getByLabel('City').fill('Kuala Lumpur');
  await merchantPage.getByLabel('State').fill('Kuala Lumpur');
  await merchantPage.getByLabel('Postcode').fill('50000');
  await merchantPage.getByRole('button', { name: 'Save profile' }).click();
  await expect(merchantPage.getByText('Profile saved.')).toBeVisible();

  await merchantPage
    .getByRole('link', { name: 'Verification' })
    .first()
    .click();
  const applicationCard = merchantPage
    .getByRole('heading', { name: /Application/ })
    .locator('xpath=ancestor::*[contains(@class,"ip-card")][1]');
  await applicationCard.getByLabel('Registration number').fill('LIVE-2026-001');
  await applicationCard
    .getByLabel('Business activity')
    .fill('Coffee and food service');
  await applicationCard
    .getByRole('button', { name: 'Submit application' })
    .click();
  await expect(merchantPage.getByText('Application submitted.')).toBeVisible();
  const kycCard = merchantPage
    .getByRole('heading', { name: /KYC/ })
    .locator('xpath=ancestor::*[contains(@class,"ip-card")][1]');
  await kycCard.getByLabel('Registration number').fill('LIVE-2026-001');
  await kycCard
    .getByLabel('Registered business name')
    .fill('Northstar Live Coffee Sdn Bhd');
  await kycCard.getByLabel('Tax ID').fill('TAX-LIVE-001');
  await kycCard
    .getByLabel('Registered address')
    .fill('12 Jalan Ampang, Kuala Lumpur');
  await kycCard.getByLabel('Person in charge').fill('Bryan Geh');
  await kycCard.getByLabel('Identity number').fill('900101-14-4567');
  await kycCard.getByLabel('Date of birth').fill('1990-01-01');
  await kycCard.getByLabel('Contact email').fill(merchantEmail);
  await kycCard.getByLabel('Contact phone').fill('+60123456789');
  await kycCard
    .getByRole('button', { name: 'Create documents and submit KYC' })
    .click();
  await expect(
    merchantPage.getByText(
      /KYC submitted with three private document records/u,
    ),
  ).toBeVisible();

  const accountRows = await database.db
    .select({ id: mcpAccounts.id })
    .from(mcpAccounts)
    .where(eq(mcpAccounts.merchantBranchId, merchantContext.branchId));
  const accountId = accountRows[0]?.id ?? '';
  acceptedBranchId = merchantContext.branchId;
  acceptedAccountId = accountId;
  await loginAdmin(
    adminPage,
    fixture.maker,
    merchantContext.branchId,
    accountId,
  );

  await adminPage.getByRole('link', { name: 'Reviews' }).click();
  const applicationRow = adminPage
    .getByRole('row')
    .filter({ hasText: merchantContext.branchId });
  await applicationRow.getByRole('button', { name: 'Approve' }).click();
  await expect(adminPage.getByText(/application approved/u)).toBeVisible();
  await adminPage.getByRole('tab', { name: 'KYC review' }).click();
  const kycRow = adminPage
    .getByRole('row')
    .filter({ hasText: merchantContext.branchId });
  await kycRow.getByRole('button', { name: 'Approve' }).click();
  await expect(adminPage.getByText(/kyc approved/u)).toBeVisible();

  await merchantPage.getByRole('link', { name: 'Overview' }).first().click();
  await expect(
    merchantPage.getByText('PENDING MCP', { exact: false }),
  ).toBeVisible();

  await adminPage.getByRole('link', { name: 'Packages' }).click();
  const profileCard = cardByHeading(adminPage, 'Create package profile');
  await profileCard.getByLabel('Code').fill(`E2E${randomUUID().slice(0, 6)}`);
  await profileCard.getByLabel('Name').fill('E2E Market Package');
  await profileCard.getByRole('button', { name: 'Create profile' }).click();
  const packageId = await resultId(adminPage);
  const versionCard = cardByHeading(adminPage, 'Create and activate version');
  await versionCard.getByLabel('Package ID').nth(0).fill(packageId);
  await versionCard.getByLabel('Exact rate').fill('10.000000');
  await versionCard.getByRole('button', { name: 'Create version' }).click();
  const packageVersionId = await resultId(adminPage);
  await versionCard.getByLabel('Package ID').nth(1).fill(packageId);
  await versionCard.getByLabel('Version ID').fill(packageVersionId);
  await versionCard.getByRole('button', { name: 'Activate version' }).click();
  await expect(
    adminPage.getByText('Package operation completed'),
  ).toBeVisible();
  const assignmentCard = cardByHeading(adminPage, 'Assign and set default');
  await assignmentCard.getByLabel('Version ID').first().fill(packageVersionId);
  await assignmentCard.getByRole('button', { name: 'Assign package' }).click();
  await expect(
    adminPage.getByText('Package operation completed'),
  ).toBeVisible();

  await adminPage.getByRole('link', { name: 'MCP' }).click();
  const rechargeCard = cardByHeading(adminPage, 'Recharge create / review');
  await rechargeCard.getByLabel('Amount').first().fill('100.0000000000');
  await rechargeCard
    .getByLabel('Reason')
    .first()
    .fill('Verified test funds; no provider call.');
  await rechargeCard.getByRole('button', { name: 'Create recharge' }).click();
  const rechargeId = await resultId(adminPage);
  await rechargeCard.getByLabel('Recharge request ID').fill(rechargeId);
  await rechargeCard
    .getByLabel('Review reason')
    .fill('Test funds independently verified.');
  await rechargeCard.getByRole('button', { name: 'Complete recharge' }).click();
  await expect(
    adminPage.getByText('100.0000000000', { exact: false }),
  ).toBeVisible();

  await merchantPage.reload();
  await expect(
    merchantPage.getByText('ACTIVE', { exact: false }),
  ).toBeVisible();
  await merchantPage.getByRole('link', { name: 'MCP' }).first().click();
  await expect(
    merchantPage.getByRole('heading', { name: 'MCP account' }),
  ).toBeVisible();
  await expect(
    merchantPage.getByText('100.0000000000', { exact: false }).first(),
  ).toBeVisible();

  await adminPage.getByRole('link', { name: 'Merchants' }).click();
  await adminPage.getByLabel('Search merchants').fill('Northstar Live');
  const merchantRow = adminPage
    .getByRole('row')
    .filter({ hasText: 'Northstar Live Coffee' });
  await merchantRow.getByRole('button', { name: 'Suspend' }).click();
  await expect(adminPage.getByText('suspend completed.')).toBeVisible();
  await expect(merchantRow).toContainText('SUSPENDED');
  await merchantRow.getByRole('button', { name: 'Reactivate' }).click();
  await expect(adminPage.getByText('reactivate completed.')).toBeVisible();

  await adminPage.getByRole('link', { name: 'MCP' }).click();
  const adjustmentCard = cardByHeading(adminPage, 'Maker / Checker adjustment');
  await adjustmentCard.getByLabel('Amount').fill('5.0000000000');
  await adjustmentCard
    .getByLabel('Reason')
    .first()
    .fill('Reconciliation correction.');
  await adjustmentCard.getByLabel('Evidence ticket').fill('FIN-E2E-001');
  await adjustmentCard
    .getByRole('button', { name: 'Maker creates request' })
    .click();
  const adjustmentId = await resultId(adminPage);
  await adjustmentCard
    .getByLabel('Adjustment request ID')
    .nth(0)
    .fill(adjustmentId);
  await adjustmentCard.getByRole('button', { name: 'Maker submits' }).click();
  await adjustmentCard
    .getByLabel('Adjustment request ID')
    .nth(1)
    .fill(adjustmentId);
  await adjustmentCard
    .getByLabel('Approval reason')
    .fill('Self approval must fail.');
  await adjustmentCard
    .getByRole('button', { name: 'Checker approves' })
    .click();
  await expect(adminPage.locator('.ip-alert--error')).toBeVisible();

  await clearAdminSession(adminPage);
  await loginAdmin(
    adminPage,
    fixture.checker,
    merchantContext.branchId,
    accountId,
  );
  await adminPage.getByRole('link', { name: 'MCP' }).click();
  const checkerCard = cardByHeading(adminPage, 'Maker / Checker adjustment');
  await checkerCard
    .getByLabel('Adjustment request ID')
    .nth(1)
    .fill(adjustmentId);
  await checkerCard
    .getByLabel('Approval reason')
    .fill('Evidence independently checked.');
  await checkerCard.getByRole('button', { name: 'Checker approves' }).click();
  await expect(adminPage.getByText(/"status": "APPROVED"/u)).toBeVisible();
  await checkerCard
    .getByLabel('Adjustment request ID')
    .nth(2)
    .fill(adjustmentId);
  await checkerCard
    .getByLabel('Execution reason')
    .fill('Approved adjustment executed once.');
  await checkerCard
    .getByRole('button', { name: 'Execute exactly once' })
    .click();
  await expect(adminPage.getByText(/"status": "EXECUTED"/u)).toBeVisible();

  await merchantPage.getByLabel('Amount').fill('5.0000000000');
  await merchantPage.getByLabel('Reason').fill('Non-cash refund obligation.');
  await merchantPage.getByRole('button', { name: 'Submit refund' }).click();
  await expect(
    merchantPage.getByText('Refund request submitted.'),
  ).toBeVisible();
  const refund = await database.pool.query<{ id: string }>(
    `SELECT r.id FROM mcp_refund_requests r JOIN mcp_accounts a ON a.id = r.mcp_account_id
     WHERE a.merchant_branch_id = $1 ORDER BY r.created_at DESC LIMIT 1`,
    [merchantContext.branchId],
  );
  const refundId = refund.rows[0]?.id ?? '';
  const refundCard = cardByHeading(adminPage, 'Refund create / review');
  await refundCard.getByLabel('Refund request ID').fill(refundId);
  await refundCard.getByLabel(/UNDER_REVIEW/).fill('UNDER_REVIEW');
  await refundCard.getByLabel('Review reason').fill('Review started.');
  await refundCard
    .getByRole('button', { name: 'Advance refund review' })
    .click();
  await expect(adminPage.getByText(/"status": "UNDER_REVIEW"/u)).toBeVisible();
  await refundCard.getByLabel('Refund request ID').fill(refundId);
  await refundCard.getByLabel(/UNDER_REVIEW/).fill('APPROVED');
  await refundCard
    .getByLabel('Review reason')
    .fill('Non-cash obligation approved.');
  await refundCard
    .getByRole('button', { name: 'Advance refund review' })
    .click();
  await expect(adminPage.getByText(/"status": "APPROVED"/u)).toBeVisible();

  const auditResponse = await adminPage.evaluate(async (branchId) => {
    const tokens = JSON.parse(
      localStorage.getItem('ipoint.admin.session') ?? '{}',
    ) as { accessToken?: string };
    const response = await fetch(
      `http://127.0.0.1:3100/api/v1/admin/audit?entityType=merchant_branch&entityId=${branchId}`,
      { headers: { authorization: `Bearer ${tokens.accessToken ?? ''}` } },
    );
    return {
      status: response.status,
      body: (await response.json()) as unknown,
    };
  }, merchantContext.branchId);
  expect(auditResponse.status, JSON.stringify(auditResponse.body)).toBe(200);
  expect(JSON.stringify(auditResponse.body)).toContain(
    'merchant.operational.active',
  );
  await adminPage.getByRole('link', { name: 'Audit' }).click();
  await expect(
    adminPage.getByRole('heading', { name: 'Audit log and entity timeline' }),
  ).toBeVisible();

  await merchantPage.close();
  await adminPage.close();
});

test('live negative paths expose market, session, and idempotency failures', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4175');
  await page.getByLabel('Admin email').fill(fixture.maker.email);
  await page.getByLabel('Password').fill(fixture.maker.password);
  await page.getByLabel('Market ID').fill(randomUUID());
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(
    page.getByRole('heading', { name: 'Market access denied' }),
  ).toBeVisible();

  await clearAdminSession(page);
  await loginAdmin(page, fixture.maker, acceptedBranchId, acceptedAccountId);
  const idempotency = await page.evaluate(
    async ({ marketId, branchId }) => {
      const tokens = JSON.parse(
        localStorage.getItem('ipoint.admin.session') ?? '{}',
      ) as { accessToken?: string };
      const key = crypto.randomUUID();
      const send = (amount: string) =>
        fetch(
          `http://127.0.0.1:3100/api/v1/admin/markets/${marketId}/merchants/${branchId}/recharge`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${tokens.accessToken ?? ''}`,
              'content-type': 'application/json',
              'idempotency-key': key,
            },
            body: JSON.stringify({
              amount,
              reason: 'Idempotency acceptance request.',
            }),
          },
        );
      const first = await send('1.0000000000');
      const replay = await send('1.0000000000');
      const mismatch = await send('2.0000000000');
      return {
        first: first.status,
        replay: replay.status,
        mismatch: mismatch.status,
      };
    },
    { marketId: fixture.marketId, branchId: acceptedBranchId },
  );
  expect(idempotency).toEqual({ first: 201, replay: 201, mismatch: 409 });

  await clearAdminSession(page);
  await expect(
    page.getByRole('heading', { name: 'Admin login' }),
  ).toBeVisible();

  await page.evaluate(() => {
    localStorage.setItem(
      'ipoint.admin.session',
      JSON.stringify({
        accessToken: 'expired-access-token',
        refreshToken: 'expired-refresh-token',
        accessExpiresAt: new Date(0).toISOString(),
        refreshExpiresAt: new Date(0).toISOString(),
      }),
    );
    localStorage.setItem(
      'ipoint.admin.context',
      JSON.stringify({ marketId: crypto.randomUUID() }),
    );
  });
  await page.reload();
  await expect(page.getByText('Session expired')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Admin login' }),
  ).toBeVisible();
});

test('static state boundaries remain available for deterministic UI acceptance', async ({
  page,
}) => {
  for (const [state, title] of Object.entries({
    loading: 'Loading merchant workspace',
    error: 'Unable to load the workspace',
    empty: 'No merchant data yet',
    offline: 'You are offline',
    forbidden: 'Permission denied',
    expired: 'Session expired',
  })) {
    await page.goto(`http://127.0.0.1:4174/?state=${state}`);
    await expect(
      state === 'loading'
        ? page.getByRole('region', { name: title })
        : page.getByText(title, { exact: true }),
    ).toBeVisible();
  }
});

async function createAdmin(
  label: string,
  marketId: string,
  roleId: string,
): Promise<AdminFixture> {
  const email = `${randomUUID()}@example.com`;
  const password = `${label.replaceAll(' ', '-')}-Password-123!`;
  const accountRows = await database.db
    .insert(accounts)
    .values({
      publicId: `acct_${randomUUID()}`,
      email,
      accountCountry: 'MY',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    })
    .returning({ id: accounts.id });
  const accountId = accountRows[0]?.id ?? '';
  const secretHash = await new PasswordHasher().hash(password);
  await database.db.insert(credentials).values({
    accountId,
    type: 'PASSWORD',
    secretHash,
    hashAlgorithm: 'scrypt',
    hashVersion: 1,
  });
  const adminRows = await database.db
    .insert(adminUsers)
    .values({ accountId, displayName: label })
    .returning({ id: adminUsers.id });
  const adminUserId = adminRows[0]?.id ?? '';
  await database.db
    .insert(roleAssignments)
    .values({ adminUserId, roleId, assignedByAdminUserId: adminUserId });
  await database.db
    .insert(marketAccess)
    .values({ adminUserId, marketId, grantedByAdminUserId: adminUserId });
  return { email, password, adminUserId };
}

async function registerMerchant(page: Page, email: string, password: string) {
  await page.goto('http://127.0.0.1:4174');
  await page.getByRole('button', { name: 'Open account access' }).click();
  const card = cardByHeading(page, 'Register merchant');
  await card.getByLabel('Email').fill(email);
  await card.getByLabel('Password').fill(password);
  await card.getByLabel('Business display name').fill('Northstar Live Coffee');
  await card.getByLabel('Phone').fill('+60123456789');
  await card.getByLabel('Market ID').fill(fixture.marketId);
  await card.getByRole('button', { name: 'Issue email OTP' }).click();
  await expect(card.getByLabel('OTP code')).not.toHaveValue('');
  await card.getByRole('button', { name: 'Verify OTP and register' }).click();
  await expect(
    page.getByRole('heading', { name: 'Profile and media' }),
  ).toBeVisible();
}

async function loginAdmin(
  page: Page,
  admin: AdminFixture,
  branchId: string,
  accountId: string,
) {
  await page.goto('http://127.0.0.1:4175');
  await page.getByLabel('Admin email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByLabel('Market ID').fill(fixture.marketId);
  await page.getByLabel('Branch ID (optional)').fill(branchId);
  await page.getByLabel('MCP account ID (optional)').fill(accountId);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(
    page.getByRole('heading', { name: 'Admin command center' }),
  ).toBeVisible();
}

async function clearAdminSession(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('ipoint.admin.session');
    localStorage.removeItem('ipoint.admin.context');
  });
  await page.reload();
}

function cardByHeading(page: Page, heading: string) {
  return page
    .getByRole('heading', { name: heading })
    .locator('xpath=ancestor::*[contains(@class,"ip-card")][1]');
}

async function resultId(page: Page): Promise<string> {
  const raw = await page.locator('.ip-alert pre').textContent();
  const value = JSON.parse(raw ?? '{}') as { id?: string };
  expect(value.id).toBeTruthy();
  return value.id ?? '';
}

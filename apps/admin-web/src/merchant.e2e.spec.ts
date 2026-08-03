import { resolve } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * P7-S5B Admin merchant operations browser verification (sandbox-friendly).
 *
 * Runs against a local Vite server with the API fully mocked in the spec, so
 * no live API or database is required. Desktop + 320px mobile merchant
 * flows plus axe coverage (zero serious/critical violations).
 *
 * NOTE: the sandbox image cannot launch Chromium (missing shared libraries,
 * read-only apt), so this spec is delivered ready-to-run on the host/CI and
 * is verified locally by the jsdom axe checks in the component tests.
 */

const marketId = '11111111-1111-4111-8111-111111111111';
const branchId = '33333333-3333-4333-8333-333333333333';

test('desktop merchants queue, list and masked branch detail render axe-clean', async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.goto(`/admin/${marketId}/merchants`);
  await authenticate(page);

  await expect(page.getByRole('heading', { name: 'Merchants' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Kopitiam Sdn Bhd' }),
  ).toBeVisible();

  // Merchant list tab.
  await page.getByRole('tab', { name: 'Merchants' }).click();
  await expect(
    page.getByRole('link', { name: 'Kopitiam Sdn Bhd' }),
  ).toBeVisible();
  await expect(page.getByText('1250.00000000')).toBeVisible();

  // Branch detail: masked KYC (raw value never rendered), package history,
  // MCP summary.
  await page.getByRole('link', { name: 'Kopitiam Sdn Bhd' }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Kopitiam Sdn Bhd' }),
  ).toBeVisible();
  await expect(page.getByText('****1234')).toBeVisible();
  await expect(page.getByText('900101-01-1234')).toHaveCount(0);
  await expect(page.getByText('0.012500')).toBeVisible();
  await expect(page.getByText('TRANSACTION_DEDUCTION')).toBeVisible();

  await expectNoSeriousOrCriticalViolations(page);
});

test('320px mobile merchants page reflows with drawer and no overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockAdminApi(page);
  await page.goto(`/admin/${marketId}/merchants`);
  await authenticate(page);

  await expect(page.getByRole('heading', { name: 'Merchants' })).toBeVisible();

  // Mobile drawer opens and closes with Escape and focus restoration.
  const menuButton = page.getByRole('button', {
    name: 'Open Admin navigation',
  });
  await menuButton.click();
  const drawer = page.getByRole('dialog', { name: 'Admin navigation' });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(menuButton).toBeFocused();

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  await expectNoSeriousOrCriticalViolations(page);
});

async function authenticate(page: Page) {
  await page.getByLabel('Admin email').fill('admin@example.com');
  await page.getByLabel('Password').fill('Admin-Password-123!');
  await page.getByRole('button', { name: 'Continue securely' }).click();
  await page.getByLabel('Authentication code').fill('123456');
  await page.getByRole('button', { name: 'Open Admin workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Merchants' })).toBeVisible();
}

async function expectNoSeriousOrCriticalViolations(page: Page) {
  await page.addScriptTag({
    path: resolve('packages/ui/node_modules/axe-core/axe.min.js'),
  });
  const seriousViolations = await page.evaluate(async () => {
    const axeApi = (
      window as unknown as {
        axe: {
          run: () => Promise<{
            violations: Array<{ id: string; impact: string | null }>;
          }>;
        };
      }
    ).axe;
    const result = await axeApi.run();
    return result.violations.filter(
      ({ impact }) => impact === 'serious' || impact === 'critical',
    );
  });
  expect(seriousViolations).toEqual([]);
}

function market(code: string, name: string) {
  return {
    id: code === 'MY' ? marketId : '22222222-2222-4222-8222-222222222222',
    code,
    name,
    isSelected: code === 'MY',
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockAdminApi(page: Page) {
  const queue = [
    {
      application_id: 'app-1',
      branch_id: branchId,
      merchant_id: 'M-00000001',
      display_name: 'Kopitiam Sdn Bhd',
      application_status: 'SUBMITTED',
      operational_status: 'PENDING_APPLICATION',
      updated_at: '2026-08-01T08:30:00.000Z',
    },
  ];
  const list = {
    items: [
      {
        branch_id: branchId,
        merchant_id: 'M-00000001',
        name: 'Kopitiam Sdn Bhd',
        status: 'ACTIVE',
        market_id: marketId,
        created_at: '2026-07-01T00:00:00.000Z',
        application_status: 'APPROVED',
        kyc_status: 'APPROVED',
        mcp_account_id: '55555555-5555-4555-8555-555555555555',
        available_balance: '1250.00000000',
      },
    ],
    limit: 25,
    offset: 0,
  };
  const detail = {
    branch_id: branchId,
    merchant_id: 'M-00000001',
    market_id: marketId,
    profile: {
      branch_id: branchId,
      merchant_id: 'M-00000001',
      market_id: marketId,
      display_name: 'Kopitiam Sdn Bhd',
      primary_email: 'owner@kopitiam.example',
      phone: '+60123456789',
      address: '1 Jalan Kopi',
      about: null,
      business_hours: null,
      website: null,
      whatsapp: null,
      socials: null,
      logo_object_key: null,
      banner_object_key: null,
      gallery: [],
    },
    application: {
      application_id: 'app-1',
      status: 'APPROVED',
      operational_status: 'ACTIVE',
      submissions: [],
      reviews: [],
    },
    kyc: {
      current: {
        submission_id: 'kyc-1',
        submission_version: 1,
        status: 'APPROVED',
        submitted_at: '2026-07-12T01:00:00.000Z',
        data: {
          business_certification: {
            registration_number: '***2345',
            tax_id: '***5678',
          },
          pic_identity: { identity_number: '****1234' },
          pic_contact: { phone: '***789' },
        },
      },
      previous: null,
    },
    packages: {
      items: [
        {
          assignment_id: 'assign-1',
          service_fee_profile_id: 'sfp-1',
          service_fee_profile_code: 'A',
          service_fee_profile_name: 'Package A',
          service_fee_version_id: 'sfv-1',
          rate: '0.012500',
          effective_from: '2026-07-01T00:00:00.000Z',
          effective_to: null,
          special_percentage_id: null,
          special_percentage_rate: null,
          special_percentage_description: null,
          status: 'ACTIVE',
          is_default: true,
          version: 1,
          created_at: '2026-07-05T00:00:00.000Z',
          updated_at: '2026-07-05T00:00:00.000Z',
        },
      ],
      limit: 20,
      offset: 0,
    },
    mcp: {
      account: {
        id: '55555555-5555-4555-8555-555555555555',
        branch_id: branchId,
        market_id: marketId,
        available_balance: '1250.00000000',
        total_balance: '1250.00000000',
        status: 'ACTIVE',
        version: 1,
      },
      reconciliation: {
        account_id: '55555555-5555-4555-8555-555555555555',
        stored: { total: '1250.00000000', available: '1250.00000000' },
        computed: {
          total: '1250.0000000000',
          available: '1250.0000000000',
          entries: 2,
        },
        matches: true,
      },
      recent_ledger: {
        items: [
          {
            id: 'ledger-1',
            sequence: '2',
            entryType: 'TRANSACTION_DEDUCTION',
            direction: 'DEBIT',
            amount: '50.0000000000',
            balanceDelta: '-50.0000000000',
            availableDelta: '-50.0000000000',
            sourceType: 'TRANSACTION',
            sourceId: 'tx-1',
            reason: 'Fixture deduction',
            effectiveAt: '2026-07-20T03:00:00.000Z',
            createdAt: '2026-07-20T03:00:00.000Z',
          },
        ],
        limit: 10,
        offset: 0,
      },
    },
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path.endsWith('/auth/admin/login')) {
      await json(route, {
        code: 'MFA_REQUIRED',
        mfa_challenge_id: 'challenge'.repeat(4),
        expires_at: '2026-08-01T12:05:00.000Z',
      });
      return;
    }
    if (path.endsWith('/auth/admin/mfa/challenge')) {
      await json(route, {
        accessToken: 'admin-access-token',
        refreshToken: 'admin-refresh-token',
        accessExpiresAt: '2026-08-01T12:15:00.000Z',
        refreshExpiresAt: '2026-08-08T12:00:00.000Z',
      });
      return;
    }
    if (path.endsWith('/admin/bootstrap')) {
      await json(route, {
        actor: {
          id: 'admin-1',
          accountId: 'account-1',
          displayName: 'Bryan Admin',
          status: 'ACTIVE',
        },
        roles: [{ id: 'role-1', code: 'SUPER_ADMIN', name: 'Super Admin' }],
        effectivePermissions: [
          'merchant.view',
          'merchant.approve',
          'merchant.kyc.approve',
          'merchant.suspend',
          'merchant.close',
          'merchant.mcp.view',
        ],
        accessibleMarkets: [market('MY', 'Malaysia')],
        currentMarket: market('MY', 'Malaysia'),
        contextVersion: 1,
        availability: { operationalWorkspace: 'AVAILABLE' },
        asOf: '2026-08-01T12:00:00.000Z',
      });
      return;
    }
    if (path.endsWith('/admin/me/markets')) {
      await json(route, {
        items: [market('MY', 'Malaysia')],
        currentMarketId: marketId,
        contextVersion: 1,
        asOf: '2026-08-01T12:00:00.000Z',
      });
      return;
    }
    if (path.endsWith('/admin/sessions/current')) {
      await json(route, {
        valid: true,
        session_id: 'session-1',
        admin_user_id: 'admin-1',
        mfa_recovery_used: false,
      });
      return;
    }
    if (path.endsWith('/admin/sessions')) {
      await json(route, { sessions: [] });
      return;
    }
    if (/\/merchants\/applications/u.test(path) && method === 'GET') {
      await json(route, queue);
      return;
    }
    if (/\/merchants\/(?:[^/]+)\/detail$/u.test(path) && method === 'GET') {
      await json(route, detail);
      return;
    }
    if (path.endsWith('/merchants') && method === 'GET') {
      await json(route, list);
      return;
    }
    await json(route, { code: 'NOT_MOCKED', message: path }, 500);
  });
}

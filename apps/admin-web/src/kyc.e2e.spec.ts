import { resolve } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * P7-S5C Admin KYC review + privacy browser verification (sandbox-friendly).
 *
 * Runs against a local Vite server with the API fully mocked in the spec, so
 * no live API or database is required. Covers the member and merchant KYC
 * queues, masked case detail, the raw-evidence reveal flow (mandatory
 * recorded reason + MFA step-up + audit confirmation), the denied state, and
 * 320px mobile reflow with axe (zero serious/critical violations).
 *
 * NOTE: the sandbox image cannot launch Chromium (missing shared libraries,
 * read-only apt), so this spec is delivered ready-to-run on the host/CI and
 * is verified locally by the jsdom axe checks in the component tests.
 */

const marketId = '11111111-1111-4111-8111-111111111111';
const caseId = '33333333-3333-4333-8333-333333333333';
const branchId = '44444444-4444-4444-8444-444444444444';

test('member KYC queue, masked detail and evidence reveal flow render axe-clean', async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.goto(`/admin/${marketId}/kyc/members`);
  await authenticate(page, 'Member KYC queue');

  await expect(page.getByRole('link', { name: 'mem_public_1' })).toBeVisible();
  await expect(page.getByText('j***@example.com')).toBeVisible();
  await expect(page.getByText('jane@example.com')).toHaveCount(0);

  // Masked case detail: identity fields are masked, document rows are
  // metadata only, raw values never rendered.
  await page.getByRole('link', { name: 'mem_public_1' }).click();
  await expect(
    page.getByRole('heading', { name: 'mem_public_1' }),
  ).toBeVisible();
  await expect(page.getByText('J*** M*** D***')).toBeVisible();
  await expect(page.getByText('Jane Mildred Doe')).toHaveCount(0);
  await expect(page.getByText('****1234')).toBeVisible();

  // Evidence reveal: mandatory reason, then step-up, then server-confirmed
  // audit note. Raw identity values appear only after the reveal.
  await page.getByRole('button', { name: 'View sensitive evidence' }).click();
  await expect(
    page.getByText(/reason of at least 8 characters/u),
  ).toBeVisible();
  await page
    .getByLabel('Reason for viewing evidence (required, server-recorded)')
    .fill('Identity verification review');
  await page.getByRole('button', { name: 'View sensitive evidence' }).click();
  await expect(page.getByLabel('MFA verification code')).toBeVisible();
  await page.getByLabel('MFA verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify and view evidence' }).click();
  await expect(page.getByText('Jane Mildred Doe')).toBeVisible();
  await expect(page.getByText(/recorded in the audit trail/u)).toBeVisible();

  await expectNoSeriousOrCriticalViolations(page);
});

test('merchant KYC queue, masked submission detail and evidence flow render axe-clean', async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.goto(`/admin/${marketId}/kyc/merchants`);
  await authenticate(page, 'Merchant KYC queue');

  await expect(page.getByRole('link', { name: 'Acme Sdn Bhd' })).toBeVisible();

  await page.getByRole('link', { name: 'Acme Sdn Bhd' }).click();
  await expect(
    page.getByRole('heading', { name: 'Acme Sdn Bhd' }),
  ).toBeVisible();
  // Masked summary: registration number masked, raw value absent.
  await expect(page.getByText('***2345')).toBeVisible();
  await expect(page.getByText('202001012345')).toHaveCount(0);

  await page.getByRole('button', { name: 'View sensitive evidence' }).click();
  await page
    .getByLabel('Reason for viewing evidence (required, server-recorded)')
    .fill('Business verification review');
  await page.getByRole('button', { name: 'View sensitive evidence' }).click();
  await expect(page.getByLabel('MFA verification code')).toBeVisible();
  await page.getByLabel('MFA verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify and view evidence' }).click();
  await expect(page.getByText('202001012345')).toBeVisible();
  await expect(page.getByText(/recorded in the audit trail/u)).toBeVisible();

  await expectNoSeriousOrCriticalViolations(page);
});

test('support-role admin sees the locked evidence state on the case detail', async ({
  page,
}) => {
  await mockAdminApi(page, {
    permissions: ['member.kyc.read'],
    evidenceDenied: true,
  });
  await page.goto(`/admin/${marketId}/kyc/members/${caseId}`);
  await authenticate(page, 'mem_public_1');

  await expect(page.getByText(/Raw evidence is locked/u)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'View sensitive evidence' }),
  ).toHaveCount(0);
  await expect(page.getByText('Jane Mildred Doe')).toHaveCount(0);

  await expectNoSeriousOrCriticalViolations(page);
});

test('320px mobile KYC queue reflows with drawer and no overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockAdminApi(page);
  await page.goto(`/admin/${marketId}/kyc/members`);
  await authenticate(page, 'Member KYC queue');

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

async function authenticate(page: Page, heading: string) {
  await page.getByLabel('Admin email').fill('admin@example.com');
  await page.getByLabel('Password').fill('Admin-Password-123!');
  await page.getByRole('button', { name: 'Continue securely' }).click();
  await page.getByLabel('Authentication code').fill('123456');
  await page.getByRole('button', { name: 'Open Admin workspace' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
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

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockAdminApi(
  page: Page,
  options: { permissions?: string[]; evidenceDenied?: boolean } = {},
) {
  const permissions = options.permissions ?? [
    'member.kyc.read',
    'member.kyc.decide',
    'member.kyc.evidence.view',
    'merchant.kyc.view',
    'merchant.kyc.approve',
    'merchant.kyc.evidence.view',
  ];
  const market = {
    id: marketId,
    code: 'MA',
    name: 'Malaysia',
    currencyCode: 'MYR',
    timezone: 'Asia/Kuala_Lumpur',
    locale: 'en-MY',
    grantedAt: '2026-01-01T00:00:00.000Z',
    isSelected: true,
  };

  const memberList = {
    items: [
      {
        id: caseId,
        marketId,
        status: 'SUBMITTED',
        levelRequested: 'LEVEL_2',
        member: {
          publicMemberId: 'mem_public_1',
          displayName: null,
          email: 'j***@example.com',
          accountCountry: 'MY',
          status: 'ACTIVE',
          kycLevel: 'LEVEL_1',
        },
        submittedAt: '2026-08-01T00:00:00.000Z',
        reviewedAt: null,
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
    marketId,
  };

  const memberDetail = {
    ...memberList.items[0],
    version: 1,
    legalFullName: 'J*** M*** D***',
    identificationType: 'NATIONAL_ID',
    identificationNumber: '****1234',
    dateOfBirth: null,
    nationality: 'MY',
    residentialAddress: null,
    accountCountrySnapshot: 'MY',
    submissionMarketId: marketId,
    consentVersion: 'test-v1',
    reviewedByAdminUserId: null,
    decisionReason: null,
    reverificationRequiredAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    documents: [
      {
        id: 'doc-1',
        documentType: 'national_id',
        mimeType: 'image/png',
        size: 1024,
        checksum: 'a'.repeat(64),
        scanStatus: 'PASSED',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    history: [],
    evidenceAccess: { masked: true, rawDocumentContent: false, audited: true },
  };

  const memberEvidence = {
    ...memberDetail,
    legalFullName: 'Jane Mildred Doe',
    dateOfBirth: '1990-01-02',
    residentialAddress: { line1: '1 Test Street' },
    evidenceAccess: { masked: false, rawDocumentContent: false, audited: true },
  };

  const merchantQueue = {
    items: [
      {
        submission_id: 'sub-1',
        branch_id: branchId,
        merchant_id: 'MERCH-1',
        display_name: 'Acme Sdn Bhd',
        status: 'SUBMITTED',
        submission_version: 1,
        submitted_at: '2026-08-01T00:00:00.000Z',
        reviewed_at: null,
      },
    ],
    marketId,
    limit: 50,
    offset: 0,
  };

  const merchantDetail = {
    branch_id: branchId,
    merchant_id: 'MERCH-1',
    market_id: marketId,
    display_name: 'Acme Sdn Bhd',
    current: {
      submission_id: 'sub-1',
      submission_version: 1,
      status: 'SUBMITTED',
      submitted_at: '2026-08-01T00:00:00.000Z',
      data: {
        business_certification: { registration_number: '***2345' },
        pic_identity: { identity_number: '****1234' },
      },
      review: null,
    },
    previous: null,
    evidenceAccess: { masked: true, rawDocumentContent: false, audited: true },
  };

  const merchantEvidence = {
    ...merchantDetail,
    current: {
      ...merchantDetail.current,
      data: {
        business_certification: { registration_number: '202001012345' },
        pic_identity: { identity_number: '900102-14-1234' },
      },
    },
    evidenceAccess: { masked: false, rawDocumentContent: false, audited: true },
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path.endsWith('/auth/admin/login') && method === 'POST') {
      return json(
        route,
        {
          code: 'MFA_REQUIRED',
          mfa_challenge_id: 'challenge'.repeat(4),
          expires_at: '2026-08-01T12:05:00.000Z',
        },
        202,
      );
    }
    if (path.endsWith('/auth/admin/mfa/challenge') && method === 'POST') {
      return json(route, {
        accessToken: 'admin-access-token',
        refreshToken: 'admin-refresh-token',
        accessExpiresAt: '2026-08-01T12:15:00.000Z',
        refreshExpiresAt: '2026-08-08T12:00:00.000Z',
      });
    }
    if (path.endsWith('/admin/bootstrap')) {
      return json(route, {
        actor: {
          id: 'admin-1',
          accountId: 'account-1',
          displayName: 'Bryan Admin',
          status: 'ACTIVE',
        },
        roles: [{ id: 'role-1', code: 'SUPER_ADMIN', name: 'Super Admin' }],
        effectivePermissions: permissions,
        accessibleMarkets: [{ ...market, isSelected: true }],
        currentMarket: market,
        contextVersion: 3,
        availability: { operationalWorkspace: 'AVAILABLE' },
        asOf: '2026-08-01T12:00:00.000Z',
      });
    }
    if (path.endsWith('/admin/me/markets') && method === 'GET') {
      return json(route, {
        items: [{ ...market, isSelected: true }],
        currentMarketId: marketId,
        contextVersion: 3,
        asOf: '2026-08-01T12:00:00.000Z',
      });
    }
    if (path.endsWith('/admin/sessions/current')) {
      return json(route, {
        valid: true,
        session_id: 'session-1',
        admin_user_id: 'admin-1',
        mfa_recovery_used: false,
      });
    }
    if (path.endsWith('/admin/sessions')) return json(route, { sessions: [] });
    if (
      path.endsWith('/auth/admin/mfa/step-up/challenge') &&
      method === 'POST'
    ) {
      return json(
        route,
        {
          step_up_challenge_id: 'challenge'.repeat(4),
          expires_at: '2026-08-01T12:15:00.000Z',
        },
        202,
      );
    }
    if (path.endsWith('/auth/admin/mfa/step-up/verify') && method === 'POST') {
      return json(route, {
        step_up_token: 'stepup-grant-token',
        expires_at: '2026-08-01T12:15:00.000Z',
      });
    }

    // Member KYC.
    const memberEvidenceMatch =
      /\/admin\/kyc-ops\/members\/([^/]+)\/evidence$/u.exec(path);
    if (memberEvidenceMatch && method === 'GET') {
      if (options.evidenceDenied) {
        return json(route, { code: 'PERMISSION_DENIED' }, 403);
      }
      const reason = request.headers()['x-sensitive-access-reason']?.trim();
      if (!reason || reason.length < 8 || reason.length > 500) {
        return json(route, { code: 'SENSITIVE_VIEW_REASON_REQUIRED' }, 422);
      }
      if (!request.headers()['x-step-up-token']) {
        return json(route, { code: 'MFA_STEP_UP_REQUIRED' }, 403);
      }
      return json(route, memberEvidence);
    }
    if (/\/admin\/kyc-ops\/members\/([^/]+)$/u.test(path) && method === 'GET') {
      return json(route, memberDetail);
    }
    if (/\/admin\/kyc-ops\/members(\?|$)/u.test(path) && method === 'GET') {
      return json(route, memberList);
    }

    // Merchant KYC.
    const merchantEvidenceMatch =
      /\/admin\/kyc-ops\/merchants\/([^/]+)\/evidence$/u.exec(path);
    if (merchantEvidenceMatch && method === 'GET') {
      if (options.evidenceDenied) {
        return json(route, { code: 'PERMISSION_DENIED' }, 403);
      }
      const reason = request.headers()['x-sensitive-access-reason']?.trim();
      if (!reason || reason.length < 8 || reason.length > 500) {
        return json(route, { code: 'SENSITIVE_VIEW_REASON_REQUIRED' }, 422);
      }
      if (!request.headers()['x-step-up-token']) {
        return json(route, { code: 'MFA_STEP_UP_REQUIRED' }, 403);
      }
      return json(route, merchantEvidence);
    }
    if (
      /\/admin\/kyc-ops\/merchants\/([^/]+)$/u.test(path) &&
      method === 'GET'
    ) {
      return json(route, merchantDetail);
    }
    if (/\/admin\/kyc-ops\/merchants(\?|$)/u.test(path) && method === 'GET') {
      return json(route, merchantQueue);
    }

    return json(route, { code: 'NOT_MOCKED' }, 500);
  });
}

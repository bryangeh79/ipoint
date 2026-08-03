import axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import { kycOpsCaseId, kycOpsMarketA } from './test/kyc-fixtures.js';
import { mockKycOpsApi } from './test/kyc-mock.js';

const DETAIL_URL = `/admin/${kycOpsMarketA}/kyc/members/${kycOpsCaseId}`;

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

async function signIn() {
  render(<AdminApp router={createAdminMemoryRouter([DETAIL_URL])} />);
  fireEvent.change(await screen.findByLabelText('Admin email'), {
    target: { value: 'admin@example.com' },
  });
  fireEvent.change(await screen.findByLabelText('Password'), {
    target: { value: 'Admin-Password-123!' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Continue securely' }),
  );
  fireEvent.change(await screen.findByLabelText('Authentication code'), {
    target: { value: '123456' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Open Admin workspace' }),
  );
  await screen.findByText('Bryan Admin');
}

describe('P7-S5C member KYC detail page', () => {
  it('renders the masked identity summary, document metadata, and history', async () => {
    mockKycOpsApi(['member.kyc.read']);
    await signIn();
    await screen.findByRole('heading', { name: /Member KYC case/ });

    expect(await screen.findByText('J*** M*** D***')).toBeInTheDocument();
    expect(
      screen.getByText(
        (content: string) =>
          content.includes('NATIONAL_ID') && content.includes('****1234'),
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Not shown').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/j\*\*\*@example\.com/)).toBeInTheDocument();
    // Document metadata table (no content references).
    expect(screen.getByText('national_id')).toBeInTheDocument();
    expect(screen.getByText('1024 bytes')).toBeInTheDocument();
    expect(screen.queryByText(/object_key|originalFilename/iu)).toBeNull();
    expect(screen.getByText('KYC case submitted.')).toBeInTheDocument();
    // The masked summary never reveals the full name.
    expect(screen.queryByText('Jane Mildred Doe')).not.toBeInTheDocument();
  });

  it('locks raw evidence without the evidence permission', async () => {
    mockKycOpsApi(['member.kyc.read']);
    await signIn();
    await screen.findByRole('heading', { name: /Member KYC case/ });
    expect(
      await screen.findByText(/Raw evidence is locked/iu),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'View sensitive evidence' }),
    ).not.toBeInTheDocument();
  });

  it('runs the evidence flow: reason, step-up, verified view, audit notice', async () => {
    const mock = mockKycOpsApi(['member.kyc.read', 'member.kyc.evidence.view']);
    await signIn();
    await screen.findByRole('heading', { name: /Member KYC case/ });

    await userEvent.click(
      screen.getByRole('button', { name: 'View sensitive evidence' }),
    );
    // Too-short reason is rejected client-side.
    expect(
      await screen.findByText(/recorded reason of at least 8 characters/iu),
    ).toBeInTheDocument();

    const reason = screen.getByLabelText(/Reason for viewing evidence/iu);
    await userEvent.type(reason, 'Identity verification review');
    await userEvent.click(
      screen.getByRole('button', { name: 'View sensitive evidence' }),
    );

    // Server requires step-up: the code prompt appears.
    const code = await screen.findByLabelText('MFA verification code');
    await userEvent.type(code, '123456');
    await userEvent.click(
      screen.getByRole('button', { name: 'Verify and view evidence' }),
    );

    expect(await screen.findByText('Jane Mildred Doe')).toBeInTheDocument();
    expect(screen.getByText('Full evidence shown')).toBeInTheDocument();
    expect(
      screen.getByText(
        /every sensitive evidence view is recorded in the audit trail/iu,
      ),
    ).toBeInTheDocument();
    // The evidence request carried the reason and step-up token headers.
    const evidenceCalls = mock.fetchSpy.mock.calls.filter(([url, init]) =>
      String(url).includes('/evidence'),
    );
    expect(evidenceCalls.length).toBeGreaterThan(0);
    const headers = new Headers(evidenceCalls.at(-1)?.[1]?.headers);
    expect(headers.get('x-sensitive-access-reason')).toBe(
      'Identity verification review',
    );
    expect(headers.get('x-step-up-token')).toBe('stepup-grant-token');
  });

  it('executes a review action and refreshes the case state', async () => {
    mockKycOpsApi(['member.kyc.read', 'member.kyc.decide']);
    await signIn();
    await screen.findByRole('heading', { name: /Member KYC case/ });

    await userEvent.click(screen.getByRole('button', { name: 'Start review' }));
    const reason = await screen.findByLabelText(
      'Reason (required, server-recorded)',
    );
    await userEvent.type(reason, 'Starting document review');
    await userEvent.click(screen.getByRole('button', { name: 'Start review' }));

    expect(
      await screen.findByText(/Start review completed/iu),
    ).toBeInTheDocument();
    expect(await screen.findByText('Under review')).toBeInTheDocument();
  });

  it('shows an unavailable affordance for actions the state does not allow', async () => {
    mockKycOpsApi(['member.kyc.read', 'member.kyc.decide']);
    await signIn();
    await screen.findByRole('heading', { name: /Member KYC case/ });
    await waitFor(() =>
      expect(
        screen.queryAllByText(/case status SUBMITTED/iu).length,
      ).toBeGreaterThan(0),
    );
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
  });

  it('renders conflict and error states', async () => {
    mockKycOpsApi({
      permissions: ['member.kyc.read'],
      detailFails: { status: 409, code: 'MARKET_CONTEXT_MISMATCH' },
    });
    await signIn();
    expect(
      await screen.findByText('KYC case is outside the selected market'),
    ).toBeInTheDocument();
  });

  it('renders a permission-denied state without the route permission', async () => {
    mockKycOpsApi({ permissions: ['dashboard.view'] });
    await signIn();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
  });

  it('has zero serious or critical axe violations on the loaded detail', async () => {
    mockKycOpsApi(['member.kyc.read', 'member.kyc.decide']);
    await signIn();
    await screen.findByRole('heading', { name: /Member KYC case/ });
    await screen.findByText('J*** M*** D***');
    const results = await axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(serious).toHaveLength(0);
  });

  it('rejects a step-up failure with a visible error', async () => {
    const mock = mockKycOpsApi(['member.kyc.read', 'member.kyc.evidence.view']);
    await signIn();
    await screen.findByRole('heading', { name: /Member KYC case/ });

    await userEvent.click(
      screen.getByRole('button', { name: 'View sensitive evidence' }),
    );
    const reason = screen.getByLabelText(/Reason for viewing evidence/iu);
    await userEvent.type(reason, 'Identity verification review');
    await userEvent.click(
      screen.getByRole('button', { name: 'View sensitive evidence' }),
    );

    // Break the step-up verify endpoint; delegate everything else.
    const original = mock.fetchSpy.getMockImplementation();
    mock.fetchSpy.mockImplementation(async (input, init) => {
      if (String(input).includes('/step-up/verify')) {
        return new Response(JSON.stringify({ code: 'MFA_CHALLENGE_FAILED' }), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (original) return original(input, init);
      return new Response(JSON.stringify({ code: 'NOT_MOCKED' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    });

    const code = await screen.findByLabelText('MFA verification code');
    await userEvent.type(code, '123456');
    await userEvent.click(
      screen.getByRole('button', { name: 'Verify and view evidence' }),
    );
    expect(
      await screen.findByText(/The verification code was not accepted/iu),
    ).toBeInTheDocument();
  });
});

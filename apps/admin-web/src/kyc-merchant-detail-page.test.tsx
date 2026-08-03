import axe from 'axe-core';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import { kycOpsBranchId, kycOpsMarketA } from './test/kyc-fixtures.js';
import { mockKycOpsApi } from './test/kyc-mock.js';

const DETAIL_URL = `/admin/${kycOpsMarketA}/kyc/merchants/${kycOpsBranchId}`;

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

describe('P7-S5C merchant KYC detail page', () => {
  it('renders the masked submission snapshot and review actions', async () => {
    mockKycOpsApi(['merchant.kyc.view', 'merchant.kyc.approve']);
    await signIn();
    await screen.findByRole('heading', { name: 'Acme Sdn Bhd' });

    // Owner-masked fields.
    expect(await screen.findByText('***2345')).toBeInTheDocument();
    expect(screen.getByText('***7890')).toBeInTheDocument();
    expect(
      screen.getByText(
        (content: string) =>
          content.includes('nric') && content.includes('****1234'),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('***789')).toBeInTheDocument();
    // Business name and PIC name stay visible (owner mask rule).
    expect(screen.getAllByText('Acme Sdn Bhd').length).toBeGreaterThan(0);
    expect(screen.getByText('Jane Mildred Doe')).toBeInTheDocument();
    // Masked summary never reveals the full registration number.
    expect(screen.queryByText('202001012345')).not.toBeInTheDocument();
    // Review actions are available.
    expect(
      screen.getByRole('button', { name: 'Approve submission' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Request resubmission' }),
    ).toBeInTheDocument();
  });

  it('locks raw evidence without the merchant evidence permission', async () => {
    mockKycOpsApi(['merchant.kyc.view']);
    await signIn();
    await screen.findByRole('heading', { name: 'Acme Sdn Bhd' });
    expect(
      await screen.findByText(/Raw evidence is locked/iu),
    ).toBeInTheDocument();
  });

  it('shows full evidence after reason + step-up', async () => {
    mockKycOpsApi(['merchant.kyc.view', 'merchant.kyc.evidence.view']);
    await signIn();
    await screen.findByRole('heading', { name: 'Acme Sdn Bhd' });

    await userEvent.click(
      screen.getByRole('button', { name: 'View sensitive evidence' }),
    );
    const reason = screen.getByLabelText(/Reason for viewing evidence/iu);
    await userEvent.type(reason, 'Business verification review');
    await userEvent.click(
      screen.getByRole('button', { name: 'View sensitive evidence' }),
    );
    const code = await screen.findByLabelText('MFA verification code');
    await userEvent.type(code, '123456');
    await userEvent.click(
      screen.getByRole('button', { name: 'Verify and view evidence' }),
    );
    expect(await screen.findByText('202001012345')).toBeInTheDocument();
    expect(screen.getByText('Full evidence shown')).toBeInTheDocument();
  });

  it('executes a review decision and refreshes the submission state', async () => {
    mockKycOpsApi(['merchant.kyc.view', 'merchant.kyc.approve']);
    await signIn();
    await screen.findByRole('heading', { name: 'Acme Sdn Bhd' });

    await userEvent.click(
      screen.getByRole('button', { name: 'Approve submission' }),
    );
    const reason = await screen.findByLabelText(
      'Reason (required, server-recorded)',
    );
    await userEvent.type(reason, 'Business and identity documents verified');
    await userEvent.click(
      screen.getByRole('button', { name: 'Approve submission' }),
    );
    expect(
      await screen.findByText(/Approve submission completed/iu),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
  });

  it('requires rejected fields for a resubmission decision', async () => {
    mockKycOpsApi(['merchant.kyc.view', 'merchant.kyc.approve']);
    await signIn();
    await screen.findByRole('heading', { name: 'Acme Sdn Bhd' });

    await userEvent.click(
      screen.getByRole('button', { name: 'Request resubmission' }),
    );
    const reason = await screen.findByLabelText(
      'Reason (required, server-recorded)',
    );
    await userEvent.type(reason, 'Documents need updates');
    const submit = screen.getByRole('button', {
      name: 'Request resubmission',
    });
    expect(submit).toBeDisabled(); // rejected fields still empty

    const fields = screen.getByLabelText(
      'Rejected fields (comma separated, at least one required)',
    );
    await userEvent.type(fields, 'pic_identity.identity_number');
    expect(submit).toBeEnabled();
  });

  it('renders error and conflict states', async () => {
    mockKycOpsApi({
      permissions: ['merchant.kyc.view'],
      merchantDetailFails: { status: 409, code: 'MARKET_CONTEXT_MISMATCH' },
    });
    await signIn();
    expect(
      await screen.findByText('KYC case is outside the selected market'),
    ).toBeInTheDocument();
  });

  it('has zero serious or critical axe violations on the loaded detail', async () => {
    mockKycOpsApi(['merchant.kyc.view', 'merchant.kyc.approve']);
    await signIn();
    await screen.findByRole('heading', { name: 'Acme Sdn Bhd' });
    await screen.findByText('***2345');
    const results = await axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(serious).toHaveLength(0);
  });
});

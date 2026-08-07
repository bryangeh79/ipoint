import axe from 'axe-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import {
  P7S9_ENTRY_ID,
  P7S9_MARKET_ID,
  maskedAuditEntryFixture,
  mockP7S9OpsApi,
} from './test/p7-s9-ops-mock.js';

const AUDIT_URL = `/admin/${P7S9_MARKET_ID}/audit`;

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

afterEach(() => {
  cleanup();
});

async function signIn(url: string) {
  render(<AdminApp router={createAdminMemoryRouter([url])} />);
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

describe('P7-S9 audit viewer page', () => {
  it('renders the masked audit list with masked evidence and no raw fields', async () => {
    mockP7S9OpsApi();
    await signIn(AUDIT_URL);

    await screen.findByRole('heading', { name: 'Audit viewer' });
    expect(screen.getByTestId('audit-total')).toHaveTextContent(
      '1 audit entry',
    );
    expect(screen.getByText('REDEMPTION_REFUND_APPROVE')).toBeInTheDocument();
    expect(screen.getByTestId('audit-result-SUCCESS')).toHaveTextContent(
      'Success',
    );

    // Expand the row: masked evidence only (identity masked, token redacted).
    fireEvent.click(screen.getByTestId(`audit-row-${P7S9_ENTRY_ID}`));
    await screen.findByTestId('audit-entry-detail');
    const evidenceBlocks = screen.getAllByTestId('masked-evidence');
    const evidenceText = evidenceBlocks
      .map((block) => block.textContent)
      .join('\n');
    expect(evidenceText).toContain('[MASKED]');
    expect(evidenceText).toContain('[REDACTED]');
    expect(evidenceText).not.toContain('800101-14-5678');
    expect(evidenceText).not.toContain('203.0.113.9');
  });

  it('passes filters and free-text search to the adapter', async () => {
    mockP7S9OpsApi();
    await signIn(AUDIT_URL);
    await screen.findByRole('heading', { name: 'Audit viewer' });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fireEvent.change(await screen.findByLabelText('Search'), {
      target: { value: 'refund' },
    });
    fireEvent.change(await screen.findByLabelText('Result'), {
      target: { value: 'SUCCESS' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const calls = fetchSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((callUrl) => callUrl.includes('/admin/audit-ops/'));
    expect(calls.length).toBeGreaterThan(0);
    const last = calls[calls.length - 1] ?? '';
    expect(last).toContain('q=refund');
    expect(last).toContain('result=SUCCESS');
  });

  it('locks raw evidence for roles without audit.sensitive-diff.view (Support)', async () => {
    mockP7S9OpsApi({ permissions: ['audit.read', 'report.read'] });
    await signIn(AUDIT_URL);
    await screen.findByRole('heading', { name: 'Audit viewer' });

    fireEvent.click(screen.getByTestId(`audit-row-${P7S9_ENTRY_ID}`));
    await screen.findByTestId('raw-locked');
    expect(screen.getByText(/Raw evidence is locked/i)).toBeInTheDocument();
    expect(screen.queryByTestId('raw-open')).not.toBeInTheDocument();
  });

  it('shows the raw evidence flow with a recorded reason (super admin)', async () => {
    mockP7S9OpsApi();
    await signIn(AUDIT_URL);
    await screen.findByRole('heading', { name: 'Audit viewer' });

    fireEvent.click(screen.getByTestId(`audit-row-${P7S9_ENTRY_ID}`));
    await screen.findByTestId('raw-open');
    fireEvent.click(screen.getByTestId('raw-open'));

    const reasonBox = await screen.findByLabelText(
      /Reason for viewing raw evidence/i,
    );
    fireEvent.change(reasonBox, {
      target: { value: 'Refund approval evidence review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'View raw evidence' }));

    await screen.findByTestId('raw-evidence');
    expect(screen.getByTestId('raw-evidence').textContent).toContain(
      '800101-14-5678',
    );
    expect(screen.getByTestId('raw-evidence').textContent).toContain(
      '203.0.113.9',
    );
    expect(
      screen.getByText(/Every sensitive view is server-audited/i),
    ).toBeInTheDocument();
  });

  it('runs the MFA step-up flow when the raw view demands a fresh grant', async () => {
    // The RbacGuard returns MFA_STEP_UP_REQUIRED as 403 (not 401), so the
    // api-client does not attempt a session refresh; the page runs the
    // step-up challenge/verify flow and retries with the fresh grant.
    mockP7S9OpsApi({ rawStatus: 403 });
    await signIn(AUDIT_URL);
    await screen.findByRole('heading', { name: 'Audit viewer' });

    fireEvent.click(screen.getByTestId(`audit-row-${P7S9_ENTRY_ID}`));
    await screen.findByTestId('raw-open');
    fireEvent.click(screen.getByTestId('raw-open'));

    const reasonBox = await screen.findByLabelText(
      /Reason for viewing raw evidence/i,
    );
    fireEvent.change(reasonBox, {
      target: { value: 'Refund approval evidence review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'View raw evidence' }));

    await screen.findByTestId('raw-stepup');
    fireEvent.change(await screen.findByLabelText('MFA verification code'), {
      target: { value: '123456' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Verify and view raw evidence' }),
    );

    await screen.findByTestId('raw-evidence');
    expect(screen.getByTestId('raw-evidence').textContent).toContain(
      '800101-14-5678',
    );
  });

  it('is accessible (axe-clean)', async () => {
    mockP7S9OpsApi();
    await signIn(AUDIT_URL);
    await screen.findByRole('heading', { name: 'Audit viewer' });
    const results = await axe.run(document.body);
    expect(results.violations).toHaveLength(0);
  });
});

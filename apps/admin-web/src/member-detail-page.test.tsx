import axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import { memberOpsProfileFixture } from './test/member-ops-fixtures.js';
import { mockMemberOpsApi } from './test/member-ops-mock.js';

const MARKET = '11111111-1111-4111-8111-111111111111';
const DETAIL_URL = `/admin/${MARKET}/members/mem_public_1`;

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

async function signIn() {
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

async function openDetail() {
  render(<AdminApp router={createAdminMemoryRouter([DETAIL_URL])} />);
  await signIn();
  await screen.findByRole('heading', { name: 'mem_public_1' });
}

describe('P7-S5A member detail page', () => {
  it('renders the masked profile summary, status history, and notes', async () => {
    mockMemberOpsApi(['member.read']);
    await openDetail();

    // Masked fields only.
    expect(screen.getByText('j***@example.com')).toBeInTheDocument();
    expect(screen.getByText('J*** M****** D**')).toBeInTheDocument();
    expect(screen.getByText('********6789')).toBeInTheDocument();
    expect(screen.queryByText('jane@example.com')).not.toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'Profile summary (masked)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Status history' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByText('Follow up on KYC documents.')).toBeInTheDocument();
    expect(screen.getByText('PENDING_EMAIL_VERIFICATION')).toBeInTheDocument();
  });

  it('shows a suspended notice and limited actions for a suspended member', async () => {
    mockMemberOpsApi({
      permissions: ['member.read', 'member.status.manage'],
      initialProfile: memberOpsProfileFixture({ status: 'SUSPENDED' }),
    });
    await openDetail();

    expect(screen.getByRole('status').textContent).toMatch(
      /this member is suspended/iu,
    );
    expect(
      screen.getByRole('button', { name: 'Reactivate member' }),
    ).toBeInTheDocument();
    // Suspend is not valid for a suspended member: explicit unavailable state.
    expect(screen.getByText(/Suspend member/)).toBeInTheDocument();
    expect(screen.getByText(/member status SUSPENDED/)).toBeInTheDocument();
  });

  it('shows a closed notice with no status actions for a closed member', async () => {
    mockMemberOpsApi({
      permissions: ['member.read', 'member.status.manage'],
      initialProfile: memberOpsProfileFixture({ status: 'CLOSED' }),
    });
    await openDetail();

    expect(screen.getByRole('status').textContent).toMatch(
      /this member is closed/iu,
    );
    expect(
      screen.getByText('No status action is available for a closed member.'),
    ).toBeInTheDocument();
  });

  it('marks actions unavailable without the server permission', async () => {
    mockMemberOpsApi({
      permissions: ['member.read'],
    });
    await openDetail();

    expect(screen.getAllByText(/server permission/).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: 'Suspend member' }),
    ).not.toBeInTheDocument();
  });

  it('gates reverification on an approved KYC case', async () => {
    mockMemberOpsApi({
      permissions: ['member.read', 'member.reverification.require'],
      initialProfile: memberOpsProfileFixture({
        kyc: null,
      }),
    });
    await openDetail();

    expect(
      screen.getByText(/No KYC case exists for this member/),
    ).toBeInTheDocument();
  });

  it('suspends with reason and idempotency key, then shows the confirmed status', async () => {
    const mock = mockMemberOpsApi(['member.read', 'member.status.manage']);
    await openDetail();

    await userEvent.click(
      screen.getByRole('button', { name: 'Suspend member' }),
    );
    const reason = await screen.findByLabelText(/Reason \(required/);
    await userEvent.type(reason, 'Suspension review');
    await userEvent.click(
      screen.getByRole('button', { name: 'Suspend member' }),
    );

    await waitFor(() => expect(mock.getProfile().status).toBe('SUSPENDED'));
    expect(
      await screen.findByText(/Suspend member completed/iu),
    ).toBeInTheDocument();
    // Body carries reason + idempotency key.
    const suspendCall = mock.fetchSpy.mock.calls.find(([url]) =>
      String(url).endsWith('/suspend'),
    );
    const body = JSON.parse(String(suspendCall?.[1]?.body)) as {
      reason: string;
      idempotencyKey: string;
    };
    expect(body.reason).toBe('Suspension review');
    expect(body.idempotencyKey).toBeTruthy();
  });

  it('requires the exact CONFIRM text before closing', async () => {
    const mock = mockMemberOpsApi(['member.read', 'member.status.manage']);
    await openDetail();

    await userEvent.click(screen.getByRole('button', { name: 'Close member' }));
    await userEvent.type(
      await screen.findByLabelText(/Reason \(required/),
      'Governed closure',
    );
    const confirm = screen.getByLabelText(/Type CONFIRM to close/);
    await userEvent.type(confirm, 'NOPE');
    const submit = screen.getByRole('button', { name: 'Close member' });
    expect(submit).toBeDisabled();
    await userEvent.clear(confirm);
    await userEvent.type(confirm, 'CONFIRM');
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() => expect(mock.getProfile().status).toBe('CLOSED'));
    expect(
      await screen.findByText(/Close member completed/iu),
    ).toBeInTheDocument();
  });

  it('adds a note and refreshes the notes list from the server', async () => {
    const mock = mockMemberOpsApi(['member.read', 'member.note.create']);
    await openDetail();

    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await userEvent.type(
      await screen.findByLabelText(/Note content/),
      'Escalate to operations.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() =>
      expect(
        mock
          .getProfile()
          .notes.some((note) => note.content === 'Escalate to operations.'),
      ).toBe(true),
    );
    expect(
      await screen.findByText('Escalate to operations.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Note added/iu)).toBeInTheDocument();
  });

  it('renders an explicit conflict state for a stale/conflict detail', async () => {
    mockMemberOpsApi({
      permissions: ['member.read'],
      detailFails: {
        status: 409,
        code: 'ADMIN_MEMBER_INVALID_STATUS',
      },
    });
    render(<AdminApp router={createAdminMemoryRouter([DETAIL_URL])} />);
    await signIn();
    expect(
      await screen.findByText('Member status conflict'),
    ).toBeInTheDocument();
  });

  it('renders permission denied for a denied detail', async () => {
    mockMemberOpsApi({
      permissions: ['member.read'],
      detailFails: { status: 403, code: 'PERMISSION_DENIED' },
    });
    render(<AdminApp router={createAdminMemoryRouter([DETAIL_URL])} />);
    await signIn();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
  });

  it('has no serious or critical axe violations on the loaded detail', async () => {
    mockMemberOpsApi(['member.read', 'member.status.manage']);
    await openDetail();
    await screen.findByRole('heading', { name: 'Notes' });
    const results = await axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    const violations = results.violations.filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(violations).toEqual([]);
  });
});

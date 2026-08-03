import axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import { memberOpsListPageFixture } from './test/member-ops-fixtures.js';
import { mockMemberOpsApi } from './test/member-ops-mock.js';

const MEMBERS_URL = '/admin/11111111-1111-4111-8111-111111111111/members';

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

async function signInAndOpenMembers() {
  render(<AdminApp router={createAdminMemoryRouter([MEMBERS_URL])} />);
  await signIn();
  await screen.findByRole('heading', { name: 'Members' });
}

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

describe('P7-S5A member list page', () => {
  it('renders masked member rows with statuses and market summary', async () => {
    mockMemberOpsApi(['member.read']);
    await signInAndOpenMembers();

    expect(
      await screen.findByText(/3 members in the selected market/iu),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /mem_public_1/ })).toHaveAttribute(
      'href',
      `/admin/${memberOpsListPageFixture().marketId}/members/mem_public_1`,
    );
    // Masked emails only.
    expect(screen.getByText(/j\*\*\*@example\.com/)).toBeInTheDocument();
    expect(screen.getAllByText('Suspended').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0);
    expect(screen.queryByText('jane@example.com')).not.toBeInTheDocument();
  });

  it('filters by status and searches on Enter', async () => {
    const mock = mockMemberOpsApi(['member.read']);
    await signInAndOpenMembers();

    fireEvent.change(await screen.findByLabelText('Status'), {
      target: { value: 'SUSPENDED' },
    });
    await waitFor(() =>
      expect(
        mock.fetchSpy.mock.calls.some(([url]) =>
          String(url).includes('status=SUSPENDED'),
        ),
      ).toBe(true),
    );

    const search = screen.getByLabelText('Search members');
    fireEvent.change(search, { target: { value: 'mem_public_2' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() =>
      expect(
        mock.fetchSpy.mock.calls.some(([url]) =>
          String(url).includes('query=mem_public_2'),
        ),
      ).toBe(true),
    );
    // The adapter never receives a market query parameter.
    for (const [url] of mock.fetchSpy.mock.calls) {
      const value = String(url);
      if (value.includes('/admin/member-ops/members')) {
        expect(value).not.toMatch(/[?&]market/);
      }
    }
  });

  it('renders the empty state when the server returns no members', async () => {
    mockMemberOpsApi({
      permissions: ['member.read'],
      listBody: {
        marketId: memberOpsListPageFixture().marketId,
        members: [],
        total: 0,
        page: 1,
        pageSize: 20,
      },
    });
    await signInAndOpenMembers();
    expect(await screen.findByText('No members found')).toBeInTheDocument();
    expect(screen.getByText(/no matching members/iu)).toBeInTheDocument();
  });

  it('renders an explicit conflict state for a market context mismatch', async () => {
    mockMemberOpsApi({
      permissions: ['member.read'],
      listFails: { status: 409, code: 'MARKET_CONTEXT_MISMATCH' },
    });
    await signInAndOpenMembers();
    expect(
      await screen.findByText('Member is outside the selected market'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/server-bound Current Admin Market changed/iu),
    ).toBeInTheDocument();
  });

  it('renders permission denied when the server denies member.read', async () => {
    mockMemberOpsApi({
      permissions: ['dashboard.view'],
      listFails: { status: 403, code: 'PERMISSION_DENIED' },
    });
    render(<AdminApp router={createAdminMemoryRouter([MEMBERS_URL])} />);
    await signIn();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
  });

  it('has no serious or critical axe violations on the loaded member list', async () => {
    mockMemberOpsApi(['member.read']);
    await signInAndOpenMembers();
    await screen.findByText(/3 members in the selected market/iu);
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

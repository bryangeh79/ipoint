// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MerchantApp } from './merchant-app';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  preview: vi.fn(),
  confirm: vi.fn(),
  api: {
    tokens: {
      accessToken: 'test-token',
      accessExpiresAt: '2099-01-01T00:00:00.000Z',
      refreshExpiresAt: '2099-01-01T00:00:00.000Z',
    },
    request: vi.fn(),
    login: vi.fn(),
    clearSession: vi.fn(),
    attemptSessionRestore: vi.fn(),
  },
}));

vi.mock('./api/client', () => ({
  api: mocks.api,
  merchantTransactionApi: {
    list: mocks.list,
    detail: mocks.detail,
    preview: mocks.preview,
    confirm: mocks.confirm,
  },
}));

const listMock = mocks.list as ReturnType<typeof vi.fn>;
const requestMock = mocks.api.request as ReturnType<typeof vi.fn>;

function createStorageMock() {
  let storage: Record<string, string> = {};
  return {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      storage = {};
    },
    length: 0,
    key: () => null,
  };
}

describe('MerchantApp navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const storage = createStorageMock();
    vi.stubGlobal('localStorage', storage);
    storage.setItem(
      'ipoint.merchant.context',
      JSON.stringify({ branchId: 'branch-1', marketId: 'market-1' }),
    );
    listMock.mockResolvedValue({ items: [], nextCursor: null });
    // Overview is the default page; give it minimal live data so the
    // default render does not crash.
    requestMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/profile')) {
        return { display_name: 'Branch 1' };
      }
      if (path.endsWith('/application')) {
        return { status: 'PENDING' };
      }
      if (path.endsWith('/kyc')) {
        return { status: 'NOT_STARTED' };
      }
      if (path.endsWith('/packages')) {
        return { items: [] };
      }
      return { available_balance: '0' };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows Transactions in both the side and bottom navigation', () => {
    render(<MerchantApp />);
    // The mobile bottom nav is display:none on desktop widths, so its
    // links are not role-visible; assert membership via text (both the
    // side nav link and the bottom nav link render the label).
    expect(screen.getAllByText('Transactions')).toHaveLength(2);
    const side = screen.getByRole('navigation', {
      name: 'Merchant navigation',
    });
    expect(within(side).getByText('Transactions')).toBeInTheDocument();
  });

  it('navigates to the Transactions page and loads history', async () => {
    const user = userEvent.setup();
    render(<MerchantApp />);
    const side = screen.getByRole('navigation', {
      name: 'Merchant navigation',
    });
    await user.click(within(side).getByText('Transactions'));
    expect(await screen.findByText('No transactions yet')).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith({ limit: 20 });
  });
});

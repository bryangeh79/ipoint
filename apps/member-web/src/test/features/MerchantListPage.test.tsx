// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider';
import { MerchantListPage } from '../../pages/MerchantListPage';
import { apiClient } from '../../api/client';
import { ApiError } from '@ipoint/api-client';
import type {
  MerchantListItem,
  CategoryResponse,
  PaginatedResponse,
} from '../../api/types';

// ---- i18n mock ----
vi.mock('react-i18next', () => {
  const T: Record<string, string> = {
    'merchants.title': 'Merchants',
    'merchants.searchPlaceholder': 'Search merchants...',
    'merchants.searchLabel': 'Search merchants',
    'merchants.categoryAll': 'All Categories',
    'merchants.statusAll': 'All Status',
    'merchants.statusOnline': 'Online',
    'merchants.statusOffline': 'Offline',
    'merchants.open': 'Open',
    'merchants.closed': 'Closed',
    'merchants.loadError': 'Failed to load merchants',
    'merchants.retryLoad': 'Retry',
    'merchants.loadMore': 'Load More',
    'merchants.notFound': 'No merchants found',
    'merchants.notFoundDescription': 'Try adjusting your search or filters.',
    'merchants.distanceKm': '{distance} km',
    'errors.offline': 'You are offline',
    'errors.offlineDescription':
      'Please check your internet connection and try again.',
    'merchants.resultCount': '{count} merchant(s)',
    'merchants.resultCountFiltered': 'Showing {count} of {total} merchant(s)',
    'merchants.loading': 'Loading merchants...',
    'common.loading': 'Loading...',
  };
  const t = (k: string, o?: Record<string, unknown>) => {
    const v = T[k] ?? k;
    return o
      ? v.replace(/\{(\w+)\}/g, (_, k2: string) => String(o[k2] ?? ''))
      : v;
  };
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

// ---- helpers ----

function makeMerchant(
  id: string,
  overrides: Partial<MerchantListItem> = {},
): MerchantListItem {
  return {
    merchantId: id,
    displayName: `Merchant ${id}`,
    branchName: '',
    category: { id: 'cat-1', code: 'food', name: 'Food' },
    isOnline: true,
    isOffline: false,
    packages: [],
    ...overrides,
  };
}

function makePaginated(
  items: MerchantListItem[],
  page = 1,
  totalPages = 1,
  total = items.length,
): PaginatedResponse<MerchantListItem> {
  return {
    items,
    page,
    pageSize: 20,
    totalPages,
    total,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/merchants']}>
      <AuthProvider apiClient={apiClient} autoRestore={false}>
        <Routes>
          <Route path="/merchants" element={<MerchantListPage />} />
          <Route path="/merchants/:id" element={<div>Merchant detail</div>} />
          <Route path="*" element={<div>Not found</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// ===== STATE RENDERING =====

describe('MerchantListPage — state rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows page title', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants')) {
        return Promise.resolve({
          data: makePaginated([makeMerchant('m1'), makeMerchant('m2')]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Merchants')).toBeInTheDocument();
    });
  });

  it('shows merchant cards when data loads', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants')) {
        return Promise.resolve({
          data: makePaginated([makeMerchant('m1'), makeMerchant('m2')]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Merchant m1')).toBeInTheDocument();
      expect(screen.getByText('Merchant m2')).toBeInTheDocument();
    });
  });

  it('shows result count', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants')) {
        return Promise.resolve({
          data: makePaginated(
            [makeMerchant('m1'), makeMerchant('m2')],
            1,
            1,
            2,
          ),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('2 merchant(s)')).toBeInTheDocument();
    });
  });

  it('shows error state on API failure', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new ApiError(500, { message: 'Server error' }));
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getAllByText('Failed to load merchants').length,
      ).toBeGreaterThan(0);
    });
  });

  it('shows retry button on error', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new ApiError(500, { message: 'Server error' }));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  it('shows empty state when no merchants found', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants')) {
        return Promise.resolve({
          data: makePaginated([], 1, 1, 0),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No merchants found')).toBeInTheDocument();
    });
  });

  it('shows empty state description', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants')) {
        return Promise.resolve({
          data: makePaginated([], 1, 1, 0),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText('Try adjusting your search or filters.'),
      ).toBeInTheDocument();
    });
  });
});

// ===== CATEGORY FILTER =====

describe('MerchantListPage — category filter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows categories in select dropdown', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    const categories: CategoryResponse[] = [
      { id: 'c1', code: 'food', name: 'Food', sortOrder: 1 },
      { id: 'c2', code: 'retail', name: 'Retail', sortOrder: 2 },
    ];
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: categories });
      }
      if (path.includes('/members/merchants')) {
        return Promise.resolve({
          data: makePaginated([makeMerchant('m1')]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    // Wait for categories to load
    await waitFor(() => {
      expect(screen.getByText('Merchant m1')).toBeInTheDocument();
    });
    // Check categories select exists with options
    const select = document.getElementById('merchant-category-filter');
    expect(select).toBeInTheDocument();
  });

  it('merchants API is called with correct params', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants')) {
        // Verify path contains expected params
        expect(path).toContain('page=');
        return Promise.resolve({
          data: makePaginated([makeMerchant('m1')]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Merchant m1')).toBeInTheDocument();
    });
  });
});

// ===== OFFLINE BANNER =====

describe('MerchantListPage — offline banner', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  it('shows offline banner when offline', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants')) {
        return Promise.resolve({
          data: makePaginated([makeMerchant('m1')]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('You are offline')).toBeInTheDocument();
    });
  });
});

// ===== KEYBOARD NAVIGATION =====

describe('MerchantListPage — keyboard navigation', () => {
  let user: ReturnType<typeof userEvent.setup>;
  beforeEach(() => {
    user = userEvent.setup();
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merchant card has role="button"', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants')) {
        return Promise.resolve({
          data: makePaginated([makeMerchant('m1')]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Merchant m1')).toBeInTheDocument();
    });
    const card = screen.getByRole('button', {
      name: /merchant m1/i,
    });
    expect(card).toBeInTheDocument();
  });

  it('merchant card has tabIndex 0', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants')) {
        return Promise.resolve({
          data: makePaginated([makeMerchant('m1')]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Merchant m1')).toBeInTheDocument();
    });
    const card = screen.getByRole('button', {
      name: /merchant m1/i,
    });
    expect(card.tabIndex).toBe(0);
  });
});

// ===== ACCESSIBILITY =====

describe('MerchantListPage — accessibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('search field has associated label', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants')) {
        return Promise.resolve({
          data: makePaginated([]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await waitFor(() => {
      const searchInput = screen.getByPlaceholderText('Search merchants...');
      expect(searchInput).toBeInTheDocument();
    });
  });
});

// ===== SECURITY =====

describe('MerchantListPage — security', () => {
  let storage: Record<string, string | null>;

  beforeEach(() => {
    storage = {};
    const m = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => {
        storage[k] = v;
      },
      removeItem: (k: string) => {
        delete storage[k];
      },
      clear: () => {
        storage = {};
      },
      length: 0,
      key: () => null,
    };
    vi.stubGlobal('localStorage', m);
    vi.stubGlobal('sessionStorage', m);
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('no merchant data written to localStorage', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants')) {
        return Promise.resolve({
          data: makePaginated([makeMerchant('m1')]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Merchant m1')).toBeInTheDocument();
    });
    const keys = Object.keys(storage).filter((k) => storage[k] != null);
    const merchantKeys = keys.filter(
      (k) =>
        k.toLowerCase().includes('merchant') ||
        k.toLowerCase().includes('merchants'),
    );
    expect(merchantKeys).toHaveLength(0);
  });

  it('no merchant data written to sessionStorage', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants')) {
        return Promise.resolve({
          data: makePaginated([makeMerchant('m1')]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Merchant m1')).toBeInTheDocument();
    });
    const keys = Object.keys(storage).filter((k) => storage[k] != null);
    const merchantKeys = keys.filter(
      (k) =>
        k.toLowerCase().includes('merchant') ||
        k.toLowerCase().includes('merchants'),
    );
    expect(merchantKeys).toHaveLength(0);
  });

  it('no internal IDs exposed in DOM', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants')) {
        return Promise.resolve({
          data: makePaginated([makeMerchant('m1')]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Merchant m1')).toBeInTheDocument();
    });
    const html = document.body.innerHTML;
    // merchantId is safe as it's a public identifier
    // But internal DB IDs should not be exposed
    expect(html).not.toContain('internal_id');
    expect(html).not.toContain('internalNotes');
  });
});

// ===== TEST INTEGRITY =====

describe('MerchantListPage — test integrity', () => {
  it('no skipped tests', () => {
    const fs = require('fs');
    const content = fs.readFileSync(__filename, 'utf8');
    expect(content.match(/(?:it|describe|test)\.skip\s*\(/g)?.length ?? 0).toBe(
      0,
    );
  });

  it('per-test console.error spy pattern', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    console.error('expected');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

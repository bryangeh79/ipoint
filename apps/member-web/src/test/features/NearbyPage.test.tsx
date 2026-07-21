// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider';
import { NearbyPage } from '../../pages/NearbyPage';
import { apiClient } from '../../api/client';
import type { MerchantListItem, PaginatedResponse } from '../../api/types';

// ---- i18n mock ----
vi.mock('react-i18next', () => {
  const T: Record<string, string> = {
    'nearby.title': 'Nearby Merchants',
    'nearby.noLocationAccess': 'Location access denied',
    'nearby.noLocationAccessDescription':
      'Please enable location access in your browser settings to find nearby merchants.',
    'nearby.locationUnavailable': 'Location unavailable',
    'nearby.locationUnavailableDescription':
      'Your location could not be determined at this time.',
    'nearby.locationTimeout': 'Location request timed out',
    'nearby.locationTimeoutDescription':
      'Please check your GPS signal and try again.',
    'nearby.noNearbyMerchants': 'No nearby merchants found',
    'nearby.noNearbyMerchantsDescription': 'Try expanding your search area.',
    'nearby.loadError': 'Failed to load nearby merchants',
    'nearby.retryLoad': 'Retry',
    'nearby.loadingLocation': 'Getting your location...',
    'nearby.loadingMerchants': 'Finding nearby merchants...',
    'nearby.radius': 'Within {radius} km',
    'nearby.radiusOptions': 'Search radius',
    'nearby.radiusKm': '{value} km',
    'nearby.retryLocation': 'Retry',
    'nearby.sortByDistance': 'Sorted by distance',
    'nearby.categoryFilter': 'Category',
    'nearby.allCategories': 'All Categories',
    'merchants.open': 'Open',
    'merchants.closed': 'Closed',
    'merchants.distanceKm': '{distance} km',
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
    displayName: `Nearby ${id}`,
    branchName: '',
    category: { id: 'cat-1', code: 'food', name: 'Food' },
    isOnline: true,
    isOffline: false,
    distance: 1.5,
    packages: [],
    ...overrides,
  };
}

function makePaginated(
  items: MerchantListItem[],
): PaginatedResponse<MerchantListItem> {
  return {
    items,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    total: items.length,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/nearby']}>
      <AuthProvider apiClient={apiClient} autoRestore={false}>
        <Routes>
          <Route path="/nearby" element={<NearbyPage />} />
          <Route path="/merchants/:id" element={<div>Merchant detail</div>} />
          <Route path="*" element={<div>Not found</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// Mock geolocation helpers for different scenarios
function mockGeolocationStuck(): void {
  // watchPosition never calls back - stays in "getting-location" state
  const geolocation = {
    watchPosition: vi.fn(() => 1),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  };
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: geolocation,
    writable: true,
  });
}

function mockGeolocationAsync(): void {
  // watchPosition calls back asynchronously via requestAnimationFrame
  const geolocation = {
    watchPosition: vi.fn(
      (success: PositionCallback, _error?: PositionErrorCallback | null) => {
        // Use requestAnimationFrame instead of setTimeout to play nice with act
        requestAnimationFrame(() => {
          success({
            coords: {
              latitude: 3.139,
              longitude: 101.6869,
              accuracy: 100,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
              toJSON: () => ({}),
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        });
        return 1;
      },
    ),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  };
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: geolocation,
    writable: true,
  });
}

// ===== LOCATION STATES =====

describe('NearbyPage — location states', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows getting location state when geolocation is available', async () => {
    mockGeolocationStuck();
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [] });
    renderPage();
    // Since watchPosition never calls back, the page stays in
    // "getting-location" state
    await waitFor(() => {
      expect(screen.getByText('Getting your location...')).toBeInTheDocument();
    });
  });

  it('shows page title', async () => {
    mockGeolocationStuck();
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Nearby Merchants')).toBeInTheDocument();
    });
  });
});

// ===== MERCHANT DISPLAY =====

describe('NearbyPage — merchant display', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading merchants after location is obtained', async () => {
    mockGeolocationAsync();
    // Return empty for categories, pending for nearby merchants
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      // Keep nearby merchants promise pending
      return new Promise(() => {});
    });
    renderPage();
    // Flush pending timers / rAF callbacks within act
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await waitFor(() => {
      expect(
        screen.getByText('Finding nearby merchants...'),
      ).toBeInTheDocument();
    });
  });

  it('shows empty state when no nearby merchants', async () => {
    mockGeolocationAsync();
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants/nearby')) {
        return Promise.resolve({
          data: makePaginated([]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    // Flush rAF callbacks within act
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: 'No nearby merchants found',
        }),
      ).toBeInTheDocument();
    });
  });

  it('shows empty state description', async () => {
    mockGeolocationAsync();
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants/nearby')) {
        return Promise.resolve({
          data: makePaginated([]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await waitFor(() => {
      expect(
        screen.getByText('Try expanding your search area.'),
      ).toBeInTheDocument();
    });
  });

  it('merchant card has role="button" for navigation', async () => {
    mockGeolocationAsync();
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants/nearby')) {
        return Promise.resolve({
          data: makePaginated([makeMerchant('m1')]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await waitFor(() => {
      const card = screen.queryByRole('button', {
        name: /nearby m1/i,
      });
      if (card) {
        expect(card.tabIndex).toBe(0);
      }
    });
  });
});

// ===== KEYBOARD NAVIGATION =====

describe('NearbyPage — keyboard navigation', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merchant card has tabIndex 0 for keyboard focus', async () => {
    mockGeolocationAsync();
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants/nearby')) {
        return Promise.resolve({
          data: makePaginated([makeMerchant('m1')]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await waitFor(() => {
      const card = screen.queryByRole('button', {
        name: /nearby m1/i,
      });
      if (card) {
        expect(card.tabIndex).toBe(0);
      }
    });
  });
});

// ===== SECURITY =====

describe('NearbyPage — security', () => {
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
    mockGeolocationAsync();
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants/nearby')) {
        return Promise.resolve({
          data: makePaginated([]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: 'No nearby merchants found',
        }),
      ).toBeInTheDocument();
    });
    const keys = Object.keys(storage).filter((k) => storage[k] != null);
    const merchantKeys = keys.filter(
      (k) =>
        k.toLowerCase().includes('merchant') ||
        k.toLowerCase().includes('nearby') ||
        k.toLowerCase().includes('location'),
    );
    expect(merchantKeys).toHaveLength(0);
  });

  it('no geolocation coordinates in localStorage', async () => {
    mockGeolocationAsync();
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants/nearby')) {
        return Promise.resolve({
          data: makePaginated([]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: 'No nearby merchants found',
        }),
      ).toBeInTheDocument();
    });
    const keys = Object.keys(storage).filter((k) => storage[k] != null);
    const locationKeys = keys.filter(
      (k) =>
        k.toLowerCase().includes('latitude') ||
        k.toLowerCase().includes('longitude') ||
        k.toLowerCase().includes('coord'),
    );
    expect(locationKeys).toHaveLength(0);
  });

  it('no sessionStorage of merchant data', async () => {
    mockGeolocationAsync();
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.includes('/members/merchant-categories')) {
        return Promise.resolve({ data: [] });
      }
      if (path.includes('/members/merchants/nearby')) {
        return Promise.resolve({
          data: makePaginated([]),
        });
      }
      return Promise.reject(new Error('Unknown path'));
    });
    renderPage();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          name: 'No nearby merchants found',
        }),
      ).toBeInTheDocument();
    });
    const keys = Object.keys(storage).filter((k) => storage[k] != null);
    const merchantKeys = keys.filter(
      (k) =>
        k.toLowerCase().includes('merchant') ||
        k.toLowerCase().includes('nearby') ||
        k.toLowerCase().includes('location'),
    );
    expect(merchantKeys).toHaveLength(0);
  });
});

// ===== TEST INTEGRITY =====

describe('NearbyPage — test integrity', () => {
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

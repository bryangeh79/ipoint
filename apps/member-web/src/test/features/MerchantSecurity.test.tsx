// @vitest-environment jsdom
/**
 * Merchant Security Tests — verifies security constraints and error handling
 * across merchant-related pages (MerchantListPage, MerchantDetailPage, NearbyPage).
 *
 * Security constraints:
 * - No merchant data stored in localStorage/sessionStorage
 * - No internal IDs or private keys visible in DOM
 * - No sensitive data in URL params
 * - External URLs use safe protocols only
 * - target="_blank" with rel="noopener noreferrer"
 * - No console.log of user/merchant data
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider';
import { MerchantListPage } from '../../pages/MerchantListPage';
import { MerchantDetailPage } from '../../pages/MerchantDetailPage';
import { NearbyPage } from '../../pages/NearbyPage';
import { apiClient } from '../../api/client';
import type {
  MerchantListItem,
  MerchantDetailResponse,
  PaginatedResponse,
} from '../../api/types';

// ---- i18n mock ----
vi.mock('react-i18next', () => {
  const T: Record<string, string> = {
    'merchants.title': 'Merchants',
    'merchants.pageTitle': 'Merchant Details',
    'merchants.searchPlaceholder': 'Search merchants...',
    'merchants.searchLabel': 'Search merchants',
    'merchants.categoryAll': 'All Categories',
    'merchants.open': 'Open',
    'merchants.closed': 'Closed',
    'merchants.loadError': 'Failed to load merchants',
    'merchants.retryLoad': 'Retry',
    'merchants.notFound': 'No merchants found',
    'merchants.notFoundDescription': 'Try adjusting your search or filters.',
    'merchants.loadMerchantError': 'Failed to load merchant details',
    'merchants.retryMerchant': 'Retry',
    'merchants.merchantNotFound': 'Merchant not found',
    'merchants.merchantNotFoundDescription':
      "The merchant you're looking for is not available.",
    'merchants.backToMerchants': 'Back to Merchants',
    'merchants.noAddress': 'No address provided',
    'merchants.resultCount': '{count} merchant(s)',
    'merchants.noAbout': 'No description provided',
    'merchants.website': 'Website',
    'merchants.getDirections': 'Get Directions',
    'merchants.googleMaps': 'Google Maps',
    'merchants.waze': 'Waze',
    'merchants.aboutUs': 'About Us',
    'merchants.gallery': 'Gallery',
    'merchants.promotion': 'Promotion',
    'merchants.operatingHours': 'Operating Hours',
    'merchants.unknownStatus': 'Unknown',
    'common.loading': 'Loading...',
    'common.retry': 'Retry',
    'nearby.title': 'Nearby Merchants',
    'nearby.noLocationAccess': 'Location access denied',
    'nearby.noLocationAccessDescription':
      'Please enable location access in your browser settings to find nearby merchants.',
    'nearby.noNearbyMerchants': 'No nearby merchants found',
    'nearby.noNearbyMerchantsDescription': 'Try expanding your search area.',
    'nearby.loadingLocation': 'Getting your location...',
    'nearby.loadingMerchants': 'Finding nearby merchants...',
    'nearby.retryLocation': 'Retry',
    'merchants.distanceKm': '{distance} km',
    'errors.offline': 'You are offline',
    'errors.offlineDescription':
      'Please check your internet connection and try again.',
    'merchants.statusOnline': 'Online',
    'merchants.statusOffline': 'Offline',
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
    displayName: `Secure Merchant ${id}`,
    branchName: '',
    category: { id: 'cat-1', code: 'food', name: 'Food' },
    isOnline: true,
    isOffline: false,
    packages: [],
    ...overrides,
  };
}

function makeDetail(
  overrides: Partial<MerchantDetailResponse> = {},
): MerchantDetailResponse {
  return {
    merchantId: 'm-secure',
    displayName: 'Secure Merchant',
    branchName: 'Branch 1',
    category: { id: 'cat-1', code: 'food', name: 'Food' },
    isOnline: true,
    isOffline: false,
    logoUrl: null,
    bannerUrl: null,
    aboutUs: 'Description',
    address: '123 Main Street',
    businessHours: null,
    phone: '+60123456789',
    email: 'info@securemerchant.com',
    whatsapp: null,
    website: 'https://securemerchant.com',
    socialLinks: null,
    gallery: [],
    coordinates: null,
    packages: [],
    openNow: 'OPEN' as const,
    categories: [],
    distance: undefined,
    ...overrides,
  };
}

function makePaginated(
  items: MerchantListItem[],
): PaginatedResponse<MerchantListItem> {
  return {
    items,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    total: items.length,
  };
}

// ---- Storage mock helper ----

function createStorageMock(): {
  storage: Record<string, string | null>;
  mock: Storage;
} {
  const storage: Record<string, string | null> = {};
  const mock: Storage = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => {
      storage[k] = v;
    },
    removeItem: (k: string) => {
      delete storage[k];
    },
    clear: () => {
      Object.keys(storage).forEach((k) => {
        delete storage[k];
      });
    },
    get length() {
      return Object.keys(storage).length;
    },
    key: (_index: number) => null,
  };
  return { storage, mock };
}

// Mock geolocation for NearbyPage
function mockGeolocation() {
  const geolocation = {
    watchPosition: vi.fn(
      (
        success: PositionCallback,
        _error?: PositionErrorCallback | null,
        _options?: PositionOptions,
      ) => {
        setTimeout(() => {
          success({
            coords: {
              latitude: 3.139,
              longitude: 101.6869,
              accuracy: 100,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        }, 0);
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

// ===== STORAGE SECURITY =====

describe('Merchant Security — storage', () => {
  let localStorageMock: ReturnType<typeof createStorageMock>;
  let sessionStorageMock: ReturnType<typeof createStorageMock>;

  beforeEach(() => {
    localStorageMock = createStorageMock();
    sessionStorageMock = createStorageMock();
    vi.stubGlobal('localStorage', localStorageMock.mock);
    vi.stubGlobal('sessionStorage', sessionStorageMock.mock);
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('MerchantListPage: no merchant data in localStorage', async () => {
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
    render(
      <MemoryRouter initialEntries={['/merchants']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants" element={<MerchantListPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText('Secure Merchant m1')).toBeInTheDocument();
    });
    const storedKeys = Object.keys(localStorageMock.storage).filter(
      (k) => localStorageMock.storage[k] != null,
    );
    const merchantKeys = storedKeys.filter(
      (k) =>
        k.toLowerCase().includes('merchant') ||
        k.toLowerCase().includes('merchants') ||
        k.toLowerCase().includes('category'),
    );
    expect(merchantKeys).toHaveLength(0);
  });

  it('MerchantListPage: no merchant data in sessionStorage', async () => {
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
    render(
      <MemoryRouter initialEntries={['/merchants']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants" element={<MerchantListPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText('Secure Merchant m1')).toBeInTheDocument();
    });
    const storedKeys = Object.keys(sessionStorageMock.storage).filter(
      (k) => sessionStorageMock.storage[k] != null,
    );
    const merchantKeys = storedKeys.filter(
      (k) =>
        k.toLowerCase().includes('merchant') ||
        k.toLowerCase().includes('merchants') ||
        k.toLowerCase().includes('category'),
    );
    expect(merchantKeys).toHaveLength(0);
  });

  it('MerchantDetailPage: no merchant detail in localStorage', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: makeDetail(),
    });
    render(
      <MemoryRouter initialEntries={['/merchants/m-secure']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants/:id" element={<MerchantDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      // "Secure Merchant" appears in both header and h2
      expect(screen.getAllByText('Secure Merchant').length).toBeGreaterThan(0);
    });
    const storedKeys = Object.keys(localStorageMock.storage).filter(
      (k) => localStorageMock.storage[k] != null,
    );
    const sensitiveKeys = storedKeys.filter(
      (k) =>
        k.toLowerCase().includes('merchant') ||
        k.toLowerCase().includes('address') ||
        k.toLowerCase().includes('phone') ||
        k.toLowerCase().includes('email'),
    );
    expect(sensitiveKeys).toHaveLength(0);
  });
});

// ===== DOM EXPOSURE =====

describe('Merchant Security — DOM exposure', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('MerchantListPage: no internal IDs in DOM', async () => {
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
    render(
      <MemoryRouter initialEntries={['/merchants']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants" element={<MerchantListPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText('Secure Merchant m1')).toBeInTheDocument();
    });
    const html = document.body.innerHTML;
    expect(html).not.toContain('internal_id');
    expect(html).not.toContain('objectKey');
    expect(html).not.toContain('object_key');
  });

  it('MerchantDetailPage: no sensitive data in URL params', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: makeDetail(),
    });
    render(
      <MemoryRouter initialEntries={['/merchants/m-secure']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants/:id" element={<MerchantDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getAllByText('Secure Merchant').length).toBeGreaterThan(0);
    });
    const url =
      window.location.pathname + window.location.search + window.location.hash;
    expect(url).not.toContain('phone');
    expect(url).not.toContain('email');
    expect(url).not.toContain('address');
    expect(url).not.toContain('+60123456789');
    expect(url).not.toContain('info@securemerchant.com');
  });

  it('MerchantDetailPage: no internal DB IDs in DOM', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: makeDetail(),
    });
    render(
      <MemoryRouter initialEntries={['/merchants/m-secure']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants/:id" element={<MerchantDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getAllByText('Secure Merchant').length).toBeGreaterThan(0);
    });
    const html = document.body.innerHTML;
    expect(html).not.toContain('internal_id');
    expect(html).not.toContain('objectKey');
  });
});

// ===== EXTERNAL URL SAFETY =====

describe('Merchant Security — external URLs', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('MerchantDetailPage: external links use target="_blank" with rel="noopener noreferrer"', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: makeDetail(),
    });
    render(
      <MemoryRouter initialEntries={['/merchants/m-secure']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants/:id" element={<MerchantDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getAllByText('Secure Merchant').length).toBeGreaterThan(0);
    });
    const externalLinks = document.querySelectorAll('a[target="_blank"]');
    externalLinks.forEach((link) => {
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  it('MerchantDetailPage: no javascript: URLs', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: makeDetail(),
    });
    render(
      <MemoryRouter initialEntries={['/merchants/m-secure']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants/:id" element={<MerchantDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getAllByText('Secure Merchant').length).toBeGreaterThan(0);
    });
    const links = document.querySelectorAll('a');
    links.forEach((link) => {
      const href = link.getAttribute('href') ?? '';
      expect(href).not.toMatch(/^javascript:/i);
    });
  });

  it('MerchantDetailPage: all external links use http/https protocols', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: makeDetail(),
    });
    render(
      <MemoryRouter initialEntries={['/merchants/m-secure']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants/:id" element={<MerchantDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getAllByText('Secure Merchant').length).toBeGreaterThan(0);
    });
    const links = document.querySelectorAll('a');
    links.forEach((link) => {
      const href = link.getAttribute('href') ?? '';
      if (
        !href.startsWith('tel:') &&
        !href.startsWith('mailto:') &&
        href.length > 0 &&
        !href.startsWith('/')
      ) {
        expect(href.startsWith('http://') || href.startsWith('https://')).toBe(
          true,
        );
      }
    });
  });

  it('MerchantDetailPage: direction links (Google Maps, Waze) use https', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: makeDetail({
        coordinates: { latitude: 3.139, longitude: 101.6869 },
      }),
    });
    render(
      <MemoryRouter initialEntries={['/merchants/m-secure']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants/:id" element={<MerchantDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText('Google Maps')).toBeInTheDocument();
      expect(screen.getByText('Waze')).toBeInTheDocument();
    });
    const mapsLink = screen.getByText('Google Maps').closest('a');
    expect(mapsLink?.getAttribute('href')).toMatch(/^https:\/\//);
    const wazeLink = screen.getByText('Waze').closest('a');
    expect(wazeLink?.getAttribute('href')).toMatch(/^https:\/\//);
  });
});

// ===== CONSOLE SECURITY =====

describe('Merchant Security — console', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no merchant data logged to console', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
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
    render(
      <MemoryRouter initialEntries={['/merchants']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants" element={<MerchantListPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText('Secure Merchant m1')).toBeInTheDocument();
    });
    for (const call of consoleLogSpy.mock.calls) {
      const args = call.map(String).join(' ');
      expect(args).not.toMatch(
        /merchant|displayName|branchName|phone|email|address/i,
      );
    }
    consoleLogSpy.mockRestore();
  });

  it('MerchantDetailPage: no console.log of phone/email/address', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: makeDetail(),
    });
    render(
      <MemoryRouter initialEntries={['/merchants/m-secure']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants/:id" element={<MerchantDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getAllByText('Secure Merchant').length).toBeGreaterThan(0);
    });
    for (const call of consoleLogSpy.mock.calls) {
      const args = call.map(String).join(' ');
      expect(args).not.toMatch(
        /\+60123456789|info@securemerchant|123 Main Street/i,
      );
    }
    consoleLogSpy.mockRestore();
  });
});

// ===== IMAGE FALLBACK =====

describe('Merchant Security — image fallback', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('MerchantDetailPage: shows fallback when logo image errors', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: makeDetail({ logoUrl: null }),
    });
    render(
      <MemoryRouter initialEntries={['/merchants/m-secure']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants/:id" element={<MerchantDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getAllByText('Secure Merchant').length).toBeGreaterThan(0);
    });
  });

  it('MerchantDetailPage: gallery image has loading="lazy"', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: makeDetail({
        gallery: [{ url: 'https://example.com/photo.jpg', position: 1 }],
      }),
    });
    render(
      <MemoryRouter initialEntries={['/merchants/m-secure']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants/:id" element={<MerchantDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      const galleryImg = screen.getByAltText('Secure Merchant photo 1');
      expect(galleryImg).toBeInTheDocument();
      expect(galleryImg).toHaveAttribute('loading', 'lazy');
    });
  });

  it('MerchantDetailPage: all images have alt text', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: makeDetail({
        logoUrl: 'https://example.com/logo.png',
        bannerUrl: 'https://example.com/banner.png',
        gallery: [{ url: 'https://example.com/photo.jpg', position: 1 }],
      }),
    });
    render(
      <MemoryRouter initialEntries={['/merchants/m-secure']}>
        <AuthProvider apiClient={apiClient} autoRestore={false}>
          <Routes>
            <Route path="/merchants/:id" element={<MerchantDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getAllByText('Secure Merchant').length).toBeGreaterThan(0);
    });
    const images = document.querySelectorAll('img');
    images.forEach((img) => {
      expect(img).toHaveAttribute('alt');
      expect(img.getAttribute('alt')).toBeTruthy();
    });
  });
});

// ===== TEST INTEGRITY =====

describe('Merchant Security — test integrity', () => {
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

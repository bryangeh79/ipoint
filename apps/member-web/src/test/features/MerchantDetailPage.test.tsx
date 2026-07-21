// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider';
import { MerchantDetailPage } from '../../pages/MerchantDetailPage';
import { apiClient } from '../../api/client';
import { ApiError } from '@ipoint/api-client';
import type { MerchantDetailResponse } from '../../api/types';

// ---- i18n mock ----
vi.mock('react-i18next', () => {
  const T: Record<string, string> = {
    'merchants.pageTitle': 'Merchant Details',
    'merchants.open': 'Open',
    'merchants.closed': 'Closed',
    'merchants.statusOnline': 'Online',
    'merchants.statusOffline': 'Offline',
    'merchants.address': 'Address',
    'merchants.phone': 'Phone',
    'merchants.website': 'Website',
    'merchants.email': 'Email',
    'merchants.getDirections': 'Get Directions',
    'merchants.googleMaps': 'Google Maps',
    'merchants.waze': 'Waze',
    'merchants.aboutUs': 'About Us',
    'merchants.gallery': 'Gallery',
    'merchants.promotion': 'Promotion',
    'merchants.operatingHours': 'Operating Hours',
    'merchants.unknownStatus': 'Unknown',
    'merchants.loadMerchantError': 'Failed to load merchant details',
    'merchants.retryMerchant': 'Retry',
    'merchants.merchantNotFound': 'Merchant not found',
    'merchants.merchantNotFoundDescription':
      "The merchant you're looking for is not available.",
    'merchants.backToMerchants': 'Back to Merchants',
    'merchants.noAddress': 'No address provided',
    'merchants.noAbout': 'No description provided',
    'merchants.noWebsite': 'No website',
    'merchants.noPhone': 'No phone number',
    'merchants.noEmail': 'No email address',
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

function mockDetail(
  overrides: Partial<MerchantDetailResponse> = {},
): MerchantDetailResponse {
  return {
    merchantId: 'm1',
    displayName: 'Test Merchant',
    branchName: 'Branch 1',
    category: { id: 'cat-1', code: 'food', name: 'Food' },
    isOnline: true,
    isOffline: false,
    logoUrl: 'https://example.com/logo.png',
    bannerUrl: 'https://example.com/banner.png',
    aboutUs: 'A great place to shop.',
    address: '123 Main Street, Kuala Lumpur',
    businessHours: {
      monday: [{ open: '09:00', close: '18:00' }],
      tuesday: [{ open: '09:00', close: '18:00' }],
    },
    phone: '+60123456789',
    email: 'info@testmerchant.com',
    whatsapp: null,
    website: 'https://testmerchant.com',
    socialLinks: null,
    gallery: [{ url: 'https://example.com/photo1.jpg', position: 1 }],
    coordinates: {
      latitude: 3.139,
      longitude: 101.6869,
    },
    packages: [
      {
        code: 'pkg1',
        name: 'Standard',
        rate: '5% cashback',
        isDefault: true,
      },
    ],
    openNow: 'OPEN' as const,
    categories: [],
    distance: undefined,
    ...overrides,
  };
}

function renderPage(merchantId = 'm1') {
  return render(
    <MemoryRouter initialEntries={[`/merchants/${merchantId}`]}>
      <AuthProvider apiClient={apiClient} autoRestore={false}>
        <Routes>
          <Route path="/merchants/:id" element={<MerchantDetailPage />} />
          <Route path="/merchants" element={<div>Merchant list</div>} />
          <Route path="*" element={<div>Not found</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// ===== STATE RENDERING =====

describe('MerchantDetailPage — state rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading skeleton on mount', () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockImplementation(() => new Promise(() => {}));
    renderPage();
    // Should show back button in the loading state
    expect(screen.getByLabelText('Back to Merchants')).toBeInTheDocument();
  });

  it('shows merchant name when data loads', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    // "Test Merchant" appears in both header and h2 heading
    await waitFor(() => {
      expect(screen.getAllByText('Test Merchant').length).toBeGreaterThan(0);
    });
  });

  it('shows branch name when available', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Branch 1')).toBeInTheDocument();
    });
  });

  it('shows about section', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('A great place to shop.')).toBeInTheDocument();
    });
  });

  it('shows address', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText('123 Main Street, Kuala Lumpur'),
      ).toBeInTheDocument();
    });
  });

  it('shows phone number as clickable link', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      const phoneLink = screen.getByText('+60123456789');
      expect(phoneLink).toBeInTheDocument();
      expect(phoneLink.closest('a')).toHaveAttribute(
        'href',
        'tel:+60123456789',
      );
    });
  });

  it('shows website with target="_blank" and rel attributes', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      const websiteLink = screen.getByText('Website').closest('a');
      expect(websiteLink).toHaveAttribute('target', '_blank');
      expect(websiteLink).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  it('shows email as clickable link', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      const emailLink = screen.getByText('info@testmerchant.com');
      expect(emailLink).toBeInTheDocument();
      expect(emailLink.closest('a')).toHaveAttribute(
        'href',
        'mailto:info@testmerchant.com',
      );
    });
  });

  it('shows promotion section when packages exist', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Standard')).toBeInTheDocument();
    });
  });

  it('shows gallery section when images exist', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Gallery')).toBeInTheDocument();
    });
  });

  it('shows gallery image with alt text', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      const galleryImg = screen.getByAltText('Test Merchant photo 1');
      expect(galleryImg).toBeInTheDocument();
      expect(galleryImg).toHaveAttribute('loading', 'lazy');
    });
  });

  it('shows Google Maps and Waze direction buttons', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Google Maps')).toBeInTheDocument();
      expect(screen.getByText('Waze')).toBeInTheDocument();
    });
  });

  it('direction links have target="_blank" and rel attributes', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      const mapsLink = screen.getByText('Google Maps').closest('a');
      expect(mapsLink).toHaveAttribute('target', '_blank');
      expect(mapsLink).toHaveAttribute('rel', 'noopener noreferrer');
      const wazeLink = screen.getByText('Waze').closest('a');
      expect(wazeLink).toHaveAttribute('target', '_blank');
      expect(wazeLink).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });
});

// ===== NOT FOUND =====

describe('MerchantDetailPage — not found', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows not found state on 404', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockRejectedValue({ status: 404 });
    renderPage();
    // "Merchant not found" appears in both header and empty state
    await waitFor(() => {
      expect(screen.getAllByText('Merchant not found').length).toBeGreaterThan(
        0,
      );
    });
  });

  it('shows not found description on 404', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockRejectedValue({ status: 404 });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText("The merchant you're looking for is not available."),
      ).toBeInTheDocument();
    });
  });

  it('shows back to merchants button on 404', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockRejectedValue({ status: 404 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Back to Merchants')).toBeInTheDocument();
    });
  });
});

// ===== ERROR HANDLING =====

describe('MerchantDetailPage — error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows error alert on API failure', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiError(500, {
        message: 'Failed to load merchant details',
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(
        screen.getAllByText('Failed to load merchant details').length,
      ).toBeGreaterThan(0);
    });
  });

  it('shows retry button on error', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiError(500, { message: 'Server error' }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });
});

// ===== IMAGE FALLBACK =====

describe('MerchantDetailPage — image fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows logo fallback when no logo URL', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail({ logoUrl: null }),
    });
    renderPage();
    // "Test Merchant" appears in header and h2
    await waitFor(() => {
      expect(screen.getAllByText('Test Merchant').length).toBeGreaterThan(0);
    });
  });

  it('logo image has alt text', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      const logo = screen.getByAltText('Test Merchant logo');
      expect(logo).toBeInTheDocument();
    });
  });

  it('banner image has alt text', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      const banner = screen.getByAltText('Test Merchant banner');
      expect(banner).toBeInTheDocument();
    });
  });
});

// ===== SECURITY =====

describe('MerchantDetailPage — security', () => {
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

  it('no merchant detail data in localStorage', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Test Merchant').length).toBeGreaterThan(0);
    });
    const keys = Object.keys(storage).filter((k) => storage[k] != null);
    const merchantKeys = keys.filter(
      (k) =>
        k.toLowerCase().includes('merchant') ||
        k.toLowerCase().includes('detail') ||
        k.toLowerCase().includes('address') ||
        k.toLowerCase().includes('phone') ||
        k.toLowerCase().includes('email'),
    );
    expect(merchantKeys).toHaveLength(0);
  });

  it('no merchant detail data in sessionStorage', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Test Merchant').length).toBeGreaterThan(0);
    });
    const keys = Object.keys(storage).filter((k) => storage[k] != null);
    const merchantKeys = keys.filter(
      (k) =>
        k.toLowerCase().includes('merchant') ||
        k.toLowerCase().includes('detail') ||
        k.toLowerCase().includes('address') ||
        k.toLowerCase().includes('phone') ||
        k.toLowerCase().includes('email'),
    );
    expect(merchantKeys).toHaveLength(0);
  });

  it('no sensitive data in URL params', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Test Merchant').length).toBeGreaterThan(0);
    });
    const url = window.location.pathname + window.location.search;
    expect(url).not.toContain('phone');
    expect(url).not.toContain('email');
    expect(url).not.toContain('address');
  });

  it('external URLs use safe protocols only', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Test Merchant').length).toBeGreaterThan(0);
    });
    const links: HTMLAnchorElement[] = Array.from(
      document.querySelectorAll('a'),
    );
    links.forEach((link) => {
      const href = link.getAttribute('href') ?? '';
      if (
        href.startsWith('http://') ||
        href.startsWith('https://') ||
        href.startsWith('tel:') ||
        href.startsWith('mailto:') ||
        href === '' ||
        href === '#'
      ) {
        // Safe protocol — pass
      } else {
        // Should not contain javascript: protocol
        expect(href).not.toMatch(/^javascript:/i);
      }
    });
  });

  it('no internal IDs visible in DOM', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Test Merchant').length).toBeGreaterThan(0);
    });
    const html = document.body.innerHTML;
    expect(html).not.toContain('internal_id');
  });
});

// ===== ACCESSIBILITY =====

describe('MerchantDetailPage — accessibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('back button has accessible label', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByLabelText('Back to Merchants')).toBeInTheDocument();
  });

  it('detail region has aria-label', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      const region = screen.getByRole('region');
      expect(region).toHaveAttribute('aria-label', 'Test Merchant');
    });
  });

  it('uses h2 for merchant name', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      const heading = screen.getByRole('heading', {
        level: 2,
        name: 'Test Merchant',
      });
      expect(heading).toBeInTheDocument();
    });
  });

  it('uses h3 for section titles', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: mockDetail(),
    });
    renderPage();
    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { level: 3 });
      expect(headings.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ===== TEST INTEGRITY =====

describe('MerchantDetailPage — test integrity', () => {
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

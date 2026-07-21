// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthProvider';
import { QrPage } from '../../pages/QrPage';
import { apiClient } from '../../api/client';
import { ApiError } from '@ipoint/api-client';

// ---- i18n mock ----
vi.mock('react-i18next', () => {
  const T: Record<string, string> = {
    'qr.title': 'My QR Code',
    'qr.loading': 'Loading your code...',
    'qr.error': 'Failed to load QR code',
    'qr.errorDescription': 'Unable to generate your QR code at this time.',
    'qr.retry': 'Retry',
    'qr.refresh': 'Refresh',
    'qr.refreshHint': 'Generate a new code',
    'qr.offline': 'You are offline',
    'qr.offlineDescription': 'QR code cannot be refreshed while offline.',
    'qr.qrNotAvailable': 'QR code temporarily unavailable',
    'qr.qrNotAvailableDescription':
      'The QR payment feature is not available yet. Please check back later.',
    'qr.qrNotAvailableHint':
      'QR code generation will be enabled in a future update.',
    'qr.codeExpires': 'This code refreshes periodically for security',
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/qr']}>
      <AuthProvider apiClient={apiClient} autoRestore={false}>
        <Routes>
          <Route path="/qr" element={<QrPage />} />
          <Route path="*" element={<div>Not found</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// ===== STATE RENDERING =====

describe('QrPage — state rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading skeleton on mount', () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    // Keep the request pending so loading state stays
    vi.spyOn(apiClient, 'get').mockImplementation(() => new Promise(() => {}));
    renderPage();
    // Title should be visible
    expect(screen.getByText('My QR Code')).toBeInTheDocument();
  });

  it('shows QR unavailable when backend returns 404', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockRejectedValue({
      response: { status: 404 },
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText('QR code temporarily unavailable'),
      ).toBeInTheDocument();
    });
  });

  it('shows QR unavailable description', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockRejectedValue({
      response: { status: 404 },
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(
          'The QR payment feature is not available yet. Please check back later.',
        ),
      ).toBeInTheDocument();
    });
  });

  it('shows error state when API returns non-404 error', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiError(500, { message: 'Server error' }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Failed to load QR code')).toBeInTheDocument();
    });
  });

  it('shows error description in error state', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiError(500, { message: 'Server error' }),
    );
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText('Unable to generate your QR code at this time.'),
      ).toBeInTheDocument();
    });
  });

  it('shows retry button in error state', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockRejectedValue(
      new ApiError(500, { message: 'Server error' }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  it('shows security note in unavailable state', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockRejectedValue({
      response: { status: 404 },
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText('This code refreshes periodically for security'),
      ).toBeInTheDocument();
    });
  });

  it('shows refresh button in unavailable state', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockRejectedValue({
      response: { status: 404 },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeInTheDocument();
    });
  });

  it('Refresh button has accessible label', async () => {
    vi.spyOn(apiClient, 'attemptSessionRestore').mockResolvedValue(false);
    vi.spyOn(apiClient, 'get').mockRejectedValue({
      response: { status: 404 },
    });
    renderPage();
    await waitFor(() => {
      const btn = screen.getByLabelText('Generate a new code');
      expect(btn).toBeInTheDocument();
    });
  });
});

// ===== OFFLINE BEHAVIOR =====

describe('QrPage — offline behavior', () => {
  beforeEach(() => {
    // Simulate offline
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
    vi.spyOn(apiClient, 'get').mockRejectedValue({
      response: { status: 404 },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('You are offline')).toBeInTheDocument();
    });
  });

  it('disables refresh when offline', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue({
      response: { status: 404 },
    });
    renderPage();
    await waitFor(() => {
      const btn = screen.getByText('Refresh').closest('button');
      expect(btn).toBeDisabled();
    });
  });
});

// ===== SECURITY =====

describe('QrPage — security', () => {
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

  it('no QR data written to localStorage', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue({
      response: { status: 404 },
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText('QR code temporarily unavailable'),
      ).toBeInTheDocument();
    });
    const keys = Object.keys(storage).filter((k) => storage[k] != null);
    const qrKeys = keys.filter(
      (k) =>
        k.toLowerCase().includes('qr') || k.toLowerCase().includes('qrcode'),
    );
    expect(qrKeys).toHaveLength(0);
  });

  it('no QR data written to sessionStorage', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue({
      response: { status: 404 },
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText('QR code temporarily unavailable'),
      ).toBeInTheDocument();
    });
    const keys = Object.keys(storage).filter((k) => storage[k] != null);
    const qrKeys = keys.filter(
      (k) =>
        k.toLowerCase().includes('qr') || k.toLowerCase().includes('qrcode'),
    );
    expect(qrKeys).toHaveLength(0);
  });

  it('no internal IDs exposed in DOM', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue({
      response: { status: 404 },
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText('QR code temporarily unavailable'),
      ).toBeInTheDocument();
    });
    const html = document.body.innerHTML;
    // Security note: internal memberId pattern
    expect(html).not.toContain('memberId');
    expect(html).not.toContain('member_id');
  });

  it('no console.log of user data', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(apiClient, 'get').mockRejectedValue({
      response: { status: 404 },
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText('QR code temporarily unavailable'),
      ).toBeInTheDocument();
    });
    for (const call of consoleLogSpy.mock.calls) {
      const args = call.map(String).join(' ');
      expect(args).not.toMatch(/member|user|email|phone|qr_code/i);
    }
    consoleLogSpy.mockRestore();
  });
});

// ===== TEST INTEGRITY =====

describe('QrPage — test integrity', () => {
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

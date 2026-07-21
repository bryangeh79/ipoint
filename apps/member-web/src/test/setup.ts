// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(async () => {
  cleanup();
  // Wait for React 19 dev mode to settle pending effects from unmount
  try {
    await waitFor(() => {}, { timeout: 100, interval: 10 });
  } catch {
    // waitFor timeout is expected if no pending state updates
  }
});

// Mock matchMedia for responsive tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock navigator.languages for i18n
Object.defineProperty(navigator, 'languages', {
  writable: true,
  value: ['en-US', 'en'],
});

// Ensure crypto.randomUUID is available
if (typeof crypto.randomUUID === 'undefined') {
  Object.defineProperty(crypto, 'randomUUID', {
    value: () =>
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }),
  });
}

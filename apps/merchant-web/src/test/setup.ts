// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { act } from 'react';
import { afterEach, vi } from 'vitest';

afterEach(async () => {
  if (typeof window === 'undefined') {
    return;
  }

  // Wrap cleanup in act to flush pending React 19 dev-mode effects,
  // preventing "not wrapped in act(...)" warnings on stderr.
  await act(async () => {
    cleanup();
  });
  // Drain any remaining scheduled microtasks (resolved promises,
  // effect cleanup functions, AbortController callbacks).
  await act(async () => {
    // Empty act flushes remaining React work without touching the DOM.
  });
  await act(async () => {
    // eslint-disable-next-line no-empty
  });
  await act(async () => {
    // eslint-disable-next-line no-empty
  });
});

if (typeof window !== 'undefined') {
  // Mock matchMedia for responsive components.
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

  // Mock navigator.languages for i18n-dependent components.
  Object.defineProperty(navigator, 'languages', {
    writable: true,
    value: ['en-US', 'en'],
  });
}

// Ensure crypto.randomUUID is available (idempotency keys).
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

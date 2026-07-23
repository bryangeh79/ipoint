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
  //
  // First: flush all pending effects by wrapping cleanup in act.
  await act(async () => {
    cleanup();
  });
  // Second: drain any remaining scheduled microtasks (resolved promises,
  // effect cleanup functions, AbortController callbacks, router nav).
  await act(async () => {
    // Empty act flushes remaining React work without touching the DOM.
  });
  // Third: one more microtask drain for any effects scheduled by the
  // previous act's cleanup callbacks.
  await act(async () => {
    // eslint-disable-next-line no-empty
  });
  // Fourth: drain effects that may fire during the third act.
  await act(async () => {
    // eslint-disable-next-line no-empty
  });
});

if (typeof window !== 'undefined') {
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
}

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

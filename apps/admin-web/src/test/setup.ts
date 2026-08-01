import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

class MediaQueryListStub extends EventTarget implements MediaQueryList {
  readonly media: string;
  readonly matches: boolean;
  onchange:
    | ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown)
    | null = null;

  constructor(query: string) {
    super();
    this.media = query;
    this.matches =
      query.includes('min-width: 768px') && !query.includes('display-mode');
  }

  addListener(): void {}
  removeListener(): void {}
  dispatchEvent(event: Event): boolean {
    return super.dispatchEvent(event);
  }
}

configure({ asyncUtilTimeout: 5_000 });

beforeEach(() => {
  document.documentElement.lang = 'en';
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
    } satisfies Storage,
  });
  window.history.replaceState({}, '', '/admin/login');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => new MediaQueryListStub(query),
  });
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(window.navigator, 'serviceWorker', {
    configurable: true,
    value: { register: vi.fn() },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => null),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

const entries = new Map<string, string>();
const testStorage: Storage = {
  get length() {
    return entries.size;
  },
  clear: () => entries.clear(),
  getItem: (key) => entries.get(key) ?? null,
  key: (index) => [...entries.keys()][index] ?? null,
  removeItem: (key) => entries.delete(key),
  setItem: (key, value) => entries.set(key, String(value)),
};

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: testStorage,
});
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: testStorage,
});

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }),
  });
}

if (!Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [],
  });
}

if (!globalThis.ResizeObserver) {
  class TestResizeObserver implements ResizeObserver {
    disconnect() {}
    observe() {}
    unobserve() {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
  });
}

if (!globalThis.IntersectionObserver) {
  class TestIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '0px';
    readonly thresholds = [0];

    disconnect() {}
    observe() {}
    takeRecords() {
      return [];
    }
    unobserve() {}
  }

  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: TestIntersectionObserver,
  });
}

if (!document.getAnimations) {
  Object.defineProperty(document, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
}

if (!Element.prototype.getAnimations) {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

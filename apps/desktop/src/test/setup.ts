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

if (!Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [],
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

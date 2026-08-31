import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeServerUrl, readConfiguredServerUrl } from './server';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readConfiguredServerUrl', () => {
  it('resolves the explicit same-origin web build configuration', () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'same-origin');

    expect(readConfiguredServerUrl()).toBe(window.location.origin);
  });

  it('keeps absolute deployment URLs normalized', () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'https://kanleaf.example.com/base/');

    expect(readConfiguredServerUrl()).toBe('https://kanleaf.example.com/base');
  });
});

describe('normalizeServerUrl', () => {
  it('accepts HTTP and HTTPS servers and removes a trailing slash', () => {
    expect(normalizeServerUrl(' http://127.0.0.1:3000/ ')).toBe(
      'http://127.0.0.1:3000',
    );
    expect(normalizeServerUrl('https://kanleaf.example.com/base/')).toBe(
      'https://kanleaf.example.com/base',
    );
  });

  it('rejects unsafe or ambiguous server addresses', () => {
    expect(() => normalizeServerUrl('file:///tmp/server')).toThrow(
      /HTTP or HTTPS/,
    );
    expect(() => normalizeServerUrl('https://user:pass@example.com')).toThrow(
      /credentials/,
    );
    expect(() =>
      normalizeServerUrl('https://example.com?server=other'),
    ).toThrow(/query or fragment/);
  });
});

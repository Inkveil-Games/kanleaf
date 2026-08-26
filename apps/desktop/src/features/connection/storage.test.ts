import { describe, expect, it } from 'vitest';
import { normalizeServerUrl } from './storage';

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

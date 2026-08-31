import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiRequest,
  subscribeToUnauthorizedRequests,
} from './client';

describe('apiRequest unauthorized signaling', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports the exact token when an authenticated request receives 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unauthorizedResponse()));
    const listener = vi.fn();
    const unsubscribe = subscribeToUnauthorizedRequests(listener);

    const error = await apiRequest(
      'https://kanleaf.example.com',
      '/api/host/access',
      {
        token: 'revoked-token',
      },
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).code).toBe('unauthorized');
    expect(listener).toHaveBeenCalledWith('revoked-token');
    unsubscribe();
  });

  it('does not report public authentication failures without a token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unauthorizedResponse()));
    const listener = vi.fn();
    const unsubscribe = subscribeToUnauthorizedRequests(listener);

    await expect(
      apiRequest('https://kanleaf.example.com', '/api/auth/login', {
        method: 'POST',
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

function unauthorizedResponse() {
  return new Response(
    JSON.stringify({
      error: { code: 'unauthorized', message: 'Authentication is required' },
    }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

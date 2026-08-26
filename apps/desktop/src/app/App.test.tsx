import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { Providers } from './providers';

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('connects to the configured server before showing authentication', async () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'https://kanleaf.example.com/base/');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          service: 'kanleaf',
          version: '0.1.0',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <Providers>
        <App />
      </Providers>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Sign in to Kanleaf' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/base/api/health',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it('explains when the server environment variable is missing', () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', '');

    render(
      <Providers>
        <App />
      </Providers>,
    );

    expect(
      screen.getByRole('heading', { name: 'Server not configured' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/VITE_KANLEAF_SERVER_URL/)).toBeInTheDocument();
  });

  it('allows retrying an unavailable configured server', async () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'http://127.0.0.1:3000');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', service: 'other' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'ok',
            service: 'kanleaf',
            version: '0.1.0',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <Providers>
        <App />
      </Providers>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Server unavailable' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to Kanleaf' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionScreen } from './ConnectionScreen';

describe('ConnectionScreen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates the health endpoint before accepting a server', async () => {
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
    const connected = vi.fn();
    render(<ConnectionScreen onConnected={connected} />);

    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: 'https://kanleaf.example.com/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() =>
      expect(connected).toHaveBeenCalledWith('https://kanleaf.example.com'),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kanleaf.example.com/api/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('explains when the URL is not a Kanleaf server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok', service: 'other' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    render(<ConnectionScreen onConnected={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(
      await screen.findByText(
        'This URL does not identify a healthy Kanleaf server',
      ),
    ).toHaveAttribute('role', 'alert');
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthScreen } from './AuthScreen';

describe('AuthScreen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers and returns the issued session', async () => {
    const authResponse = {
      token: 'session-token',
      expires_at: '2026-09-26T00:00:00Z',
      user: {
        id: 'user-id',
        email: 'person@example.com',
        display_name: 'Person',
        is_host: false,
        theme: 'system',
        timezone: 'UTC',
        week_start: 'monday',
        date_format: 'locale',
        active_workspace_id: 'workspace-id',
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(authResponse), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const authenticated = vi.fn();
    render(
      <AuthScreen
        serverUrl="https://kanleaf.example.com"
        onAuthenticated={authenticated}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New account' }));
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'person@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() =>
      expect(authenticated).toHaveBeenCalledWith(authResponse),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kanleaf.example.com/api/auth/register',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('renders the server error instead of discarding the form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'unauthorized',
              message: 'Authentication is required',
            },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    render(
      <AuthScreen
        serverUrl="https://kanleaf.example.com"
        onAuthenticated={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'person@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'incorrect password' },
    });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: 'Sign in' })
        .find((button) => button.getAttribute('type') === 'submit')!,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Authentication is required',
    );
    expect(screen.getByLabelText('Email')).toHaveValue('person@example.com');
  });
});

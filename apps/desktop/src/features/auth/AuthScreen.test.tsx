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
        active_workspace_id: null,
        setup_stage: 'account',
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
    fireEvent.change(screen.getByLabelText('Confirm password'), {
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

  it('keeps registration local when password confirmation does not match', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AuthScreen
        serverUrl="https://kanleaf.example.com"
        onAuthenticated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New account' }));
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'person@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different horse battery' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Register' }).closest('form')!,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Passwords do not match',
    );
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears a password mismatch when either password value changes', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(
      <AuthScreen
        serverUrl="https://kanleaf.example.com"
        onAuthenticated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New account' }));
    const password = screen.getByLabelText(/^Password/);
    const confirmation = screen.getByLabelText('Confirm password');
    fireEvent.change(password, { target: { value: 'correct horse battery' } });
    fireEvent.change(confirmation, {
      target: { value: 'different horse battery' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Register' }).closest('form')!,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Passwords do not match',
    );
    fireEvent.change(password, {
      target: { value: 'different horse battery' },
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('replaces an old server error with the local mismatch error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'conflict', message: 'Account already exists' },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    render(
      <AuthScreen
        serverUrl="https://kanleaf.example.com"
        onAuthenticated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New account' }));
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'person@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Account already exists',
    );
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different horse battery' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Register' }).closest('form')!,
    );

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Passwords do not match',
    );
  });

  it('locks authentication controls while the request is pending', async () => {
    let resolveRequest!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
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
      target: { value: 'correct horse battery' },
    });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: 'Sign in' })
        .find((button) => button.getAttribute('type') === 'submit')!,
    );

    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New account' })).toBeDisabled();

    resolveRequest(
      new Response('{}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeEnabled());
  });

  it('reveals each registration password independently without losing its value', () => {
    render(
      <AuthScreen
        serverUrl="https://kanleaf.example.com"
        onAuthenticated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New account' }));
    const password = screen.getByLabelText(/^Password/);
    const confirmation = screen.getByLabelText('Confirm password');
    fireEvent.change(password, { target: { value: 'correct horse battery' } });
    fireEvent.change(confirmation, {
      target: { value: 'correct horse battery' },
    });

    const showPassword = screen.getByRole('button', { name: 'Show password' });
    expect(showPassword).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(showPassword);

    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('correct horse battery');
    expect(confirmation).toHaveAttribute('type', 'password');
    expect(
      screen.getByRole('button', { name: 'Hide password' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: 'Show password confirmation' }),
    ).toHaveAttribute('aria-pressed', 'false');
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

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResetPasswordScreen } from './ResetPasswordScreen';

const resetToken = 'R'.repeat(43);
const invitationReturnTo = `/invite#token=${'I'.repeat(43)}`;

describe('ResetPasswordScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    '/reset-password',
    '/reset-password#token=short',
    `/reset-password#token=${'R'.repeat(43)}&returnTo=https%3A%2F%2Fevil.example`,
  ])('rejects a missing, malformed, or unsafe fragment at %s', (entry) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderScreen(entry);

    expect(
      screen.getByRole('heading', { name: 'Reset link unavailable' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates password requirements and confirmation before sending', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderScreen(`/reset-password#token=${resetToken}`);
    const password = screen.getByLabelText('New password');
    const confirmation = screen.getByLabelText('Confirm password');
    expect(password).toHaveAttribute('minlength', '10');
    expect(password).toHaveAttribute('autocomplete', 'new-password');

    fireEvent.change(password, { target: { value: 'too short' } });
    fireEvent.change(confirmation, { target: { value: 'different' } });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Reset password' }).closest('form')!,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Passwords do not match',
    );

    fireEvent.change(confirmation, { target: { value: 'too short' } });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Reset password' }).closest('form')!,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Password must contain at least 10 characters',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects passwords over the backend byte limit without consuming the link', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderScreen(`/reset-password#token=${resetToken}`);
    const oversizedPassword = '😀'.repeat(257);
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: oversizedPassword },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: oversizedPassword },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Password is too long');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits only token and password, revalidates sessions, and never persists secrets', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const onPasswordReset = vi.fn().mockResolvedValue(undefined);
    const fragment = new URLSearchParams({
      token: resetToken,
      returnTo: invitationReturnTo,
    }).toString();
    renderScreen(`/reset-password#${fragment}`, onPasswordReset);

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new correct horse battery' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'new correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(
      await screen.findByRole('heading', { name: 'Password updated' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kanleaf.example.com/api/auth/reset-password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          token: resetToken,
          password: 'new correct horse battery',
        }),
      }),
    );
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(onPasswordReset).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      invitationReturnTo,
    );
  });

  it('locks both password fields while the reset is pending', async () => {
    let resolveRequest!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
      ),
    );
    renderScreen(`/reset-password#token=${resetToken}`);
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new correct horse battery' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'new correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(screen.getByLabelText('New password')).toBeDisabled();
    expect(screen.getByLabelText('Confirm password')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Resetting password' }),
    ).toBeDisabled();
    resolveRequest(new Response(null, { status: 204 }));
    await screen.findByRole('heading', { name: 'Password updated' });
  });

  it('maps every rejected reset to the same invalid-or-expired state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'validation_error', message: 'Token was consumed' },
          }),
          { status: 422, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    renderScreen(`/reset-password#token=${resetToken}`);
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new correct horse battery' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'new correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This reset link is invalid or has expired. Request a new link.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('consumed');
    await waitFor(() =>
      expect(screen.getByLabelText('New password')).toBeEnabled(),
    );
  });

  it('keeps transient server failures retryable instead of declaring the link invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'internal_error', message: 'Database unavailable' },
          }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    renderScreen(`/reset-password#token=${resetToken}`);
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new correct horse battery' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'new correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kanleaf could not reset your password. Try again.',
    );
  });
});

function renderScreen(
  initialEntry: string,
  onPasswordReset?: () => Promise<void>,
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ResetPasswordScreen
        serverUrl="https://kanleaf.example.com"
        onPasswordReset={onPasswordReset}
      />
      <LocationOutput />
    </MemoryRouter>,
  );
}

function LocationOutput() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.hash}
    </output>
  );
}

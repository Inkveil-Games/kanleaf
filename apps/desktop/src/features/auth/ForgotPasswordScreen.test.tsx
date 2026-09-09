import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, type InitialEntry } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForgotPasswordScreen } from './ForgotPasswordScreen';

const invitationReturnTo = `/invite#token=${'I'.repeat(43)}`;

describe('ForgotPasswordScreen', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('submits the email and safe invitation destination, then stays generic', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const fragment = new URLSearchParams({
      returnTo: invitationReturnTo,
    }).toString();
    renderScreen(`/forgot-password#${fragment}`);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'person@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(
      await screen.findByText(
        'If an account exists for this email, a password reset link has been sent.',
      ),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kanleaf.example.com/api/auth/forgot-password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'person@example.com',
          return_to: invitationReturnTo,
        }),
      }),
    );
  });

  it('locks the form while sending and exposes a quiet sign-in return', async () => {
    let resolveRequest!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
      ),
    );
    renderScreen('/forgot-password');

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'person@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Sending reset link' }),
    ).toBeDisabled();
    resolveRequest(new Response(null, { status: 204 }));
    await screen.findByText(/If an account exists/);
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });

  it('keeps a recoverable API error visible without claiming the account exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'internal_error', message: 'SMTP exploded' },
          }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    renderScreen('/forgot-password');
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'person@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kanleaf could not request a password reset. Try again.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('SMTP exploded');
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeEnabled());
  });
});

function renderScreen(initialEntry: InitialEntry) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ForgotPasswordScreen serverUrl="https://kanleaf.example.com" />
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

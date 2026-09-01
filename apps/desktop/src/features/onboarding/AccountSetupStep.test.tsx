import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../lib/api/types';
import { AccountSetupStep } from './AccountSetupStep';

const user: User = {
  id: 'user-1',
  email: 'quang@example.com',
  display_name: 'quang',
  is_host: false,
  theme: 'system',
  timezone: 'UTC',
  week_start: 'monday',
  date_format: 'locale',
  active_workspace_id: null,
  setup_stage: 'account',
};

describe('AccountSetupStep', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses server defaults without sending the optional preferences', async () => {
    const updated = {
      ...user,
      display_name: 'Quang Tran',
      setup_stage: 'workspace' as const,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(updated), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onCompleted = vi.fn();
    render(
      <AccountSetupStep
        context={{
          serverUrl: 'https://kanleaf.example.com',
          token: 'session-token',
        }}
        user={user}
        onCompleted={onCompleted}
        onSignOut={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Quang Tran' },
    });
    fireEvent.change(screen.getByLabelText('Timezone'), {
      target: { value: '' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Use default preferences' }),
    );

    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(updated));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kanleaf.example.com/api/account/setup',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ display_name: 'Quang Tran' }),
      }),
    );
  });

  it('links a trimmed display-name error to the field before requesting the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AccountSetupStep
        context={{
          serverUrl: 'https://kanleaf.example.com',
          token: 'session-token',
        }}
        user={user}
        onCompleted={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    const displayName = screen.getByLabelText('Display name');
    fireEvent.change(displayName, { target: { value: '   ' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Use default preferences' }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(displayName).toHaveAttribute('aria-invalid', 'true');
    const errorId = displayName.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)).toHaveTextContent(
      'Enter a display name',
    );
  });

  it('links a local timezone error only when preferences are submitted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AccountSetupStep
        context={{
          serverUrl: 'https://kanleaf.example.com',
          token: 'session-token',
        }}
        user={user}
        onCompleted={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    const timezone = screen.getByLabelText('Timezone');
    fireEvent.change(timezone, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(timezone).toHaveAttribute('aria-invalid', 'true');
    const errorId = timezone.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)).toHaveTextContent(
      'Enter an IANA timezone name',
    );
  });

  it('associates the server IANA validation with timezone without hiding unrelated errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'validation_error',
              message: 'Timezone must be a valid IANA name',
            },
          }),
          {
            status: 422,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'validation_error',
              message: 'Display name contains unsupported characters',
            },
          }),
          {
            status: 422,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(
      <AccountSetupStep
        context={{
          serverUrl: 'https://kanleaf.example.com',
          token: 'session-token',
        }}
        user={user}
        onCompleted={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Timezone'), {
      target: { value: 'GMT+7' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const timezone = screen.getByLabelText('Timezone');
    await waitFor(() =>
      expect(timezone).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(
      document.getElementById(timezone.getAttribute('aria-describedby')!),
    ).toHaveTextContent('Timezone must be a valid IANA name');
    expect(
      screen.queryByText('Display name contains unsupported characters'),
    ).not.toBeInTheDocument();

    unmount();
    render(
      <AccountSetupStep
        context={{
          serverUrl: 'https://kanleaf.example.com',
          token: 'session-token',
        }}
        user={user}
        onCompleted={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByText('Display name contains unsupported characters'),
    ).toHaveAttribute('role', 'alert');
    expect(screen.getByLabelText('Timezone')).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});

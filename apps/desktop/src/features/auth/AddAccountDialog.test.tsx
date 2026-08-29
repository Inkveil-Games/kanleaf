import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AddAccountDialog } from './AddAccountDialog';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

describe('AddAccountDialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('authenticates another account without closing the current session first', async () => {
    const response = {
      token: 'second-token',
      expires_at: '2026-09-30T00:00:00Z',
      user: {
        id: 'user-2',
        email: 'second@example.com',
        display_name: 'Second',
        theme: 'system' as const,
        timezone: 'UTC',
        week_start: 'monday' as const,
        date_format: 'locale' as const,
        active_workspace_id: 'workspace-2',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const onAuthenticated = vi.fn().mockResolvedValue(undefined);
    render(
      <AddAccountDialog
        serverUrl="https://kanleaf.example.com"
        onAuthenticated={onAuthenticated}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'second@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.click(
      screen
        .getAllByRole('button', { name: 'Sign in' })
        .find((button) => button.getAttribute('type') === 'submit')!,
    );

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(response));
  });

  it('closes from its explicit close control', () => {
    const onClose = vi.fn();
    render(
      <AddAccountDialog
        serverUrl="https://kanleaf.example.com"
        onAuthenticated={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

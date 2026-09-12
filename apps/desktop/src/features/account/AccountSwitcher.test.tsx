import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AccountSession } from '../auth/accountSessionStore';
import { AccountSwitcher } from './AccountSwitcher';

describe('AccountSwitcher', () => {
  it('switches explicitly and exposes account actions', async () => {
    const onSwitchAccount = vi.fn();
    const onAddAccount = vi.fn();
    const onOpenAccountSettings = vi.fn();
    const onSignOutCurrent = vi.fn();
    render(
      <AccountSwitcher
        accounts={[account('user-1'), account('user-2')]}
        activeUserId="user-1"
        transitioning={false}
        error={null}
        onSwitchAccount={onSwitchAccount}
        onAddAccount={onAddAccount}
        onOpenAccountSettings={onOpenAccountSettings}
        onSignOutCurrent={onSignOutCurrent}
        onDismissError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
    expect(
      screen.getByRole('button', { name: /Account user-1/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Account user-1/ }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Switch account' }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
    fireEvent.click(screen.getByRole('button', { name: /Account user-2/ }));
    expect(onSwitchAccount).toHaveBeenCalledWith('user-2');

    fireEvent.click(
      screen.getByRole('button', { name: 'Add another account' }),
    );
    expect(onAddAccount).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenAccountSettings).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Sign out this account' }),
    );
    expect(onSignOutCurrent).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: 'Sign out all accounts' }),
    ).not.toBeInTheDocument();
  });

  it('keeps transition errors visible until dismissed', () => {
    const onDismissError = vi.fn();
    render(
      <AccountSwitcher
        accounts={[account('user-1')]}
        activeUserId="user-1"
        transitioning
        error="Resolve unsaved Markdown before switching."
        onSwitchAccount={vi.fn()}
        onAddAccount={vi.fn()}
        onOpenAccountSettings={vi.fn()}
        onSignOutCurrent={vi.fn()}
        onDismissError={onDismissError}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Resolve unsaved Markdown before switching.',
    );
    expect(
      screen.getByRole('button', { name: /Account user-1/ }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss account error' }),
    );
    expect(onDismissError).toHaveBeenCalledOnce();
  });

  it('shows Host Console only when the Host action is available', () => {
    const onOpenHostConsole = vi.fn();
    const { rerender } = render(
      <AccountSwitcher
        accounts={[account('user-1')]}
        activeUserId="user-1"
        transitioning={false}
        error={null}
        onSwitchAccount={vi.fn()}
        onAddAccount={vi.fn()}
        onOpenHostConsole={onOpenHostConsole}
        onSignOutCurrent={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Host Console' }));
    expect(onOpenHostConsole).toHaveBeenCalledOnce();

    rerender(
      <AccountSwitcher
        accounts={[account('user-1')]}
        activeUserId="user-1"
        transitioning={false}
        error={null}
        onSwitchAccount={vi.fn()}
        onAddAccount={vi.fn()}
        onSignOutCurrent={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
    expect(
      screen.queryByRole('button', { name: 'Host Console' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the existing account menu behind an avatar-only rail trigger', () => {
    render(
      <AccountSwitcher
        compact
        accounts={[account('user-1'), account('user-2')]}
        activeUserId="user-1"
        transitioning={false}
        error={null}
        onSwitchAccount={vi.fn()}
        onAddAccount={vi.fn()}
        onOpenAccountSettings={vi.fn()}
        onSignOutCurrent={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Switch account' });
    expect(trigger).toHaveTextContent('A');
    expect(trigger).not.toHaveTextContent('Account user-1');
    fireEvent.click(trigger);
    expect(
      screen.getByRole('button', { name: /Account user-2/ }),
    ).toBeInTheDocument();
  });
});

function account(userId: string): AccountSession {
  return {
    user_id: userId,
    email: `${userId}@example.com`,
    display_name: `Account ${userId}`,
    token: `${userId}-token`,
    expires_at: '2026-09-30T00:00:00Z',
    last_used_at: '2026-08-30T00:00:00Z',
  };
}

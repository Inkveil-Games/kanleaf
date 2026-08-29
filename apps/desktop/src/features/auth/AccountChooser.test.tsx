import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AccountSession } from './accountSessionStore';
import { AccountChooser } from './AccountChooser';

describe('AccountChooser', () => {
  it('requires an explicit retained identity selection', () => {
    const onSelect = vi.fn();
    const onUseAnother = vi.fn();
    render(
      <AccountChooser
        accounts={[account('user-1'), account('user-2')]}
        transitioning={false}
        error={null}
        onSelect={onSelect}
        onUseAnother={onUseAnother}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Account user-2/ }));
    expect(onSelect).toHaveBeenCalledWith('user-2');
    fireEvent.click(
      screen.getByRole('button', { name: 'Use another account' }),
    );
    expect(onUseAnother).toHaveBeenCalledOnce();
  });

  it('shows transition errors and locks account actions', () => {
    render(
      <AccountChooser
        accounts={[account('user-1')]}
        transitioning
        error="Session expired"
        onSelect={vi.fn()}
        onUseAnother={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Session expired');
    expect(
      screen.getByRole('button', { name: /Account user-1/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Use another account' }),
    ).toBeDisabled();
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

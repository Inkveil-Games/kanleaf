import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountDangerSettings } from './AccountDangerSettings';

describe('Account danger settings', () => {
  it('requires exact email and password and keeps server errors in the danger dialog', async () => {
    const remove = vi
      .fn()
      .mockRejectedValue(
        new Error('Delete or transfer ownership of Team (/team) first'),
      );
    render(
      <AccountDangerSettings
        email="person@example.com"
        onDeleteAccount={remove}
      />,
    );
    expect(screen.getByText(/Shared Workspaces remain/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete account?' });
    expect(dialog).toHaveAttribute('data-variant', 'danger');
    const confirm = within(dialog).getByRole('button', {
      name: 'Delete account',
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Current password'), {
      target: { value: 'current password' },
    });
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'Person@example.com' },
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'person@example.com' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Team (/team)',
    );
    expect(remove).toHaveBeenCalledWith('current password');
    expect(dialog).toBeInTheDocument();
  });
});

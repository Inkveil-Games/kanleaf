import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceTopBar } from './WorkspaceTopBar';

vi.mock('../collaboration/Notifications', () => ({
  Notifications: () => <button type="button">Notifications</button>,
}));

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'session-token',
};

describe('WorkspaceTopBar', () => {
  it('keeps global search and notifications available', () => {
    const onOpenCommandPalette = vi.fn();
    render(
      <WorkspaceTopBar
        context={context}
        onOpenNotificationTask={vi.fn()}
        onOpenInvitations={vi.fn()}
        onOpenCommandPalette={onOpenCommandPalette}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Search and commands (Ctrl or Command K)',
      }),
    );

    expect(onOpenCommandPalette).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Notifications' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Kanleaf')).toBeInTheDocument();
  });
});

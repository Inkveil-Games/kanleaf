import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from './types';
import { WorkspaceTopBar } from './WorkspaceTopBar';

vi.mock('../collaboration/Notifications', () => ({
  Notifications: () => <button type="button">Notifications</button>,
}));

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'session-token',
};

const workspaces: Workspace[] = [
  workspace('workspace-1', 'Kanleaf Core'),
  workspace('workspace-2', 'Website'),
];

describe('WorkspaceTopBar', () => {
  it('owns Workspace switching, settings, and creation', async () => {
    const onSwitchWorkspace = vi.fn().mockResolvedValue(undefined);
    const onCreateWorkspace = vi.fn().mockResolvedValue(undefined);
    const onOpenWorkspaceSettings = vi.fn();
    const onOpenCommandPalette = vi.fn();
    const onToggleNavigation = vi.fn();
    render(
      <WorkspaceTopBar
        context={context}
        workspaces={workspaces}
        workspaceId="workspace-1"
        onSwitchWorkspace={onSwitchWorkspace}
        onCreateWorkspace={onCreateWorkspace}
        onRenameWorkspace={vi.fn().mockResolvedValue(undefined)}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        onOpenNotificationTask={vi.fn()}
        onOpenInvitations={vi.fn()}
        onOpenCommandPalette={onOpenCommandPalette}
        navigationVisible
        onToggleNavigation={onToggleNavigation}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse navigation' }),
    );
    expect(onToggleNavigation).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Active workspace'), {
      target: { value: 'workspace-2' },
    });
    expect(onSwitchWorkspace).toHaveBeenCalledWith('workspace-2');

    fireEvent.click(screen.getByRole('button', { name: 'Workspace actions' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Workspace settings' }),
    );
    expect(onOpenWorkspaceSettings).toHaveBeenCalledWith('general');

    fireEvent.click(screen.getByRole('button', { name: 'Workspace actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New workspace' }));
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Studio' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() =>
      expect(onCreateWorkspace).toHaveBeenCalledWith('Studio'),
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Search and commands (Ctrl or Command K)',
      }),
    );
    expect(onOpenCommandPalette).toHaveBeenCalled();
  });

  it('opens an empty notification popover and closes it outside', () => {
    render(
      <div>
        <WorkspaceTopBar
          context={context}
          workspaces={workspaces}
          workspaceId="workspace-1"
          onSwitchWorkspace={vi.fn().mockResolvedValue(undefined)}
          onCreateWorkspace={vi.fn().mockResolvedValue(undefined)}
          onRenameWorkspace={vi.fn().mockResolvedValue(undefined)}
          onOpenWorkspaceSettings={vi.fn()}
          onOpenNotificationTask={vi.fn()}
          onOpenInvitations={vi.fn()}
          onOpenCommandPalette={vi.fn()}
          navigationVisible
          onToggleNavigation={vi.fn()}
        />
        <button type="button">Outside</button>
      </div>,
    );

    expect(
      screen.getByRole('button', { name: 'Notifications' }),
    ).toBeInTheDocument();
  });
});

function workspace(id: string, name: string): Workspace {
  return {
    id,
    name,
    accent: 'sage',
    role: 'owner',
    created_at: '2026-08-20T01:00:00Z',
    updated_at: '2026-08-20T01:00:00Z',
  };
}

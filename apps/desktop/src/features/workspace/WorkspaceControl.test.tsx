import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from './types';
import { WorkspaceControl } from './WorkspaceControl';

const workspaces: Workspace[] = [
  workspace('workspace-1', 'Kanleaf Core'),
  workspace('workspace-2', 'Website'),
];

describe('WorkspaceControl', () => {
  it('forwards a selection of the routed Workspace so an in-flight switch can be repaired', () => {
    const onSwitchWorkspace = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspaceControl
        userEmail="quang@example.com"
        workspaces={workspaces}
        workspaceId="workspace-1"
        navigationVisible
        onSwitchWorkspace={onSwitchWorkspace}
        onCreateWorkspace={vi.fn().mockResolvedValue(undefined)}
        onOpenWorkspaceSettings={vi.fn()}
        onOpenInvitations={vi.fn()}
        onImportWorkspace={vi.fn()}
        onToggleNavigation={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Active workspace' }));
    fireEvent.click(
      screen.getByRole('menuitemradio', { name: /Kanleaf Core/ }),
    );

    expect(onSwitchWorkspace).toHaveBeenCalledWith('workspace-1');
  });

  it('groups Workspace switching, actions, and the navigation toggle', async () => {
    const onSwitchWorkspace = vi.fn().mockResolvedValue(undefined);
    const onCreateWorkspace = vi.fn().mockResolvedValue(undefined);
    const onOpenWorkspaceSettings = vi.fn();
    const onOpenInvitations = vi.fn();
    const onImportWorkspace = vi.fn();
    const onToggleNavigation = vi.fn();
    render(
      <WorkspaceControl
        userEmail="quang@example.com"
        workspaces={workspaces}
        workspaceId="workspace-1"
        navigationVisible
        onSwitchWorkspace={onSwitchWorkspace}
        onCreateWorkspace={onCreateWorkspace}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        onOpenInvitations={onOpenInvitations}
        onImportWorkspace={onImportWorkspace}
        onToggleNavigation={onToggleNavigation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Active workspace' }));
    expect(screen.getByText('quang@example.com')).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Settings for Kanleaf Core' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Settings for Website' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Website/ }));
    expect(onSwitchWorkspace).toHaveBeenCalledWith('workspace-2');

    fireEvent.click(screen.getByRole('button', { name: 'Active workspace' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Settings for Kanleaf Core' }),
    );
    expect(onOpenWorkspaceSettings).toHaveBeenCalledWith('general');

    fireEvent.click(screen.getByRole('button', { name: 'Active workspace' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Workspace invitations' }),
    );
    expect(onOpenInvitations).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Active workspace' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import workspace' }));
    expect(onImportWorkspace).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Active workspace' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New workspace' }));
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Personal notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() =>
      expect(onCreateWorkspace).toHaveBeenCalledWith('Personal notes'),
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse navigation' }),
    );
    expect(onToggleNavigation).toHaveBeenCalledOnce();
  });

  it('keeps only the reopen control in the collapsed rail', () => {
    render(
      <WorkspaceControl
        userEmail="quang@example.com"
        workspaces={workspaces}
        workspaceId="workspace-1"
        navigationVisible={false}
        onSwitchWorkspace={vi.fn().mockResolvedValue(undefined)}
        onCreateWorkspace={vi.fn().mockResolvedValue(undefined)}
        onOpenWorkspaceSettings={vi.fn()}
        onOpenInvitations={vi.fn()}
        onImportWorkspace={vi.fn()}
        onToggleNavigation={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Open navigation' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Active workspace' }),
    ).not.toBeInTheDocument();
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

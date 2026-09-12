import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from './types';
import { WorkspaceControl } from './WorkspaceControl';

HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute('open');
};

const context = { serverUrl: 'https://kanleaf.example.com', token: 'token' };

const workspaces: Workspace[] = [
  workspace('workspace-1', 'Kanleaf Core'),
  workspace('workspace-2', 'Website'),
];

describe('WorkspaceControl', () => {
  it('forwards a selection of the routed Workspace so an in-flight switch can be repaired', () => {
    const onSwitchWorkspace = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspaceControl
        context={context}
        userEmail="quang@example.com"
        workspaces={workspaces}
        workspaceId="workspace-1"
        mode="expanded"
        onSwitchWorkspace={onSwitchWorkspace}
        onCreateWorkspace={vi.fn().mockResolvedValue(undefined)}
        onFinishWorkspace={vi.fn()}
        onOpenWorkspaceSettings={vi.fn()}
        onOpenInvitations={vi.fn()}
        onImportWorkspace={vi.fn()}
        onToggleNavigation={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Active workspace' }));
    fireEvent.click(screen.getByRole('button', { name: /^Kanleaf Core/ }));

    expect(onSwitchWorkspace).toHaveBeenCalledWith('workspace-1');
  });

  it('groups Workspace switching, actions, and the navigation toggle', async () => {
    const onSwitchWorkspace = vi.fn().mockResolvedValue(undefined);
    const createdWorkspace = workspace('workspace-3', 'Personal notes');
    const onCreateWorkspace = vi.fn().mockResolvedValue(createdWorkspace);
    const onFinishWorkspace = vi.fn();
    const onOpenWorkspaceSettings = vi.fn();
    const onOpenInvitations = vi.fn();
    const onImportWorkspace = vi.fn();
    const onToggleNavigation = vi.fn();
    render(
      <WorkspaceControl
        context={context}
        userEmail="quang@example.com"
        workspaces={workspaces}
        workspaceId="workspace-1"
        mode="expanded"
        onSwitchWorkspace={onSwitchWorkspace}
        onCreateWorkspace={onCreateWorkspace}
        onFinishWorkspace={onFinishWorkspace}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        onOpenInvitations={onOpenInvitations}
        onImportWorkspace={onImportWorkspace}
        onToggleNavigation={onToggleNavigation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Active workspace' }));
    expect(screen.getByText('quang@example.com')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Settings for Kanleaf Core' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Settings for Website' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Website/ }));
    expect(onSwitchWorkspace).toHaveBeenCalledWith('workspace-2');

    fireEvent.click(screen.getByRole('button', { name: 'Active workspace' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Settings for Kanleaf Core' }),
    );
    expect(onOpenWorkspaceSettings).toHaveBeenCalledWith('general');

    fireEvent.click(screen.getByRole('button', { name: 'Active workspace' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Workspace invitations' }),
    );
    expect(onOpenInvitations).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Active workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import workspace' }));
    expect(onImportWorkspace).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Active workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Personal notes' },
    });
    expect(screen.getByLabelText('Workspace ID')).toHaveValue('personal-notes');
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));
    await waitFor(() =>
      expect(onCreateWorkspace).toHaveBeenCalledWith({
        name: 'Personal notes',
        identifier: 'personal-notes',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skip invitations' }));
    expect(onFinishWorkspace).toHaveBeenCalledWith(createdWorkspace);

    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse navigation' }),
    );
    expect(onToggleNavigation).toHaveBeenCalledOnce();
  });

  it('keeps the Workspace switcher available as a compact rail control', () => {
    render(
      <WorkspaceControl
        context={context}
        userEmail="quang@example.com"
        workspaces={workspaces}
        workspaceId="workspace-1"
        mode="rail"
        onSwitchWorkspace={vi.fn().mockResolvedValue(undefined)}
        onCreateWorkspace={vi.fn().mockResolvedValue(undefined)}
        onFinishWorkspace={vi.fn()}
        onOpenWorkspaceSettings={vi.fn()}
        onOpenInvitations={vi.fn()}
        onImportWorkspace={vi.fn()}
        onToggleNavigation={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Active workspace' });
    expect(trigger).toHaveTextContent('K');
    expect(trigger).not.toHaveTextContent('Kanleaf Core');
    fireEvent.click(trigger);
    expect(
      screen.getByRole('button', { name: /^Website/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Collapse navigation' }),
    ).not.toBeInTheDocument();
  });

  it('uses a close action inside the narrow drawer', () => {
    const onToggleNavigation = vi.fn();
    render(
      <WorkspaceControl
        context={context}
        userEmail="quang@example.com"
        workspaces={workspaces}
        workspaceId="workspace-1"
        mode="drawer"
        onSwitchWorkspace={vi.fn().mockResolvedValue(undefined)}
        onCreateWorkspace={vi.fn().mockResolvedValue(undefined)}
        onFinishWorkspace={vi.fn()}
        onOpenWorkspaceSettings={vi.fn()}
        onOpenInvitations={vi.fn()}
        onImportWorkspace={vi.fn()}
        onToggleNavigation={onToggleNavigation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(onToggleNavigation).toHaveBeenCalledOnce();
  });

  it('restores focus to the stable Workspace switcher after closing creation', async () => {
    renderControl();
    const workspaceSwitcher = screen.getByRole('button', {
      name: 'Active workspace',
    });

    fireEvent.click(workspaceSwitcher);
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Close Workspace creation' }),
    );

    await waitFor(() => expect(workspaceSwitcher).toHaveFocus());
  });

  it('restores focus to the stable Workspace switcher after finishing creation', async () => {
    const createdWorkspace = workspace('workspace-3', 'Personal notes');
    renderControl({
      onCreateWorkspace: vi.fn().mockResolvedValue(createdWorkspace),
      onFinishWorkspace: vi.fn().mockResolvedValue(undefined),
    });
    const workspaceSwitcher = screen.getByRole('button', {
      name: 'Active workspace',
    });

    fireEvent.click(workspaceSwitcher);
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Personal notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Skip invitations' }),
    );

    await waitFor(() => expect(workspaceSwitcher).toHaveFocus());
  });
});

function renderControl({
  onCreateWorkspace = vi
    .fn()
    .mockResolvedValue(workspace('workspace-3', 'Personal notes')),
  onFinishWorkspace = vi.fn(),
}: {
  onCreateWorkspace?: (identity: {
    name: string;
    identifier: string;
  }) => Promise<Workspace>;
  onFinishWorkspace?: (workspace: Workspace) => void | Promise<void>;
} = {}) {
  return render(
    <WorkspaceControl
      context={context}
      userEmail="quang@example.com"
      workspaces={workspaces}
      workspaceId="workspace-1"
      mode="expanded"
      onSwitchWorkspace={vi.fn().mockResolvedValue(undefined)}
      onCreateWorkspace={onCreateWorkspace}
      onFinishWorkspace={onFinishWorkspace}
      onOpenWorkspaceSettings={vi.fn()}
      onOpenInvitations={vi.fn()}
      onImportWorkspace={vi.fn()}
      onToggleNavigation={vi.fn()}
    />,
  );
}

function workspace(id: string, name: string): Workspace {
  return {
    id,
    identifier: name.toLowerCase().replaceAll(' ', '-'),
    name,
    accent: 'sage',
    role: 'owner',
    created_at: '2026-08-20T01:00:00Z',
    updated_at: '2026-08-20T01:00:00Z',
  };
}

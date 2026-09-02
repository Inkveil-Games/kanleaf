import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '../../lib/api/types';
import type { Workspace } from '../workspace/types';
import { AccountSettingsShell, WorkspaceSettingsShell } from './SettingsShell';

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'session-token',
};

describe('settings shells', () => {
  it('keeps Account settings scoped to account pages', () => {
    const onSectionChange = vi.fn();
    renderWithClient(
      <AccountSettingsShell
        context={context}
        user={user}
        section="profile"
        onSectionChange={onSectionChange}
        onWorkspaceJoined={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('region', { name: 'Account settings' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Members' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Security' }));
    expect(onSectionChange).toHaveBeenCalledWith('security');
  });

  it('keeps Workspace settings scoped to the active Workspace', () => {
    const onSectionChange = vi.fn();
    renderWithClient(
      <WorkspaceSettingsShell
        context={context}
        user={user}
        workspace={workspace}
        workspaceCount={2}
        section="general"
        onSectionChange={onSectionChange}
        onClose={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onConfigurationUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onRemoveWorkspace={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('region', { name: 'Workspace settings' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Profile' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invitations' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Members' }));
    expect(onSectionChange).toHaveBeenCalledWith('members');
    fireEvent.click(screen.getByRole('button', { name: 'Storage & backup' }));
    expect(onSectionChange).toHaveBeenCalledWith('storage');
  });

  it('hides administrative Workspace pages from members', () => {
    renderWithClient(
      <WorkspaceSettingsShell
        context={context}
        user={user}
        workspace={{ ...workspace, role: 'member' }}
        workspaceCount={2}
        section="general"
        onSectionChange={vi.fn()}
        onClose={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onConfigurationUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onRemoveWorkspace={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Invitations' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Storage & backup' }),
    ).toBeNull();
  });
});

function renderWithClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

const user: User = {
  id: 'user-1',
  email: 'person@example.com',
  display_name: 'Person Example',
  is_host: false,
  theme: 'system',
  timezone: 'UTC',
  week_start: 'monday',
  date_format: 'locale',
  active_workspace_id: 'workspace-1',
  setup_stage: 'complete',
};

const workspace: Workspace = {
  id: 'workspace-1',
  identifier: 'kanleaf-core',
  name: 'Kanleaf Core',
  accent: 'sage',
  role: 'owner',
  created_at: '2026-08-20T01:00:00Z',
  updated_at: '2026-08-20T01:00:00Z',
};

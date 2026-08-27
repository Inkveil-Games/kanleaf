import { Bell, ChevronDown, Pencil, Plus, Settings } from 'lucide-react';
import { useState } from 'react';
import { ContextMenu } from '../../components/ui/ContextMenu';
import { Wordmark } from '../../components/ui/Wordmark';
import { InlineNameForm } from './InlineNameForm';
import type { Workspace } from './types';
import type { WorkspaceSettingsSection } from './WorkspaceSettings';

interface WorkspaceTopBarProps {
  workspaces: Workspace[];
  workspaceId: string;
  onSwitchWorkspace: (workspaceId: string) => Promise<void>;
  onCreateWorkspace: (name: string) => Promise<void>;
  onRenameWorkspace: (name: string) => Promise<void>;
  onOpenWorkspaceSettings: (section: WorkspaceSettingsSection) => void;
}

type Composer = 'create' | 'rename' | null;

export function WorkspaceTopBar({
  workspaces,
  workspaceId,
  onSwitchWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onOpenWorkspaceSettings,
}: WorkspaceTopBarProps) {
  const [composer, setComposer] = useState<Composer>(null);
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin';

  return (
    <header className="workspace-topbar">
      <div className="topbar-workspace-area">
        <Wordmark quiet />
        <div className="workspace-switcher topbar-workspace-switcher">
          <label className="sr-only" htmlFor="workspace-select">
            Active workspace
          </label>
          <select
            id="workspace-select"
            value={workspaceId}
            onChange={(event) => void onSwitchWorkspace(event.target.value)}
          >
            {workspaces.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" size={14} />
          <ContextMenu label="Workspace actions">
            {canManage && (
              <button
                role="menuitem"
                type="button"
                onClick={() => setComposer('rename')}
              >
                <Pencil aria-hidden="true" size={14} /> Rename workspace
              </button>
            )}
            <button
              role="menuitem"
              type="button"
              onClick={() => onOpenWorkspaceSettings('general')}
            >
              <Settings aria-hidden="true" size={14} /> Workspace settings
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => setComposer('create')}
            >
              <Plus aria-hidden="true" size={14} /> New workspace
            </button>
          </ContextMenu>
        </div>
        {composer === 'create' && (
          <div className="topbar-composer">
            <InlineNameForm
              label="Workspace name"
              submitLabel="Create workspace"
              onCancel={() => setComposer(null)}
              onSubmit={async (name) => {
                await onCreateWorkspace(name);
                setComposer(null);
              }}
            />
          </div>
        )}
        {composer === 'rename' && workspace && (
          <div className="topbar-composer">
            <InlineNameForm
              label="Workspace name"
              initialValue={workspace.name}
              submitLabel="Rename workspace"
              onCancel={() => setComposer(null)}
              onSubmit={async (name) => {
                await onRenameWorkspace(name);
                setComposer(null);
              }}
            />
          </div>
        )}
      </div>
      <ContextMenu
        label="Notifications"
        className="notification-menu"
        popoverRole="dialog"
        trigger={<Bell aria-hidden="true" size={16} />}
      >
        <div className="notification-empty" role="status">
          <Bell aria-hidden="true" size={17} />
          <strong>No notifications yet</strong>
          <span>Updates about your work will appear here.</span>
        </div>
      </ContextMenu>
    </header>
  );
}

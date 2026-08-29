import {
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings,
} from 'lucide-react';
import { useState } from 'react';
import { ContextMenu } from '../../components/ui/ContextMenu';
import { Select } from '../../components/ui/Select';
import { Wordmark } from '../../components/ui/Wordmark';
import { Notifications } from '../collaboration/Notifications';
import { InlineNameForm } from './InlineNameForm';
import type { ApiContext } from './api';
import type { Workspace } from './types';
import type { WorkspaceSettingsSection } from './WorkspaceSettings';

interface WorkspaceTopBarProps {
  context: ApiContext;
  workspaces: Workspace[];
  workspaceId: string;
  onSwitchWorkspace: (workspaceId: string) => Promise<void>;
  onCreateWorkspace: (name: string) => Promise<void>;
  onRenameWorkspace: (name: string) => Promise<void>;
  onOpenWorkspaceSettings: (section: WorkspaceSettingsSection) => void;
  onOpenNotificationTask: (workspaceId: string, taskId: string) => void;
  onOpenInvitations: () => void;
  onOpenCommandPalette: () => void;
  navigationVisible: boolean;
  onToggleNavigation: () => void;
}

type Composer = 'create' | 'rename' | null;

export function WorkspaceTopBar({
  context,
  workspaces,
  workspaceId,
  onSwitchWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onOpenWorkspaceSettings,
  onOpenNotificationTask,
  onOpenInvitations,
  onOpenCommandPalette,
  navigationVisible,
  onToggleNavigation,
}: WorkspaceTopBarProps) {
  const [composer, setComposer] = useState<Composer>(null);
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin';

  return (
    <header className="workspace-topbar">
      <div className="topbar-workspace-area">
        <button
          className="icon-button topbar-navigation-toggle"
          type="button"
          aria-label={
            navigationVisible ? 'Collapse navigation' : 'Open navigation'
          }
          aria-expanded={navigationVisible}
          onClick={onToggleNavigation}
        >
          {navigationVisible ? (
            <PanelLeftClose aria-hidden="true" size={16} />
          ) : (
            <PanelLeftOpen aria-hidden="true" size={16} />
          )}
        </button>
        <Wordmark quiet />
        <div className="workspace-switcher topbar-workspace-switcher">
          <Select
            ariaLabel="Active workspace"
            value={workspaceId}
            options={workspaces.map((candidate) => ({
              value: candidate.id,
              label: candidate.name,
            }))}
            onValueChange={(value) => void onSwitchWorkspace(value)}
          />
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
      <button
        className="topbar-command-trigger"
        type="button"
        aria-label="Search and commands (Ctrl or Command K)"
        onClick={onOpenCommandPalette}
      >
        <Search aria-hidden="true" size={15} />
        <span>Search or jump</span>
        <kbd>Ctrl/⌘ K</kbd>
      </button>
      <Notifications
        context={context}
        onOpenTask={onOpenNotificationTask}
        onOpenInvitations={onOpenInvitations}
      />
    </header>
  );
}

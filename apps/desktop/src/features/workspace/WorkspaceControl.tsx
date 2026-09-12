import {
  Check,
  ChevronDown,
  FileUp,
  Mail,
  PanelLeftClose,
  Plus,
  Settings,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Popover, PopoverClose } from '../../components/ui/Popover';
import { IconButton } from '../../components/ui/IconButton';
import type { ApiContext } from './api';
import type { WorkspaceSettingsSection } from './settingsSections';
import type { Workspace } from './types';
import { WorkspaceCreateDialog } from './WorkspaceCreateDialog';
import type { WorkspaceIdentity } from './WorkspaceIdentityForm';
import type { NavigationMode } from './workspacePaneLayout';

interface WorkspaceControlProps {
  context: ApiContext;
  userEmail: string;
  workspaces: Workspace[];
  workspaceId: string;
  mode: NavigationMode;
  onSwitchWorkspace: (workspaceId: string) => Promise<void>;
  onCreateWorkspace: (identity: WorkspaceIdentity) => Promise<Workspace>;
  onFinishWorkspace: (workspace: Workspace) => void | Promise<void>;
  onOpenWorkspaceSettings: (section: WorkspaceSettingsSection) => void;
  onOpenInvitations: () => void;
  onImportWorkspace: () => void;
  onToggleNavigation: () => void;
}

export function WorkspaceControl({
  context,
  userEmail,
  workspaces,
  workspaceId,
  mode,
  onSwitchWorkspace,
  onCreateWorkspace,
  onFinishWorkspace,
  onOpenWorkspaceSettings,
  onOpenInvitations,
  onImportWorkspace,
  onToggleNavigation,
}: WorkspaceControlProps) {
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const workspaceSwitcherRef = useRef<HTMLButtonElement>(null);
  const restoreWorkspaceSwitcher = useRef(false);
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  const compact = mode === 'rail';

  useEffect(() => {
    if (creatingWorkspace || !restoreWorkspaceSwitcher.current) return;
    restoreWorkspaceSwitcher.current = false;
    workspaceSwitcherRef.current?.focus();
  }, [creatingWorkspace]);

  function closeWorkspaceCreation() {
    restoreWorkspaceSwitcher.current = true;
    setCreatingWorkspace(false);
  }

  function toggleNavigation() {
    setCreatingWorkspace(false);
    onToggleNavigation();
  }

  return (
    <section
      className="workspace-control"
      aria-label="Workspace navigation controls"
      data-navigation-mode={mode}
    >
      <div className="workspace-control-group">
        <Popover
          key={compact ? 'compact' : 'full'}
          className="workspace-switcher-menu"
          label="Active workspace"
          align="start"
          placement={compact ? 'right' : 'down'}
          sideOffset={7}
          triggerRef={workspaceSwitcherRef}
          triggerTooltip={
            compact ? (workspace?.name ?? 'Workspace') : undefined
          }
          trigger={
            <>
              <span className="workspace-trigger-mark" aria-hidden="true">
                {initial(workspace?.name, 'W')}
              </span>
              {!compact ? (
                <>
                  <span className="workspace-trigger-name">
                    {workspace?.name ?? 'Workspace'}
                  </span>
                  <ChevronDown
                    className="workspace-trigger-chevron"
                    aria-hidden="true"
                    size={14}
                  />
                </>
              ) : null}
            </>
          }
        >
          <div className="workspace-menu-account" role="presentation">
            <span className="workspace-menu-avatar" aria-hidden="true">
              {initial(userEmail, 'U')}
            </span>
            <span>
              <small>Signed in as</small>
              <strong title={userEmail}>{userEmail}</strong>
            </span>
          </div>
          <div className="workspace-menu-divider" role="separator" />
          <div
            className="workspace-menu-list"
            role="group"
            aria-label="Workspaces"
          >
            {workspaces.map((candidate) => {
              const active = candidate.id === workspaceId;
              const canManage =
                candidate.role === 'owner' || candidate.role === 'admin';
              return (
                <div
                  className="workspace-menu-row"
                  key={candidate.id}
                  role="presentation"
                >
                  <PopoverClose
                    className="workspace-menu-option"
                    ariaCurrent={active ? 'page' : undefined}
                    onClick={() => {
                      void onSwitchWorkspace(candidate.id);
                    }}
                  >
                    <span
                      className="workspace-menu-workspace-mark"
                      aria-hidden="true"
                    >
                      {initial(candidate.name, 'W')}
                    </span>
                    <span className="workspace-menu-workspace-copy">
                      <strong>{candidate.name}</strong>
                      <small>
                        /{candidate.identifier} · {candidate.role}
                      </small>
                    </span>
                    {active && <Check aria-hidden="true" size={14} />}
                  </PopoverClose>
                  {active && canManage && (
                    <PopoverClose
                      className="workspace-menu-settings"
                      ariaLabel={`Settings for ${candidate.name}`}
                      onClick={() => onOpenWorkspaceSettings('general')}
                    >
                      <Settings aria-hidden="true" size={14} />
                    </PopoverClose>
                  )}
                </div>
              );
            })}
          </div>
          <div className="workspace-menu-divider" role="separator" />
          <div className="workspace-menu-actions" role="group">
            <PopoverClose onClick={() => setCreatingWorkspace(true)}>
              <Plus aria-hidden="true" size={14} /> New workspace
            </PopoverClose>
            <PopoverClose onClick={onImportWorkspace}>
              <FileUp aria-hidden="true" size={14} /> Import workspace
            </PopoverClose>
            <PopoverClose onClick={onOpenInvitations}>
              <Mail aria-hidden="true" size={14} /> Workspace invitations
            </PopoverClose>
          </div>
        </Popover>
        {!compact ? (
          <>
            <span className="workspace-control-divider" aria-hidden="true" />
            <IconButton
              className="workspace-control-toggle"
              variant="ghost"
              size="sm"
              type="button"
              aria-label={
                mode === 'drawer' ? 'Close navigation' : 'Collapse navigation'
              }
              aria-expanded
              onClick={toggleNavigation}
            >
              <PanelLeftClose aria-hidden="true" size={15} />
            </IconButton>
          </>
        ) : null}
      </div>
      {creatingWorkspace ? (
        <WorkspaceCreateDialog
          context={context}
          onCreate={onCreateWorkspace}
          onFinished={async (createdWorkspace) => {
            await onFinishWorkspace(createdWorkspace);
            closeWorkspaceCreation();
          }}
          onClose={closeWorkspaceCreation}
        />
      ) : null}
    </section>
  );
}

function initial(value: string | undefined, fallback: string) {
  return value?.trim().charAt(0).toUpperCase() || fallback;
}

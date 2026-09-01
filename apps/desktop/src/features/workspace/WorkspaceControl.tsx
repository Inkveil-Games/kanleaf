import {
  Check,
  ChevronDown,
  FileUp,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ContextMenu } from '../../components/ui/ContextMenu';
import type { ApiContext } from './api';
import type { WorkspaceSettingsSection } from './settingsSections';
import type { Workspace } from './types';
import { WorkspaceCreateDialog } from './WorkspaceCreateDialog';
import type { WorkspaceIdentity } from './WorkspaceIdentityForm';

interface WorkspaceControlProps {
  context: ApiContext;
  userEmail: string;
  workspaces: Workspace[];
  workspaceId: string;
  navigationVisible: boolean;
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
  navigationVisible,
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
    >
      <div className="workspace-control-group">
        {navigationVisible && (
          <>
            <ContextMenu
              className="workspace-switcher-menu"
              label="Active workspace"
              triggerRef={workspaceSwitcherRef}
              trigger={
                <>
                  <span className="workspace-trigger-mark" aria-hidden="true">
                    {initial(workspace?.name, 'W')}
                  </span>
                  <span className="workspace-trigger-name">
                    {workspace?.name ?? 'Workspace'}
                  </span>
                  <ChevronDown
                    className="workspace-trigger-chevron"
                    aria-hidden="true"
                    size={14}
                  />
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
                      <button
                        className="workspace-menu-option"
                        role="menuitemradio"
                        type="button"
                        aria-checked={active}
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
                      </button>
                      {active && canManage && (
                        <button
                          className="workspace-menu-settings"
                          role="menuitem"
                          type="button"
                          aria-label={`Settings for ${candidate.name}`}
                          onClick={() => onOpenWorkspaceSettings('general')}
                        >
                          <Settings aria-hidden="true" size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="workspace-menu-divider" role="separator" />
              <div className="workspace-menu-actions" role="group">
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => setCreatingWorkspace(true)}
                >
                  <Plus aria-hidden="true" size={14} /> New workspace
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={onImportWorkspace}
                >
                  <FileUp aria-hidden="true" size={14} /> Import workspace
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={onOpenInvitations}
                >
                  <Mail aria-hidden="true" size={14} /> Workspace invitations
                </button>
              </div>
            </ContextMenu>
            <span className="workspace-control-divider" aria-hidden="true" />
          </>
        )}
        <button
          className="workspace-control-toggle"
          type="button"
          aria-label={
            navigationVisible ? 'Collapse navigation' : 'Open navigation'
          }
          aria-expanded={navigationVisible}
          onClick={toggleNavigation}
        >
          {navigationVisible ? (
            <PanelLeftClose aria-hidden="true" size={15} />
          ) : (
            <PanelLeftOpen aria-hidden="true" size={15} />
          )}
        </button>
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

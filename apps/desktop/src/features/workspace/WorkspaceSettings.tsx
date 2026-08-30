import { Trash2, UserMinus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { SettingsArticle } from '../settings/SettingsArticle';
import {
  TaskConfigurationSettings,
  type TaskConfigurationSection,
} from '../task-config/TaskConfigurationSettings';
import {
  ActionMessage,
  FormActions,
  type ActionState,
} from '../settings/SettingsControls';
import { errorMessage, monogram, titleCase } from '../settings/utils';
import {
  deleteWorkspace,
  leaveWorkspace,
  updateWorkspace,
  type ApiContext,
} from './api';
import { canManageWorkspace } from './permissions';
import type { Workspace, WorkspaceAccent } from './types';
import { WorkspaceInvitationSettings } from './WorkspaceInvitationSettings';
import { WorkspaceMemberSettings } from './WorkspaceMemberSettings';
import { WorkspaceStorageSettings } from './WorkspaceStorageSettings';

export type WorkspaceSettingsSection =
  | 'general'
  | 'members'
  | 'invitations'
  | 'storage'
  | TaskConfigurationSection
  | 'danger';

interface WorkspaceSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  userId: string;
  workspaceCount: number;
  section: WorkspaceSettingsSection;
  onWorkspaceUpdated: () => Promise<void>;
  onConfigurationUpdated: () => Promise<void>;
  onWorkspaceRemoved: () => Promise<void>;
}

export function WorkspaceSettings({
  context,
  workspace,
  userId,
  workspaceCount,
  section,
  onWorkspaceUpdated,
  onConfigurationUpdated,
  onWorkspaceRemoved,
}: WorkspaceSettingsProps) {
  if (section === 'general') {
    return (
      <GeneralSettings
        context={context}
        workspace={workspace}
        onWorkspaceUpdated={onWorkspaceUpdated}
      />
    );
  }
  if (section === 'members') {
    return (
      <WorkspaceMemberSettings
        context={context}
        workspace={workspace}
        userId={userId}
        onWorkspaceUpdated={onWorkspaceUpdated}
      />
    );
  }
  if (section === 'invitations') {
    return (
      <WorkspaceInvitationSettings context={context} workspace={workspace} />
    );
  }
  if (
    section === 'states' ||
    section === 'labels' ||
    section === 'task-types'
  ) {
    return (
      <TaskConfigurationSettings
        context={context}
        workspace={workspace}
        section={section}
        onConfigurationUpdated={onConfigurationUpdated}
      />
    );
  }
  if (section === 'storage') {
    return (
      <WorkspaceStorageSettings
        context={context}
        workspace={workspace}
        onConfigurationUpdated={onConfigurationUpdated}
      />
    );
  }
  return (
    <DangerSettings
      context={context}
      workspace={workspace}
      workspaceCount={workspaceCount}
      onWorkspaceRemoved={onWorkspaceRemoved}
    />
  );
}

function GeneralSettings({
  context,
  workspace,
  onWorkspaceUpdated,
}: Pick<
  WorkspaceSettingsProps,
  'context' | 'workspace' | 'onWorkspaceUpdated'
>) {
  const [name, setName] = useState(workspace.name);
  const [accent, setAccent] = useState(workspace.accent);
  const [state, setState] = useState<ActionState>({ status: 'idle' });
  const canManage = canManageWorkspace(workspace);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ status: 'saving' });
    try {
      await updateWorkspace(context, workspace.id, { name, accent });
      await onWorkspaceUpdated();
      setState({ status: 'saved', message: 'Workspace updated' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  return (
    <SettingsArticle
      eyebrow="Workspace"
      title="General"
      description="Identity and appearance for this Workspace."
    >
      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <div className="profile-summary">
          <span
            className={`workspace-monogram accent-${accent}`}
            aria-hidden="true"
          >
            {monogram(name)}
          </span>
          <div>
            <strong>{name}</strong>
            <small>{titleCase(workspace.role)} access</small>
          </div>
        </div>
        <label className="settings-field">
          <span>Workspace name</span>
          <input
            required
            maxLength={120}
            disabled={!canManage}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <fieldset className="accent-picker" disabled={!canManage}>
          <legend>Accent</legend>
          <div>
            {ACCENTS.map((value) => (
              <label key={value} title={titleCase(value)}>
                <input
                  type="radio"
                  name="workspace-accent"
                  value={value}
                  checked={accent === value}
                  onChange={() => setAccent(value)}
                />
                <span className={`accent-swatch accent-${value}`} />
                <span className="sr-only">{titleCase(value)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {canManage ? (
          <FormActions state={state} label="Save workspace" />
        ) : (
          <p className="settings-muted">
            Only Workspace Owners and Admins can change these settings.
          </p>
        )}
      </form>
    </SettingsArticle>
  );
}

function DangerSettings({
  context,
  workspace,
  workspaceCount,
  onWorkspaceRemoved,
}: Pick<
  WorkspaceSettingsProps,
  'context' | 'workspace' | 'workspaceCount' | 'onWorkspaceRemoved'
>) {
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  async function leave() {
    if (!window.confirm(`Leave ${workspace.name}?`)) return;
    setState({ status: 'saving' });
    try {
      await leaveWorkspace(context, workspace.id);
      await onWorkspaceRemoved();
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  async function remove(event: FormEvent) {
    event.preventDefault();
    if (!window.confirm(`Permanently delete ${workspace.name}?`)) return;
    setState({ status: 'saving' });
    try {
      await deleteWorkspace(context, workspace.id, {
        name: confirmation,
        password,
      });
      await onWorkspaceRemoved();
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  return (
    <SettingsArticle
      eyebrow="Workspace"
      title="Danger zone"
      description="Irreversible or access-removing Workspace actions."
    >
      {workspace.role === 'owner' ? (
        <section className="danger-section">
          <div>
            <h2>Delete Workspace</h2>
            <p>
              Permanently removes structured data and the Workspace Markdown
              vault. This cannot be undone.
            </p>
          </div>
          <form
            className="settings-form"
            onSubmit={(event) => void remove(event)}
          >
            <label className="settings-field">
              <span>Type {workspace.name} to confirm</span>
              <input
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="settings-field">
              <span>Current password</span>
              <input
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button
              className="danger-button"
              type="submit"
              disabled={
                state.status === 'saving' || confirmation !== workspace.name
              }
            >
              <Trash2 aria-hidden="true" size={14} /> Delete Workspace
            </button>
            <ActionMessage state={state} />
          </form>
        </section>
      ) : (
        <section className="danger-section">
          <div>
            <h2>Leave Workspace</h2>
            <p>
              Your tasks remain, but you will lose access to this Workspace.
            </p>
          </div>
          <button
            className="danger-button"
            type="button"
            disabled={state.status === 'saving' || workspaceCount <= 1}
            onClick={() => void leave()}
          >
            <UserMinus aria-hidden="true" size={14} /> Leave Workspace
          </button>
          {workspaceCount <= 1 && (
            <p className="settings-muted">
              Join or create another Workspace before leaving this one.
            </p>
          )}
          <ActionMessage state={state} />
        </section>
      )}
    </SettingsArticle>
  );
}

const ACCENTS: WorkspaceAccent[] = [
  'sage',
  'blue',
  'amber',
  'rose',
  'violet',
  'slate',
];

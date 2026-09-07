import { Trash2, UserMinus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { SettingsArticle } from '../settings/SettingsArticle';
import { TaskConfigurationSettings } from '../task-config/TaskConfigurationSettings';
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
import type { WorkspaceSettingsSection } from './settingsSections';
import type { Workspace, WorkspaceAccent } from './types';
import { WorkspaceMemberSettings } from './WorkspaceMemberSettings';
import { WorkspaceStorageSettings } from './WorkspaceStorageSettings';
import { ArchivedProjectsSettings } from '../project/ArchivedProjectsSettings';
import { PropertiesSettings } from '../custom-properties/PropertiesSettings';

export type { WorkspaceSettingsSection } from './settingsSections';

interface WorkspaceSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  userId: string;
  workspaceCount: number;
  section: WorkspaceSettingsSection;
  onWorkspaceUpdated: () => Promise<void>;
  onConfigurationUpdated: () => Promise<void>;
  onProjectsChanged: () => Promise<void>;
  onRemoveWorkspace: (remove: () => Promise<void>) => Promise<void>;
  propertyCreateRequest?: number;
  onPropertyCreateRequestHandled?: () => void;
  definePropertyName?: string;
  onDefinePropertyClosed?: () => void;
}

export function WorkspaceSettings({
  context,
  workspace,
  userId,
  workspaceCount,
  section,
  onWorkspaceUpdated,
  onConfigurationUpdated,
  onProjectsChanged,
  onRemoveWorkspace,
  propertyCreateRequest,
  onPropertyCreateRequestHandled,
  definePropertyName,
  onDefinePropertyClosed,
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
  if (section === 'properties') {
    return (
      <PropertiesSettings
        key={`${workspace.id}:${propertyCreateRequest ?? 0}:${definePropertyName ?? ''}`}
        context={context}
        workspace={workspace}
        createRequested={propertyCreateRequest}
        onCreateRequestHandled={onPropertyCreateRequestHandled}
        definePropertyName={definePropertyName}
        onDefinePropertyClosed={onDefinePropertyClosed}
      />
    );
  }
  if (section === 'projects') {
    return (
      <ArchivedProjectsSettings
        context={context}
        workspace={workspace}
        onProjectsChanged={onProjectsChanged}
      />
    );
  }
  return (
    <DangerSettings
      context={context}
      workspace={workspace}
      workspaceCount={workspaceCount}
      onRemoveWorkspace={onRemoveWorkspace}
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
        <div className="settings-field">
          <label htmlFor={`workspace-identifier-${workspace.id}`}>
            Workspace ID
          </label>
          <input
            id={`workspace-identifier-${workspace.id}`}
            readOnly
            value={workspace.identifier}
          />
          <small>
            Used in Workspace links. This ID cannot be changed after creation.
          </small>
        </div>
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
  onRemoveWorkspace,
}: Pick<
  WorkspaceSettingsProps,
  'context' | 'workspace' | 'workspaceCount' | 'onRemoveWorkspace'
>) {
  const [password, setPassword] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  async function leave() {
    setState({ status: 'saving' });
    try {
      await onRemoveWorkspace(() => leaveWorkspace(context, workspace.id));
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
      throw error;
    }
  }

  async function remove() {
    setState({ status: 'saving' });
    try {
      await onRemoveWorkspace(() =>
        deleteWorkspace(context, workspace.id, {
          name: workspace.name,
          password,
        }),
      );
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
      throw error;
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
          <button
            className="danger-button"
            type="button"
            disabled={state.status === 'saving'}
            onClick={() => setDialogOpen(true)}
          >
            <Trash2 aria-hidden="true" size={14} /> Delete Workspace
          </button>
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
            onClick={() => setDialogOpen(true)}
          >
            <UserMinus aria-hidden="true" size={14} /> Leave Workspace
          </button>
          {workspaceCount <= 1 && (
            <p className="settings-muted">
              Join or create another Workspace before leaving this one.
            </p>
          )}
        </section>
      )}
      <ActionMessage state={state} />
      {workspace.role === 'owner' ? (
        <AppDialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setPassword('');
          }}
          type="typed-confirm"
          variant="danger"
          title={`Delete ${workspace.name} permanently?`}
          description="Permanently removes structured data and the Workspace Markdown vault. This cannot be undone."
          confirmationText={workspace.name}
          confirmLabel="Delete Workspace"
          loadingLabel="Deleting…"
          confirmDisabled={!password}
          onConfirm={remove}
        >
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
        </AppDialog>
      ) : (
        <AppDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          type="confirm"
          variant="danger"
          title={`Leave ${workspace.name}?`}
          description="Your tasks remain, but you will lose access to this Workspace."
          confirmLabel="Leave Workspace"
          loadingLabel="Leaving…"
          onConfirm={leave}
        />
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
